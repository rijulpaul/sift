// core/mail.test.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//   mail.ts wraps the AgentMail SDK (network calls to a real email API).
//   Tests must NEVER hit the network: they'd be slow, flaky and could even
//   charge money. Instead we MOCK the entire "agentmail" module.
//
// MOCKING — THE THREE IDEAS YOU NEED
//
//   1. vi.mock("agentmail", factory)
//      Intercepts every import of "agentmail" and substitutes the factory's
//      return value. mail.ts therefore gets our FAKE client instead of the
//      real SDK, and its `new AgentMailClient(...)` creates our mock.
//
//   2. vi.hoisted(() => ({ ... }))
//      Vitest HOISTS vi.mock() calls above all imports (so the fake exists
//      before mail.ts is loaded). Any variable the mock factory closes over
//      must itself be created with vi.hoisted — otherwise you get a
//      "Cannot access before initialization" error at runtime.
//
//   3. vi.fn() spies
//        - Programming: mockResolvedValue(x)         → always resolve with x
//                       mockResolvedValueOnce(x)     → resolve once, then fall back
//        - Interrogation: toHaveBeenCalledWith(...)  → did we call it with these args?
//                         toHaveBeenCalledTimes(n)   → how many calls?
//                         toHaveBeenNthCalledWith(n) → what did call #n receive?
//
//   Sending fake values into real code paths lets us test:
//     - discovery of an existing inbox    (Mail.init → found)
//     - creation of a new inbox           (Mail.init → not found)
//     - pagination loops (inboxes.search AND messages.list)
//     - label updates                     (Mail.update)
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

// The playbook of fake responses / spy functions our fake client will use.
const mocks = vi.hoisted(() => ({
  search: vi.fn(),   // client.inboxes.search
  create: vi.fn(),   // client.inboxes.create
  list: vi.fn(),     // client.inboxes.messages.list
  get: vi.fn(),      // client.inboxes.messages.get
  update: vi.fn(),   // client.inboxes.messages.update
}));

// Replace the "agentmail" module with our fake client.
// The shape mirrors the real AgentMailClient API: a nested `inboxes` object
// with search/create and a nested `messages` resource.
vi.mock("agentmail", () => {
  class MockAgentMailClient {
    inboxes = {
      search: mocks.search,
      create: mocks.create,
      messages: {
        list: mocks.list,
        get: mocks.get,
        update: mocks.update,
      },
    };
  }
  return { AgentMailClient: MockAgentMailClient };
});

import { Inbox } from "./mail";

describe("Mail.init — inbox discovery/creation", () => {
  beforeEach(() => {
    // Reset every spy's call history so tests don't affect each other.
    vi.clearAllMocks();
    // Default: listing messages returns an empty page.
    // (mail.get() iterates res.messages — without this it would crash.)
    mocks.list.mockResolvedValue({ messages: [] });
  });

  it("adopts an existing inbox when the searched email matches", async () => {
    // Arrange — the "server" has an inbox with our email
    mocks.search.mockResolvedValue({
      inboxes: [{ email: "news@example.com", inboxId: "inbox-found" }],
    });

    // Act
    const inbox = await Inbox.init({ email: "news@example.com" });

    // Assert — the returned Mail must be bound to the FOUND inbox.
    // We prove the binding by calling mail.get() and checking which inbox id
    // was used for the messages.list call.
    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-found", undefined);

    // And since we found it, no inbox should have been created.
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps paginating until a matching inbox is found", async () => {
    // Arrange — page 1 has no match but points to a page 2, which does.
    mocks.search
      .mockResolvedValueOnce({
        inboxes: [{ email: "other@example.com", inboxId: "inbox-1" }],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        inboxes: [{ email: "news@example.com", inboxId: "inbox-2" }],
      });

    // Act
    const inbox = await Inbox.init({ email: "news@example.com" });

    // Assert — both pages were searched, the second one passing the token...
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenNthCalledWith(2, {
      q: "news@example.com",
      pageToken: "page-2",
    });
    // ...and the resulting Mail is bound to the inbox found on page 2.
    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-2", undefined);
  });

  it("creates a new inbox when no existing one matches", async () => {
    // Arrange — search comes back empty
    mocks.search.mockResolvedValue({ inboxes: [] });
    mocks.create.mockResolvedValue({ inboxId: "inbox-new" });

    // Act
    const inbox = await Inbox.init({ email: "news@example.com" });

    // Assert — username/domain are derived from the email address
    expect(mocks.create).toHaveBeenCalledWith({
      username: "news",
      domain: "example.com",
      displayName: undefined,
    });

    // The created inbox id is the one used for message listing afterwards.
    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-new", undefined);
  });

  it("creates an inbox even when no email is provided", async () => {
    // Arrange
    mocks.create.mockResolvedValue({ inboxId: "inbox-anon" });

    // Act — no email → no search is performed, creation happens directly
    const inbox = await Inbox.init({});

    // Assert
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({
      username: undefined,
      domain: undefined,
      displayName: undefined,
    });

    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-anon", undefined);
  });
});

describe("Mail.get — fetching full messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the FULL message for every message id, across pages", async () => {
    // Arrange — the Mail constructor takes an inbox id directly.
    const inbox = new Inbox("inbox-x");
    // Page 1: one summary, plus a token for the next page.
    mocks.list
      .mockResolvedValueOnce({ messages: [{ messageId: "m1" }], nextPageToken: "next" })
      .mockResolvedValueOnce({ messages: [{ messageId: "m2" }] });
    mocks.get.mockResolvedValue({ id: "full-message" });

    // Act
    const messages = await inbox.get();

    // Assert
    expect(mocks.list).toHaveBeenCalledTimes(2);   // followed the pagination token
    expect(mocks.get).toHaveBeenCalledTimes(2);    // fetched one full message per id
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m1");
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m2");
    expect(messages).toHaveLength(2);              // both fetched messages returned
  });
});
