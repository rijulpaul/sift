import { describe, expect, it } from "vitest";

import {
  BODY_PENDING_MESSAGE,
  NO_CONTENT_MESSAGE,
  SUMMARY_PENDING_MESSAGE,
  bodyView,
  labelsLine,
  readActionLabel,
  summaryActionLabel,
} from "../../cli/lib/preview";
import type { BodyState, SummaryState } from "../../cli/state";
import type { MailBody } from "../../cli/types";

/** A body that has been fetched. */
const readyBody = (extra: Partial<MailBody> = {}): BodyState => ({
  status: "ready",
  body: {
    text: "The message text",
    content: { content: "The markdown", links: {} },
    ...extra,
  },
});

describe("bodyView — text view", () => {
  it("shows the message text", () => {
    expect(bodyView(readyBody(), false, undefined)).toEqual({
      text: "The message text",
      dim: false,
    });
  });

  it("shows a placeholder when the message has no content", () => {
    expect(
      bodyView(
        readyBody({ text: "", content: { content: "", links: {} } }),
        false,
        undefined,
      ),
    ).toEqual({ text: NO_CONTENT_MESSAGE, dim: true });
  });

  it("ignores any summary while the text view is showing", () => {
    const done: SummaryState = { status: "done", text: "A summary" };
    expect(bodyView(readyBody(), false, done).text).toBe("The message text");
  });
});

describe("bodyView — before the body arrives", () => {
  it("says it is loading while the message is fetched", () => {
    expect(bodyView({ status: "loading" }, false, undefined)).toEqual({
      text: BODY_PENDING_MESSAGE,
      dim: true,
    });
  });

  it("says it is loading when nothing has been fetched yet", () => {
    expect(bodyView(undefined, false, undefined).text).toBe(
      BODY_PENDING_MESSAGE,
    );
  });

  it("reports a failed fetch and how to retry", () => {
    const failed = bodyView(
      { status: "error", message: "network down" },
      false,
      undefined,
    );

    expect(failed.dim).toBe(true);
    expect(failed.text).toContain("Couldn't load this message.");
    expect(failed.text).toContain("network down");
    expect(failed.text).toContain("Press enter to try again.");
  });
});

describe("bodyView — summary view", () => {
  it("shows a pending placeholder before the first chunk arrives", () => {
    expect(
      bodyView(readyBody(), true, { status: "streaming", text: "" }),
    ).toEqual({
      text: SUMMARY_PENDING_MESSAGE,
      dim: true,
    });
  });

  it("shows the pending placeholder when no summary exists yet", () => {
    expect(bodyView(readyBody(), true, undefined).text).toBe(
      SUMMARY_PENDING_MESSAGE,
    );
  });

  it("shows the streamed text as it grows", () => {
    expect(
      bodyView(readyBody(), true, {
        status: "streaming",
        text: "Summary so far",
      }),
    ).toEqual({ text: "Summary so far", dim: false });
  });

  it("shows a finished summary", () => {
    expect(
      bodyView(readyBody(), true, { status: "done", text: "Done summary" }),
    ).toEqual({ text: "Done summary", dim: false });
  });

  it("explains a failure and how to retry when nothing was produced", () => {
    const failed = bodyView(readyBody(), true, {
      status: "error",
      text: "",
      error: "model unavailable",
    });
    expect(failed.dim).toBe(true);
    expect(failed.text).toContain("Couldn't summarize this message.");
    expect(failed.text).toContain("model unavailable");
    expect(failed.text).toContain("Press s to try again.");
  });

  it("keeps a partial summary and says it was interrupted", () => {
    const failed = bodyView(readyBody(), true, {
      status: "error",
      text: "Partial",
      error: "stream broke",
    });
    expect(failed.text.startsWith("Partial")).toBe(true);
    expect(failed.text).toContain("Summary interrupted: stream broke");
  });
});

describe("button and label text", () => {
  it("the summary button offers the view it would switch to", () => {
    expect(summaryActionLabel(false)).toBe("Summarize");
    expect(summaryActionLabel(true)).toBe("Show text");
  });

  it("the read button offers the other state", () => {
    expect(readActionLabel(true)).toBe("Mark as read");
    expect(readActionLabel(false)).toBe("Mark as unread");
  });

  it("labels are shown on one line, or a dash when there are none", () => {
    expect(labelsLine(["inbox", "unread"])).toBe("inbox  ·  unread");
    expect(labelsLine([])).toBe("—");
  });
});
