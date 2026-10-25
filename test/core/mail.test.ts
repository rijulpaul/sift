// test/mail.test.ts
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
//                       mockRejectedValueOnce(err)   → reject once
//        - Interrogation: toHaveBeenCalledWith(...)  → did we call it with these args?
//                         toHaveBeenCalledTimes(n)   → how many calls?
//                         toHaveBeenNthCalledWith(n) → what did call #n receive?
//
//   The logger is mocked too, so tests can assert what mail.ts logs on
//   success and on failure (the logger is silent under vitest otherwise).
//
//   Sending fake values into real code paths lets us test:
//     - discovery of an existing inbox    (Inbox.init → found)
//     - creation of a new inbox           (Inbox.init → not found)
//     - pagination loops (inboxes.list AND messages.list)
//     - label updates                     (Inbox.updateLabels)
//     - deletion                          (Inbox.delete)
//     - failure handling                  (rejected SDK promises → wrapped errors)
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";

// The playbook of fake responses / spy functions our fake client will use.
const mocks = vi.hoisted(() => ({
  listInboxes: vi.fn(), // client.inboxes.list (inbox discovery)
  create: vi.fn(), // client.inboxes.create
  list: vi.fn(), // client.inboxes.messages.list
  get: vi.fn(), // client.inboxes.messages.get
  update: vi.fn(), // client.inboxes.messages.update
  delete: vi.fn(), // client.inboxes.messages.delete
}));

// Spies for the logger. child() returns the same spy object, so every module
// log call made by mail.ts lands here.
const logMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../core/logger", () => ({
  logger: { child: () => logMock },
}));

// Replace the "agentmail" module with our fake client.
// The shape mirrors the real AgentMailClient API: a nested `inboxes` object
// with list/create and a nested `messages` resource.
vi.mock("agentmail", () => {
  class MockAgentMailClient {
    inboxes = {
      list: mocks.listInboxes,
      create: mocks.create,
      messages: {
        list: mocks.list,
        get: mocks.get,
        update: mocks.update,
        delete: mocks.delete,
      },
    };
  }
  return { AgentMailClient: MockAgentMailClient };
});

import { Inbox } from "../../core/mail";

// Resolves to the thrown error, so tests can inspect message and cause.
const catchError = async (promise: Promise<unknown>): Promise<any> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected promise to reject, but it resolved");
};

// Collects an async iterable, so it can be passed to catchError.
const collect = async (iterable: AsyncIterable<unknown>) => {
  const items: unknown[] = [];
  for await (const item of iterable) items.push(item);
  return items;
};

// The message argument of every call at a given log level.
const loggedMessages = (level: keyof typeof logMock) =>
  logMock[level].mock.calls.map((args) => args.at(-1));

describe("Mail.init — inbox discovery/creation", () => {
  beforeEach(() => {
    // Reset every spy (calls AND queued once-values) so tests don't leak state.
    vi.resetAllMocks();
    // Default: listing messages returns an empty page.
    // (mail.get() iterates res.messages — without this it would crash.)
    mocks.list.mockResolvedValue({ messages: [] });
  });

  it("adopts an existing inbox when the searched email matches", async () => {
    // Arrange — the "server" has an inbox with our email
    mocks.listInboxes.mockResolvedValue({
      inboxes: [{ email: "news@example.com", inboxId: "inbox-found" }],
    });

    // Act
    const inbox = await Inbox.init({
      email: "news@example.com",
      createEmail: true,
    });

    // Assert — the returned Mail must be bound to the FOUND inbox.
    // We prove the binding by calling mail.get() and checking which inbox id
    // was used for the messages.list call.
    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-found", {});

    // And since we found it, no inbox should have been created.
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps paginating until a matching inbox is found", async () => {
    // Arrange — page 1 has no match but points to a page 2, which does.
    mocks.listInboxes
      .mockResolvedValueOnce({
        inboxes: [{ email: "other@example.com", inboxId: "inbox-1" }],
        nextPageToken: "page-2",
      })
      .mockResolvedValueOnce({
        inboxes: [{ email: "news@example.com", inboxId: "inbox-2" }],
      });

    // Act
    const inbox = await Inbox.init({
      email: "news@example.com",
      createEmail: true,
    });

    // Assert — both pages were searched, the second one passing the token...
    expect(mocks.listInboxes).toHaveBeenCalledTimes(2);
    expect(mocks.listInboxes).toHaveBeenNthCalledWith(2, {
      pageToken: "page-2",
    });
    // ...and the resulting Mail is bound to the inbox found on page 2.
    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-2", {});
  });

  it("creates a new inbox when no existing one matches and createEmail is 'true'", async () => {
    // Arrange — search comes back empty
    mocks.listInboxes.mockResolvedValue({ inboxes: [] });
    mocks.create.mockResolvedValue({ inboxId: "inbox-new" });

    // Act
    const inbox = await Inbox.init({
      email: "news@example.com",
      createEmail: true,
    });

    // Assert — username/domain are derived from the email address
    expect(mocks.create).toHaveBeenCalledWith({
      username: "news",
      domain: "example.com",
      displayName: undefined,
    });

    // The created inbox id is the one used for message listing afterwards.
    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-new", {});
  });

  it("creates an inbox even when no email is provided and createEmail is 'true'", async () => {
    // Arrange
    mocks.create.mockResolvedValue({ inboxId: "inbox-anon" });

    // Act — no email → no search is performed, creation happens directly
    const inbox = await Inbox.init({ createEmail: true });

    // Assert
    expect(mocks.listInboxes).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({
      username: undefined,
      domain: undefined,
      displayName: undefined,
    });

    await inbox.get();
    expect(mocks.list).toHaveBeenCalledWith("inbox-anon", {});
  });

  it("DOES NOT create a new inbox when no existing one matches and createEmail is 'false'", async () => {
    // Act
    await expect(
      Inbox.init({ email: "news@example.com", createEmail: false }),
    ).rejects.toThrow();

    // Assert
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("DOES NOT create an inbox even when no email is provided and createEmail is 'false'", async () => {
    // Act — no email → no search is performed, creation doesnt happen (createEmail: false)
    await expect(Inbox.init({ createEmail: false })).rejects.toThrow();

    // Assert
    expect(mocks.listInboxes).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before calling the API", async () => {
    const err = await catchError(
      Inbox.init({ email: "not-an-email", createEmail: true }),
    );

    expect(err.message).toBe("Invalid email: not-an-email");
    expect(mocks.listInboxes).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reports a missing inbox without wrapping it as an API failure", async () => {
    // This is a validation error from our own code, not an SDK rejection,
    // so it must keep its original message.
    mocks.listInboxes.mockResolvedValue({ inboxes: [] });

    const err = await catchError(
      Inbox.init({ email: "news@example.com", createEmail: false }),
    );

    expect(err.message).toMatch(/createEmail is set to false/);
    expect(err.message).not.toMatch(/failed:/);
  });
});

describe("Mail.init — API failures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("wraps a failed inbox search and does not try to create an inbox", async () => {
    const boom = new Error("search unavailable");
    mocks.listInboxes.mockRejectedValueOnce(boom);

    const err = await catchError(
      Inbox.init({ email: "news@example.com", createEmail: true }),
    );

    expect(err.message).toBe("search inboxes failed: search unavailable");
    expect(err.cause).toBe(boom);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "search inboxes",
        email: "news@example.com",
        err: boom,
      }),
      "search inboxes failed",
    );
  });

  it("wraps a failed inbox creation", async () => {
    mocks.listInboxes.mockResolvedValue({ inboxes: [] });
    const boom = new Error("quota exceeded");
    mocks.create.mockRejectedValueOnce(boom);

    const err = await catchError(
      Inbox.init({ email: "news@example.com", createEmail: true }),
    );

    expect(err.message).toBe("create inbox failed: quota exceeded");
    expect(err.cause).toBe(boom);
    expect(loggedMessages("error")).toContain("create inbox failed");
  });

  it("handles a rejection that is not an Error instance", async () => {
    mocks.create.mockRejectedValueOnce("plain string reason");
    mocks.listInboxes.mockResolvedValue({ inboxes: [] });

    const err = await catchError(Inbox.init({ createEmail: true }));

    expect(err.message).toBe("create inbox failed: plain string reason");
    expect(err.cause).toBe("plain string reason");
  });
});

describe("Mail.get — fetching full messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches the FULL message for every message id, across pages", async () => {
    // Arrange — the Mail constructor takes an inbox id directly.
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });
    // Snapshot the request as it was at call time: mail.ts reuses and mutates
    // the same request object across pages, so post-hoc assertions would see
    // the final state instead of what each call actually received.
    const requests: Array<Record<string, unknown>> = [];
    mocks.list
      .mockImplementationOnce(async (_inboxId, request) => {
        requests.push({ ...request });
        return { messages: [{ messageId: "m1" }], nextPageToken: "next" };
      })
      .mockImplementationOnce(async (_inboxId, request) => {
        requests.push({ ...request });
        return { messages: [{ messageId: "m2" }] };
      });
    mocks.get.mockResolvedValue({ id: "full-message" });

    // Act
    const messages = await inbox.get();

    // Assert
    expect(requests).toEqual([{}, { pageToken: "next" }]); // followed the token
    expect(mocks.get).toHaveBeenCalledTimes(2); // fetched one full message per id
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m1");
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m2");
    expect(messages).toHaveLength(2); // both fetched messages returned
  });

  it("wraps a failed list call with context", async () => {
    const boom = new Error("network down");
    mocks.list.mockRejectedValueOnce(boom);
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    const err = await catchError(inbox.get());

    expect(err.message).toBe("list messages failed: network down");
    expect(err.cause).toBe(boom);
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "list messages",
        inbox_id: "inbox-x",
        page: 1,
        err: boom,
      }),
      "list messages failed",
    );
  });

  it("stops at the first failed message fetch and wraps the error", async () => {
    mocks.list.mockResolvedValueOnce({
      messages: [{ messageId: "m1" }, { messageId: "m2" }],
    });
    mocks.get.mockRejectedValueOnce(new Error("404 not found"));
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    const err = await catchError(inbox.get());

    expect(err.message).toBe("get message failed: 404 not found");
    expect(mocks.get).toHaveBeenCalledTimes(1); // m2 was never requested
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m1");
    expect(loggedMessages("info")).not.toContain("fetched messages");
  });
});

describe("Mail.updateLabels", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("sends the add/remove labels for the given message", async () => {
    mocks.update.mockResolvedValue({});
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    await inbox.updateLabels("msg-1", {
      addLabels: ["read"],
      removeLabels: "unread",
    });

    expect(mocks.update).toHaveBeenCalledWith("inbox-x", "msg-1", {
      addLabels: ["read"],
      removeLabels: "unread",
    });
    expect(loggedMessages("debug")).toContain("message labels updated");
  });

  it("wraps a failed update and does not log success", async () => {
    const boom = new Error("invalid label");
    mocks.update.mockRejectedValueOnce(boom);
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    const err = await catchError(
      inbox.updateLabels("msg-1", {
        addLabels: "read",
        removeLabels: undefined,
      }),
    );

    expect(err.message).toBe("update message labels failed: invalid label");
    expect(err.cause).toBe(boom);
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update message labels",
        inbox_id: "inbox-x",
        message_id: "msg-1",
        err: boom,
      }),
      "update message labels failed",
    );
    expect(loggedMessages("debug")).not.toContain("message labels updated");
  });
});

describe("Mail.delete", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("deletes the given message from the inbox", async () => {
    mocks.delete.mockResolvedValue({});
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    await inbox.delete("msg-1");

    expect(mocks.delete).toHaveBeenCalledWith("inbox-x", "msg-1");
    expect(loggedMessages("debug")).toContain("message deleted");
  });

  it("wraps a failed delete and does not log success", async () => {
    const boom = new Error("message already gone");
    mocks.delete.mockRejectedValueOnce(boom);
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    const err = await catchError(inbox.delete("msg-1"));

    expect(err.message).toBe("delete message failed: message already gone");
    expect(err.cause).toBe(boom);
    expect(loggedMessages("debug")).not.toContain("message deleted");
  });
});

describe("Mail.getStream — streaming full messages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("yields the full message for every id, across pages", async () => {
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });
    const requests: Array<Record<string, unknown>> = [];
    mocks.list
      .mockImplementationOnce(async (_inboxId, request) => {
        requests.push({ ...request });
        return { messages: [{ messageId: "m1" }], nextPageToken: "next" };
      })
      .mockImplementationOnce(async (_inboxId, request) => {
        requests.push({ ...request });
        return { messages: [{ messageId: "m2" }] };
      });
    mocks.get.mockImplementation(async (_inboxId, messageId) => ({
      id: messageId,
    }));

    const streamed = await collect(inbox.getStream());

    expect(requests).toEqual([{}, { pageToken: "next" }]); // followed the token
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m1");
    expect(mocks.get).toHaveBeenCalledWith("inbox-x", "m2");
    // getStream yields promises; `for await` resolves them for the consumer.
    expect(streamed).toEqual([{ id: "m1" }, { id: "m2" }]);
  });

  it("fetches nothing until the consumer pulls", async () => {
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });
    mocks.list.mockResolvedValue({ messages: [{ messageId: "m1" }] });
    mocks.get.mockResolvedValue({ id: "m1" });

    const stream = inbox.getStream();
    expect(mocks.list).not.toHaveBeenCalled(); // async generators are lazy

    await stream.next();

    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("resumes from a caller-supplied page token", async () => {
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });
    const requests: Array<Record<string, unknown>> = [];
    mocks.list.mockImplementationOnce(async (_inboxId, request) => {
      requests.push({ ...request });
      return { messages: [] };
    });

    await collect(inbox.getStream({ pageToken: "resume-here" }));

    expect(requests).toEqual([{ pageToken: "resume-here" }]);
  });

  it("wraps a failed list call", async () => {
    const boom = new Error("network down");
    mocks.list.mockRejectedValueOnce(boom);
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    const err = await catchError(collect(inbox.getStream()));

    expect(err.message).toBe("list messages failed: network down");
    expect(err.cause).toBe(boom);
  });

  it("wraps a failed message fetch like get", async () => {
    const boom = new Error("404 not found");
    mocks.list.mockResolvedValueOnce({ messages: [{ messageId: "m1" }] });
    mocks.get.mockRejectedValueOnce(boom);
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });

    const err = await catchError(collect(inbox.getStream()));

    expect(err.message).toBe("get message failed: 404 not found");
    expect(err.cause).toBe(boom);
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "get message",
        inbox_id: "inbox-x",
        message_id: "m1",
        err: boom,
      }),
      "get message failed",
    );
  });

  it("logs the total message count, not just the last page", async () => {
    const inbox = new Inbox({ inboxId: "inbox-x", email: "" });
    mocks.list
      .mockResolvedValueOnce({
        messages: [{ messageId: "m1" }],
        nextPageToken: "next",
      })
      .mockResolvedValueOnce({
        messages: [{ messageId: "m2" }, { messageId: "m3" }],
      });
    mocks.get.mockImplementation(async (_inboxId, messageId) => ({
      id: messageId,
    }));

    await collect(inbox.getStream());

    expect(logMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 3, pages: 2 }),
      "fetched messages",
    );
  });
});
