import { describe, expect, it } from "vitest";

import {
  isUnread,
  plainTextOf,
  toMailBody,
  toMailSummary,
  type CoreListItem,
  type CoreMessageDetail,
} from "../../cli/lib/mail";
import type { MailBody } from "../../cli/types";

/** A row in the shape SiftCore.listMessages yields. */
const coreRow = (extra: Partial<CoreListItem> = {}): CoreListItem =>
  ({
    id: "m1",
    from: "Ada <ada@x.io>",
    subject: "Hello",
    receivedAt: new Date(2024, 2, 4, 9, 30),
    labels: ["inbox", "unread"],
    ...extra,
  }) as CoreListItem;

/** A message in the shape SiftCore.getMessage returns. */
const coreDetail = (
  extra: Partial<CoreMessageDetail> = {},
): CoreMessageDetail =>
  ({
    id: "m1",
    from: "Ada <ada@x.io>",
    subject: "Hello",
    receivedAt: new Date(2024, 2, 4, 9, 30),
    labels: ["inbox"],
    text: "Plain body",
    body: { content: "Markdown body", links: {} },
    ...extra,
  }) as CoreMessageDetail;

const body = (extra: Partial<MailBody> = {}): MailBody => ({
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
  it("maps a list row onto the view model", () => {
    const mail = toMailSummary(coreRow());

    expect(mail.id).toBe("m1");
    expect(mail.from).toBe("Ada <ada@x.io>");
    expect(mail.subject).toBe("Hello");
    expect(mail.receivedAt).toEqual(new Date(2024, 2, 4, 9, 30));
    expect(mail.labels).toEqual(["inbox", "unread"]);
    expect(mail.unread).toBe(true);
  });

  it("carries no body: that arrives with getMessage", () => {
    const mail = toMailSummary(coreRow()) as unknown as Record<string, unknown>;

    expect(mail.text).toBeUndefined();
    expect(mail.content).toBeUndefined();
  });

  it("turns a timestamp that arrived as a string into a Date", () => {
    const mail = toMailSummary(
      coreRow({ receivedAt: "2024-03-04T09:30:00Z" as unknown as Date }),
    );

    expect(mail.receivedAt).toBeInstanceOf(Date);
    expect(mail.receivedAt.toISOString()).toBe("2024-03-04T09:30:00.000Z");
  });

  it("fills in a missing subject with an empty string", () => {
    const mail = toMailSummary(coreRow({ subject: undefined }));

    expect(mail.subject).toBe("");
  });
});

describe("toMailBody", () => {
  it("maps a fetched message onto the body the preview shows", () => {
    expect(toMailBody(coreDetail())).toEqual({
      text: "Plain body",
      content: { content: "Markdown body", links: {} },
    });
  });

  it("tolerates a message with no plain text", () => {
    expect(toMailBody(coreDetail({ text: undefined })).text).toBe("");
    expect(toMailBody(coreDetail({ text: undefined })).content).toEqual({
      content: "Markdown body",
      links: {},
    });
  });
});

describe("plainTextOf", () => {
  it("prefers the plain text when there is some", () => {
    expect(plainTextOf(body({ text: "  Plain  " }))).toBe("Plain");
  });

  it("falls back to the processed markdown, with the real links", () => {
    const text = plainTextOf(
      body({
        content: {
          content:
            "Read [the post](LINK_1) now.\n\n\n\n![Chart of growth](LINK_0)",
          links: {
            0: {
              id: 0,
              url: "https://cdn.example.com/growth.png",
              isImage: true,
            },
            1: { id: 1, url: "https://example.com/post", isImage: false },
          },
        },
      }),
    );

    expect(text).toBe(
      "Read the post (https://example.com/post) now.\n\n" +
        "[image: Chart of growth] (https://cdn.example.com/growth.png)",
    );
  });

  it("names images that have no alt text", () => {
    expect(
      plainTextOf(
        body({
          content: {
            content: "![](LINK_0)",
            links: {
              0: { id: 0, url: "https://cdn.example.com/x.png", isImage: true },
            },
          },
        }),
      ),
    ).toBe("[image] (https://cdn.example.com/x.png)");
  });

  it("leaves a placeholder it cannot resolve", () => {
    expect(
      plainTextOf(
        body({
          content: { content: "See [it](LINK_9)", links: {} },
        }),
      ),
    ).toBe("See [it](LINK_9)");
  });

  it("is empty when there is no text and no content", () => {
    expect(plainTextOf(body())).toBe("");
  });
});
