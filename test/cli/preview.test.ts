import { describe, expect, it } from "vitest";

import {
  BODY_PENDING_MESSAGE,
  NO_CONTENT_MESSAGE,
  SUMMARY_PENDING_MESSAGE,
  bodySegments,
  bodyView,
  imageCaption,
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

/** A summary that has finished streaming. */
const summaryOf = (text: string): SummaryState => ({ status: "done", text });

describe("bodyView — the message", () => {
  it("shows the message as markdown", () => {
    expect(bodyView(readyBody(), false, undefined)).toEqual({
      text: "The message text",
      format: "markdown",
    });
  });

  it("shows a placeholder when the message has no content", () => {
    expect(
      bodyView(
        readyBody({ text: "", content: { content: "", links: {} } }),
        false,
        undefined,
      ),
    ).toEqual({ text: NO_CONTENT_MESSAGE, format: "note" });
  });

  it("ignores any summary while the text view is showing", () => {
    const view = bodyView(readyBody(), false, summaryOf("A summary"));

    expect(view.text).toBe("The message text");
  });
});

describe("bodyView — before the body arrives", () => {
  it("says it is loading while the message is fetched", () => {
    expect(bodyView({ status: "loading" }, false, undefined)).toEqual({
      text: BODY_PENDING_MESSAGE,
      format: "note",
    });
  });

  it("says it is loading when nothing has been fetched yet", () => {
    expect(bodyView(undefined, false, undefined).text).toBe(
      BODY_PENDING_MESSAGE,
    );
  });

  it("reports a failed fetch and how to retry", () => {
    const { text, format } = bodyView(
      { status: "error", message: "boom" },
      false,
      undefined,
    );

    expect(format).toBe("note");
    expect(text).toContain("Couldn't load this message.");
    expect(text).toContain("boom");
    expect(text).toContain("Press enter to try again.");
  });
});

describe("bodyView — the summary", () => {
  it("says it is summarizing before the first chunk arrives", () => {
    expect(bodyView(readyBody(), true, undefined)).toEqual({
      text: SUMMARY_PENDING_MESSAGE,
      format: "note",
    });
    expect(
      bodyView(readyBody(), true, { status: "streaming", text: "" }),
    ).toEqual({ text: SUMMARY_PENDING_MESSAGE, format: "note" });
    expect(
      bodyView(readyBody(), true, { status: "streaming", text: "  \n " }),
    ).toEqual({ text: SUMMARY_PENDING_MESSAGE, format: "note" });
  });

  it("draws the summary as markdown once it has arrived", () => {
    const markdown = "## Aggregators\n\nThey capture demand.";

    expect(bodyView(readyBody(), true, summaryOf(markdown))).toEqual({
      text: markdown,
      format: "markdown",
    });
  });

  it("streams what has arrived instead of waiting for the end", () => {
    // Half a document is still readable, so it is shown as it comes.
    const partial = "## Aggregators\n\nThey capture";

    expect(
      bodyView(readyBody(), true, { status: "streaming", text: partial }),
    ).toEqual({ text: partial, format: "markdown" });
  });

  it("keeps a partial summary readable when the stream breaks", () => {
    const partial = "## Aggregators\n\nThey capture";

    const view = bodyView(readyBody(), true, {
      status: "error",
      text: partial,
      error: "stream broke",
    });

    expect(view).toEqual({ text: partial, format: "markdown" });
  });

  it("explains a failure and how to retry when nothing was produced", () => {
    const { text, format } = bodyView(readyBody(), true, {
      status: "error",
      text: "",
      error: "model unavailable",
    });

    expect(format).toBe("note");
    expect(text).toContain("Couldn't summarize this message.");
    expect(text).toContain("model unavailable");
    expect(text).toContain("Press s to try again.");
  });
});

describe("bodySegments", () => {
  it("draws a note as a single piece of text", () => {
    expect(bodySegments({ text: "Loading…", format: "note" })).toEqual([
      { kind: "text", text: "Loading…", style: "note" },
    ]);
  });

  it("hands the message's own markdown to the markdown renderer", () => {
    const view = bodyView(readyBody(), false, undefined);

    expect(bodySegments(view)).toEqual([
      { kind: "markdown", text: "The message text" },
    ]);
  });

  it("draws the pictures in the message as pictures, between the prose", () => {
    const view = bodyView(
      readyBody({
        text: [
          "Intro line.",
          "![A chart](https://cdn.example.com/a.png)",
          "Outro line.",
        ].join("\n\n"),
      }),
      false,
      undefined,
    );

    expect(bodySegments(view)).toEqual([
      { kind: "markdown", text: "Intro line." },
      { kind: "image", url: "https://cdn.example.com/a.png" },
      { kind: "markdown", text: "Outro line." },
    ]);
  });

  it("draws a summary's pictures the same way as the message's", () => {
    const markdown = [
      "## Aggregators",
      "",
      "They capture demand.",
      "",
      "![A chart](https://cdn.example.com/a.png)",
    ].join("\n");

    expect(
      bodySegments(bodyView(readyBody(), true, summaryOf(markdown))),
    ).toEqual([
      { kind: "markdown", text: "## Aggregators\n\nThey capture demand." },
      { kind: "image", url: "https://cdn.example.com/a.png" },
    ]);
  });

  it("leaves a half-written picture in the prose, so nothing is fetched", () => {
    // "![A chart](https://cdn.exam" is not a whole line yet: it must not become
    // a picture to load, and it must not disappear either.
    const partial = "See ![A chart](https://cdn.exam";

    const segments = bodySegments(
      bodyView(readyBody(), true, { status: "streaming", text: partial }),
    );

    expect(segments).toEqual([{ kind: "markdown", text: partial }]);
  });
});

describe("imageCaption", () => {
  it("shows the address", () => {
    expect(imageCaption("https://cdn.example.com/a.png")).toBe(
      "image: https://cdn.example.com/a.png",
    );
  });

  it("says so when the picture could not be loaded", () => {
    expect(imageCaption("https://cdn.example.com/a.png", true)).toBe(
      "image: https://cdn.example.com/a.png (couldn't load)",
    );
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
