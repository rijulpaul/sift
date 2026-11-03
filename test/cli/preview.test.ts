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

/** The text of a view that is running text. Fails loudly on a block view. */
const textOf = (view: ReturnType<typeof bodyView>): string => {
  if (view.kind !== "text") throw new Error(`expected text, got ${view.kind}`);
  return view.text;
};

describe("bodyView — text view", () => {
  it("shows the message text", () => {
    expect(bodyView(readyBody(), false, undefined)).toEqual({
      kind: "text",
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
    ).toEqual({ kind: "text", text: NO_CONTENT_MESSAGE, dim: true });
  });

  it("ignores any summary while the text view is showing", () => {
    const done: SummaryState = { status: "done", text: "A summary" };
    expect(textOf(bodyView(readyBody(), false, done))).toBe("The message text");
  });
});

describe("bodyView — before the body arrives", () => {
  it("says it is loading while the message is fetched", () => {
    expect(bodyView({ status: "loading" }, false, undefined)).toEqual({
      kind: "text",
      text: BODY_PENDING_MESSAGE,
      dim: true,
    });
  });

  it("says it is loading when nothing has been fetched yet", () => {
    expect(textOf(bodyView(undefined, false, undefined))).toBe(
      BODY_PENDING_MESSAGE,
    );
  });

  it("reports a failed fetch and how to retry", () => {
    const failed = bodyView(
      { status: "error", message: "network down" },
      false,
      undefined,
    );
    const text = textOf(failed);

    expect(text).toContain("Couldn't load this message.");
    expect(text).toContain("network down");
    expect(text).toContain("Press enter to try again.");
  });
});

describe("bodyView — summary view", () => {
  it("shows a pending placeholder before the first chunk arrives", () => {
    expect(
      bodyView(readyBody(), true, { status: "streaming", text: "" }),
    ).toEqual({ kind: "text", text: SUMMARY_PENDING_MESSAGE, dim: true });
  });

  it("shows the pending placeholder when no summary exists yet", () => {
    expect(textOf(bodyView(readyBody(), true, undefined))).toBe(
      SUMMARY_PENDING_MESSAGE,
    );
  });

  it("draws a summary as its parts, so the title is a title", () => {
    const raw = JSON.stringify({
      title: "Aggregators",
      content: [{ type: "text", text: "The piece argues it." }],
    });

    expect(bodyView(readyBody(), true, { status: "done", text: raw })).toEqual({
      kind: "blocks",
      title: "Aggregators",
      blocks: [{ kind: "text", text: "The piece argues it.", complete: true }],
      note: undefined,
    });
  });

  it("hands over the blocks when the summary carries a picture", () => {
    const raw = JSON.stringify({
      title: "Aggregators",
      content: [
        { type: "text", text: "The piece argues it." },
        { type: "image", url: "https://cdn.example.com/chart.png" },
      ],
    });

    expect(bodyView(readyBody(), true, { status: "done", text: raw })).toEqual({
      kind: "blocks",
      title: "Aggregators",
      blocks: [
        { kind: "text", text: "The piece argues it.", complete: true },
        {
          kind: "image",
          url: "https://cdn.example.com/chart.png",
          complete: true,
        },
      ],
      note: undefined,
    });
  });

  it("renders a half-written document without waiting for the rest", () => {
    const partial =
      '{"title":"Aggregators","content":[{"type":"text","text":"The piece';

    expect(
      bodyView(readyBody(), true, { status: "streaming", text: partial }),
    ).toEqual({
      kind: "blocks",
      title: "Aggregators",
      blocks: [{ kind: "text", text: "The piece", complete: false }],
      note: undefined,
    });
  });

  it("still says it is summarizing while only JSON punctuation has arrived", () => {
    expect(
      bodyView(readyBody(), true, { status: "streaming", text: '{"title":' }),
    ).toEqual({ kind: "text", text: SUMMARY_PENDING_MESSAGE, dim: true });
  });

  it("falls back to the text when the model ignored the shape", () => {
    expect(
      bodyView(readyBody(), true, { status: "done", text: "Just some prose." }),
    ).toEqual({ kind: "text", text: "Just some prose.", dim: false });
  });

  it("keeps a partial summary readable when the stream breaks", () => {
    const partial =
      '{"title":"Aggregators","content":[{"type":"text","text":"The piece';

    const view = bodyView(readyBody(), true, {
      status: "error",
      text: partial,
      error: "stream broke",
    });

    expect(view.kind).toBe("blocks");
    if (view.kind !== "blocks") return;

    expect(view.title).toBe("Aggregators");
    expect(view.blocks).toEqual([
      { kind: "text", text: "The piece", complete: false },
    ]);
    expect(view.note).toBe("— Summary interrupted: stream broke");
  });

  it("explains a failure and how to retry when nothing was produced", () => {
    const text = textOf(
      bodyView(readyBody(), true, {
        status: "error",
        text: "",
        error: "model unavailable",
      }),
    );

    expect(text).toContain("Couldn't summarize this message.");
    expect(text).toContain("model unavailable");
    expect(text).toContain("Press s to try again.");
  });

  it("reports an interruption after the blocks when a picture arrived", () => {
    const raw = JSON.stringify({
      title: "Aggregators",
      content: [{ type: "image", url: "https://cdn.example.com/chart.png" }],
    });

    const view = bodyView(readyBody(), true, {
      status: "error",
      text: raw,
      error: "stream broke",
    });

    expect(view.kind).toBe("blocks");
    if (view.kind !== "blocks") return;
    expect(view.note).toBe("— Summary interrupted: stream broke");
  });
});

describe("bodySegments", () => {
  it("draws a text view as a single piece of text", () => {
    expect(bodySegments({ kind: "text", text: "Hello", dim: true })).toEqual([
      { kind: "text", text: "Hello", style: "note" },
    ]);
  });

  it("draws the title, the paragraphs and the pictures in order", () => {
    const view = bodyView(readyBody(), true, {
      status: "done",
      text: JSON.stringify({
        title: "Aggregators",
        content: [
          { type: "text", text: "First." },
          { type: "image", url: "https://cdn.example.com/a.png" },
          { type: "text", text: "Second." },
        ],
      }),
    });

    // The title is its own style, so it can be emphasised above the rest.
    expect(bodySegments(view)).toEqual([
      { kind: "text", text: "Aggregators", style: "title" },
      { kind: "text", text: "First.", style: "body" },
      { kind: "image", url: "https://cdn.example.com/a.png" },
      { kind: "text", text: "Second.", style: "body" },
    ]);
  });

  it("shows an address rather than fetching a half-written one", () => {
    // Only the block's closing brace makes an address safe to fetch.
    const partial =
      '{"content":[{"type":"image","url":"https://cdn.example.com/char';

    const view = bodyView(readyBody(), true, {
      status: "streaming",
      text: partial,
    });

    expect(bodySegments(view)).toEqual([
      {
        kind: "text",
        text: imageCaption("https://cdn.example.com/char"),
        style: "note",
      },
    ]);
  });

  it("draws the picture once its block is whole", () => {
    const raw =
      '{"content":[{"type":"image","url":"https://cdn.example.com/chart.png"}]}';

    const view = bodyView(readyBody(), true, { status: "done", text: raw });

    expect(bodySegments(view)).toEqual([
      { kind: "image", url: "https://cdn.example.com/chart.png" },
    ]);
  });

  it("puts the interruption note last", () => {
    const raw =
      '{"title":"T","content":[{"type":"image","url":"https://cdn.example.com/a.png"}]}';

    const view = bodyView(readyBody(), true, {
      status: "error",
      text: raw,
      error: "stream broke",
    });

    const segments = bodySegments(view);

    expect(segments.at(-1)).toEqual({
      kind: "text",
      text: "— Summary interrupted: stream broke",
      style: "note",
    });
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
