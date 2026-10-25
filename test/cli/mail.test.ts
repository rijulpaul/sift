import { describe, expect, it } from "vitest";

import {
  isUnread,
  plainTextOf,
  toMailSummary,
  type CoreMessage,
} from "../../cli/lib/mail";
import type { MailSummary } from "../../cli/types";

/** A message in the shape SiftCore.getMessagesStream yields. */
const coreMessage = (extra: Partial<CoreMessage> = {}): CoreMessage =>
  ({
    id: "m1",
    from: "Ada <ada@x.io>",
    subject: "Hello",
    recievedAt: new Date(2024, 2, 4, 9, 30),
    labels: ["inbox", "unread"],
    text: "Plain body",
    body: { content: "Markdown body", links: {} },
    ...extra,
  }) as CoreMessage;

const summary = (extra: Partial<MailSummary> = {}): MailSummary => ({
  id: "m1",
  from: "ada@x.io",
  subject: "",
  receivedAt: new Date(2024, 0, 1),
  labels: [],
  unread: false,
  text: "",
  content: { content: "", links: {} },
  ...extra,
});

describe("isUnread", () => {
  it("is true only for the unread label", () => {
    expect(isUnread(["inbox", "unread"])).toBe(true);
    expect(isUnread(["inbox", "read"])).toBe(false);
    expect(isUnread([])).toBe(false);
  });
});

describe("toMailSummary", () => {
  it("maps the core's message onto the view model", () => {
    const mail = toMailSummary(coreMessage());

    expect(mail.id).toBe("m1");
    expect(mail.from).toBe("Ada <ada@x.io>");
    expect(mail.subject).toBe("Hello");
    expect(mail.receivedAt).toEqual(new Date(2024, 2, 4, 9, 30));
    expect(mail.labels).toEqual(["inbox", "unread"]);
    expect(mail.unread).toBe(true);
    expect(mail.text).toBe("Plain body");
    expect(mail.content).toEqual({ content: "Markdown body", links: {} });
  });

  it("turns a timestamp that arrived as a string into a Date", () => {
    const mail = toMailSummary(
      coreMessage({ recievedAt: "2024-03-04T09:30:00Z" as unknown as Date }),
    );
    expect(mail.receivedAt).toBeInstanceOf(Date);
    expect(mail.receivedAt.toISOString()).toBe("2024-03-04T09:30:00.000Z");
  });

  it("fills in missing subject and text with empty strings", () => {
    const mail = toMailSummary(
      coreMessage({ subject: undefined, text: undefined }),
    );
    expect(mail.subject).toBe("");
    expect(mail.text).toBe("");
  });
});

describe("plainTextOf", () => {
  it("prefers the plain text when there is some", () => {
    expect(
      plainTextOf(
        summary({ text: "  Plain  ", content: { content: "md", links: {} } }),
      ),
    ).toBe("Plain");
  });

  it("falls back to the processed markdown, without the link placeholders", () => {
    const text = plainTextOf(
      summary({
        content: {
          content:
            "Read [the post](LINK_1) now.\n\n\n\n![Chart of growth](LINK_0)",
          links: {},
        },
      }),
    );
    expect(text).toBe("Read the post now.\n\n[image: Chart of growth]");
  });

  it("names images that have no alt text", () => {
    expect(
      plainTextOf(summary({ content: { content: "![](LINK_0)", links: {} } })),
    ).toBe("[image]");
  });

  it("is empty when there is no text and no content", () => {
    expect(plainTextOf(summary())).toBe("");
  });
});
