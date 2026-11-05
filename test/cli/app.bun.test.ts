// End-to-end tests: the real TUI is mounted on OpenTUI's headless test
// renderer, driven with simulated keys and clicks, and asserted on the rendered
// screen. The core is a mock with the same surface as SiftCore, so nothing
// touches the network. It also records what the TUI asked the core to do.
//
// OpenTUI's native renderer only loads under Bun, so this file runs with
// `bun run test:tui` (vitest skips it; see vitest.config.ts).

import { createTestRenderer } from "@opentui/core/testing";
import { afterEach, describe, expect, it } from "bun:test";
import { mountTui } from "../../cli";
import { theme } from "../../cli/theme";
import { DIVIDER_STEP } from "../../cli/layout";
import {
  createMockCore,
  createMockMessages,
  type MockCoreOptions,
} from "../../cli/mock";
import type { SiftCore } from "../../core";
import { writeTinyPng } from "../helpers/tinyPng";

const NOW = new Date(2024, 2, 4, 15, 0, 0);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Harness = Awaited<ReturnType<typeof createTestRenderer>>;
const open: Harness[] = [];

/** Mount the TUI on a fresh mock core. */
async function start(
  options: MockCoreOptions = {},
  size: { width: number; height: number } = { width: 110, height: 24 },
) {
  const t = await createTestRenderer(size);
  open.push(t);

  const { core, calls } = createMockCore({
    messages: createMockMessages(NOW),
    ...options,
  });
  let exits = 0;
  await mountTui(t.renderer, core as SiftCore, {
    now: () => NOW,
    onExit: () => exits++,
  });

  const frame = async () => {
    await t.flush();
    return t.captureCharFrame();
  };

  return {
    t,
    calls,
    exits: () => exits,
    frame,
    /** The status bar row (second to last: the last row is empty). */
    footer: async () => (await frame()).split("\n").at(-2) ?? "",
  };
}

/** Poll the screen until `predicate` holds, failing with the last frame if it never does. */
async function until(
  t: Harness,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await t.flush();
    const frame = t.captureCharFrame();
    if (predicate(frame)) return frame;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for the screen. Last frame:\n${frame}`,
      );
    }
    await sleep(10);
  }
}

/** Click the first occurrence of `text` on screen. */
async function clickText(t: Harness, text: string) {
  await t.flush();
  const lines = t.captureCharFrame().split("\n");
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(text);
    if (x >= 0) {
      await t.mockMouse.click(x + Math.floor(text.length / 2), y);
      await t.flush();
      return;
    }
  }
  throw new Error(`"${text}" is not on screen`);
}

/**
 * Mount on All mail. The TUI starts on unread, so this switches to All and
 * waits for the full list, which most tests are written against.
 */
async function startAll(
  options: MockCoreOptions = {},
  size: { width: number; height: number } = { width: 110, height: 24 },
) {
  const harness = await start(options, size);
  const count = (options.messages ?? createMockMessages(NOW)).length;
  await until(harness.t, (f) => f.includes("Unread ("));
  harness.t.mockInput.pressKey("u");
  await until(harness.t, (f) => f.includes(`Inbox (${count})`));
  return harness;
}

/**
 * Click the first picture drawn on screen. Pictures are runs of block
 * characters; the scrollbar is a single `█`, so a run of five is a picture.
 */
async function clickPicture(t: Harness) {
  await t.flush();
  const lines = t.captureCharFrame().split("\n");
  for (let y = 0; y < lines.length; y++) {
    const match = /[▀▄█]{5,}/.exec(lines[y]!);
    if (match) {
      await t.mockMouse.click(match.index + 2, y);
      await t.flush();
      return;
    }
  }
  throw new Error("no picture on screen");
}

/**
 * The colours of the first picture row, cell by cell. A picture is drawn as
 * coloured blocks, so two different parts of it have different colours — which
 * is how a pan or a zoom can be seen in a character frame.
 */
function pictureCells(t: Harness): string[] {
  const frame = t.captureCharFrame().split("\n");
  const y = frame.findIndex((line) => /[▀▄█]{5,}/.test(line));
  if (y < 0) throw new Error("no picture on screen");
  const start = frame[y]!.search(/[▀▄█]{5,}/);
  const width = /[▀▄█]+/.exec(frame[y]!.slice(start))![0].length;

  const spans = t.captureSpans() as unknown as {
    lines: Array<{
      spans: Array<{ text: string; fg?: { r: number; g: number } }>;
    }>;
  };

  const cells = spans.lines[y]!.spans.flatMap((span) => {
    const colour = `${span.fg?.r.toFixed(2)}/${span.fg?.g.toFixed(2)}`;
    return Array.from({ length: [...span.text].length }, () => colour);
  });

  return cells.slice(start, start + width);
}

/** The red channel of a theme colour, e.g. "#101010" → 16. */
const hexToChannel = (hex: string): number => parseInt(hex.slice(1, 3), 16);

/** The background colour of one cell, as r/g/b (0-255). */
function bgAt(t: Harness, x: number, y: number): number[] {
  const spans = t.captureSpans() as unknown as {
    lines: Array<{
      spans: Array<{ text: string; bg?: { toInts(): number[] } }>;
    }>;
  };

  let column = 0;
  for (const span of spans.lines[y]!.spans) {
    const length = [...span.text].length;
    if (x < column + length) return span.bg?.toInts() ?? [0, 0, 0, 0];
    column += length;
  }
  return [0, 0, 0, 0];
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((t) => t.dispose()));
});

const SUBJECT_1 = "The Pulse: how AI is changing hiring at big tech";
const SUBJECT_2 = "Aggregators and the long tail of attention";
const SUBJECT_3 = "Markets rally as rate-cut hopes return";
const SUMMARY_TEXT = "Summary: this newsletter covers AI hiring.";

describe("TUI — list", () => {
  it("streams mail into the list with sender, subject and time", async () => {
    const { t } = await startAll();

    const screen = await until(t, (f) => f.includes("Inbox (6)"));

    expect(screen).toContain("The Pragmatic Engineer");
    expect(screen).toContain("14:30");
    expect(screen).toContain("Yesterday");
    expect(screen).toContain("Select a message to read it.");
  });

  it("shows the first mail before the whole stream has finished", async () => {
    const { t } = await start({ delayMs: 200 });

    await until(t, (f) => f.includes("The Pragmatic Engineer"));

    const screen = t.captureCharFrame();
    expect(screen).not.toContain("Inbox (6)");
    expect(screen).toContain("Loading");
  });

  it("j/k move the cursor, and only Enter opens the preview", async () => {
    const { t, footer } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey("j");
    t.mockInput.pressKey("j");
    await t.flush();
    expect(await footer()).toContain("3/6");

    t.mockInput.pressEnter();
    const screen = await until(t, (f) => f.includes(SUBJECT_3));
    expect(screen).toContain("Morning Brew <crew@morningbrew.com>");
  });

  it("clicking a row opens that mail", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    await t.mockMouse.click(10, 11); // fourth row (rows 10-12)

    await until(t, (f) => f.includes("Bytes #412: the one about signals"));
  });

  it("truncates long subjects with an ellipsis", async () => {
    const { t } = await startAll();
    const screen = await until(t, (f) => f.includes("Inbox (6)"));

    expect(screen).toMatch(/How the best product teams run the…/);
  });

  it("keeps the cursor in view while moving down a long list", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `row-${i}`,
      from: `Sender ${i} <s${i}@example.com>`,
      subject: `Message number ${i}`,
      receivedAt: NOW,
      labels: [],
      text: "body",
    }));
    const { t } = await startAll(
      { messages: many },
      { width: 110, height: 16 },
    );
    await until(t, (f) => f.includes("Inbox (40)")); // wait for the whole stream

    t.mockInput.pressKey("G");

    await until(t, (f) => f.includes("Message number 39"));
  });

  it("g and G jump to the first and last mail", async () => {
    const { t, footer } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey("G");
    await t.flush();
    expect(await footer()).toContain("6/6");

    t.mockInput.pressKey("g");
    await t.flush();
    expect(await footer()).toContain("1/6");
  });

  it("q quits and fires onExit exactly once", async () => {
    const { t, exits } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey("q");
    await t.flush();

    expect(exits()).toBe(1);
  });
});

describe("TUI — preview and labels", () => {
  it("shows the labels under the subject", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter(); // the first mail: labels inbox, unread, newsletter
    const screen = await until(t, (f) => f.includes(SUBJECT_1));

    expect(screen).toContain("Labels");
    expect(screen).toContain("unread  ·  inbox  ·  newsletter");
    const subject = screen.indexOf(SUBJECT_1);
    const labels = screen.indexOf("Labels");
    expect(labels).toBeGreaterThan(subject);
  });

  it("shows the message text when summaries are off", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();

    const screen = await until(t, (f) => f.includes("Paragraph 1."));
    expect(screen).not.toContain("Summary:");
  });

  it("provides Summarize, Mark as read and Delete buttons", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();

    const screen = await until(t, (f) => f.includes("Mark as read"));

    expect(screen).toContain("Summarize");
    expect(screen).toContain("Delete");
  });
});

/** One message whose body is the given markdown. */
const markdownMail = (text: string) => [
  {
    id: "1",
    from: "Stratechery <email@stratechery.com>",
    subject: "Aggregators and the long tail of attention",
    receivedAt: NOW,
    labels: ["unread", "inbox"],
    text,
  },
];

describe("TUI — the message is markdown", () => {
  it("draws the markdown rather than its source", async () => {
    const { t } = await start({
      messages: markdownMail(
        [
          "# The aggregator question",
          "",
          "Ben writes that **aggregators** own demand.",
          "",
          "Read [the full article](https://stratechery.com/aggregators) now.",
        ].join("\n"),
      ),
    });
    await until(t, (f) => f.includes("Unread (1)"));
    t.mockInput.pressEnter();

    const screen = await until(t, (f) => f.includes("The aggregator question"));

    // Markers are concealed: no `#`, no `**`, no `[](url)`.
    expect(screen).not.toContain("#");
    expect(screen).not.toContain("**");
    expect(screen).not.toContain("](");
    // The link keeps its label, and the address is shown beside it.
    expect(screen).toContain("the full article");
    expect(screen).toContain("https://stratechery.com/aggregators");
  });

  it("draws a markdown heading in bold", async () => {
    const { t } = await start({
      messages: markdownMail("# The aggregator question\n\nBody text."),
    });
    await until(t, (f) => f.includes("Unread (1)"));
    t.mockInput.pressEnter();
    const screen = await until(t, (f) => f.includes("The aggregator question"));

    const headingLine = screen
      .split("\n")
      .findIndex((l) => l.includes("The aggregator question"));
    const spans = t.captureSpans() as unknown as {
      lines: Array<{ spans: Array<{ text: string; attributes: number }> }>;
    };
    const headingSpan = spans.lines[headingLine]?.spans.find((span) =>
      span.text.includes("The aggregator question"),
    );

    expect(headingSpan?.attributes).toBe(1); // 1 is bold in OpenTUI
  });

  it("draws pictures in the message the way a summary draws them", async () => {
    // A local file, so the test never reaches the network for its pixels. Wide
    // and short, so the picture and the prose around it all fit on screen.
    const picture = writeTinyPng(200, 20);
    const { t } = await start({
      messages: markdownMail(
        [
          "Before the picture.",
          `![Chart of growth](${picture})`,
          "After the picture.",
        ].join("\n\n"),
      ),
    });
    await until(t, (f) => f.includes("Unread (1)"));
    t.mockInput.pressEnter();

    // Blocks appear once the picture has loaded, the prose once the markdown
    // parser has run; wait for both.
    const screen = await until(
      t,
      (f) =>
        /[▀▄█]/.test(f) &&
        f.includes("Before the picture.") &&
        f.includes("After the picture."),
      5000,
    );

    // The picture came out of the markdown, into a block of its own.
    expect(screen).not.toContain("![");
    expect(screen).toContain("image: ");
    expect(picture).toContain("sift-image-");
    expect(screen).not.toContain("couldn't load");

    // Centred in the pane, the way a summary's picture is: only the preview half
    // of the row is measured, and the space either side is compared.
    const previewOf = (line: string) =>
      line.slice(line.lastIndexOf("││") + 2, -1);
    const row = previewOf(
      screen.split("\n").find((line) => /[▀▄█]/.test(line))!,
    );
    const drawn = row.match(/[▀▄█]+/)![0];
    const left = row.indexOf(drawn);
    const right = row.length - (left + drawn.length);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2);
  });

  it("says so when a picture in the message cannot be loaded", async () => {
    const { t } = await start({
      messages: markdownMail(
        "Text.\n\n![Missing](https://127.0.0.1:9/nothing.png)\n\nMore text.",
      ),
    });
    await until(t, (f) => f.includes("Unread (1)"));
    t.mockInput.pressEnter();

    const screen = await until(
      t,
      (f) => f.includes("couldn't load") && f.includes("More text."),
      5000,
    );

    expect(screen).toContain("image: https://127.0.0.1:9/nothing.png");
  });

  it("keeps a plain note literal instead of reading it as markdown", async () => {
    // A failure message is shown as written: `*` and `_` are punctuation here,
    // not emphasis.
    const { t } = await start({ failGet: "a *b* and _c_ broke" });
    await until(t, (f) => f.includes("Unread (2)"));
    t.mockInput.pressEnter();

    const screen = await until(t, (f) =>
      f.includes("Couldn't load this message."),
    );

    expect(screen).toContain("a *b* and _c_ broke");
  });
});

describe("TUI — summaries", () => {
  it("the Summarize button streams a summary into the viewer", async () => {
    const { t, calls } = await startAll({ config: { summarize: false } });
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes("Paragraph 1."));

    await clickText(t, "Summarize");

    await until(t, (f) => f.includes(SUMMARY_TEXT));
    expect(calls.summaries).toBe(1);
    expect(t.captureCharFrame()).toContain("Show text");
  });

  it("s switches between the summary and the text, reusing a finished summary", async () => {
    const { t, calls } = await startAll({ config: { summarize: false } });
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes("Paragraph 1."));
    t.mockInput.pressKey("l"); // s works from the preview

    t.mockInput.pressKey("s");
    await until(t, (f) => f.includes(SUMMARY_TEXT));

    t.mockInput.pressKey("s");
    await until(t, (f) => f.includes("Paragraph 1."));

    t.mockInput.pressKey("s");
    await until(t, (f) => f.includes(SUMMARY_TEXT));
    expect(calls.summaries).toBe(1);
  });

  it("renders the summary's JSON as a title and text, not as the document", async () => {
    // The model streams a JSON document; the pane must show a summary, not the
    // document with its braces and keys.
    const summaryChunks = [
      '{"title":"Aggregators",',
      '"content":[{"type":"text","text":"The piece argues that "},',
      '{"type":"text","text":"aggregators capture demand."}',
    ];
    const { t } = await startAll({
      config: { summarize: true },
      summaryChunks,
    });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();

    const screen = await until(t, (f) =>
      f.includes("aggregators capture demand."),
    );

    expect(screen).toContain("Aggregators");
    expect(screen).toContain("The piece argues that");
    expect(screen).not.toContain('"type"');
    expect(screen).not.toContain('"content"');
    expect(screen).not.toContain("LINK_");
  });

  it("emphasises the summary title and separates it from the text", async () => {
    const summaryChunks = [
      '{"title":"Quarterly review",',
      '"content":[{"type":"text","text":"The piece argues it."}]}',
    ];
    const { t } = await startAll({
      config: { summarize: true },
      summaryChunks,
    });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();
    const screen = await until(t, (f) => f.includes("Quarterly review"));
    const lines = screen.split("\n");

    // The title is bold; the body text is not.
    const titleLine = lines.findIndex((line) =>
      line.includes("Quarterly review"),
    );
    const spans = t.captureSpans() as unknown as {
      lines: Array<{ spans: Array<{ text: string; attributes: number }> }>;
    };
    const titleSpan = spans.lines[titleLine]?.spans.find((span) =>
      span.text.includes("Quarterly review"),
    );

    expect(titleSpan?.attributes).toBe(1); // 1 is bold in OpenTUI

    // One blank row, then the paragraph: sections are told apart without air.
    // Each frame row spans both panes, so only the preview half is read.
    const previewOf = (line: string) =>
      line.slice(line.lastIndexOf("││") + 2, -1);
    expect(previewOf(lines[titleLine + 1]!).trim()).toBe("");
    expect(previewOf(lines[titleLine + 2]!)).toContain("The piece argues it.");
  });

  it("draws a summary picture, captioned with its address", async () => {
    // A local file, so the test never reaches the network for its pixels.
    const picture = writeTinyPng(200, 20);
    const summaryChunks = [
      '{"title":"Aggregators",',
      '"content":[{"type":"text","text":"The piece argues it."},',
      `,${JSON.stringify({ type: "image", url: picture })}]}`, // the address JSON-escapes
    ];

    const { t } = await startAll({
      config: { summarize: true },
      summaryChunks,
    });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();

    // Block characters appear only once the picture has loaded and been drawn,
    // so waiting for them is what proves it rendered.
    const screen = await until(t, (f) => /[▀▄█]/.test(f), 5000);

    expect(screen).toContain("Aggregators");
    expect(screen).toContain("The piece argues it.");
    // The address is captioned under the picture. It is long, so it wraps: the
    // pane border sits between the pieces of it.
    expect(screen).toContain("image: ");
    expect(screen).toContain("picture");
    expect(picture).toContain("sift-image-");
    expect(screen).not.toContain("couldn't load");
    expect(screen).not.toContain('"type"');
  });

  it("grows summary pictures when the terminal gets taller", async () => {
    // A square picture: the taller the terminal, the more rows it may use, and
    // so the wider it is drawn. A wide picture would be capped by width and
    // never move.
    const picture = writeTinyPng(200, 200);
    const summaryChunks = [
      `{"title":"Aggregators","content":[${JSON.stringify({ type: "image", url: picture })}]}`,
    ];

    const { t } = await startAll(
      { config: { summarize: true }, summaryChunks },
      { width: 110, height: 24 },
    );
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    await until(t, (f) => /[▀▄█]/.test(f), 5000);

    /** The widest run of block characters: how wide the picture was drawn. */
    const pictureWidth = (frame: string) => {
      let widest = 0;
      for (const line of frame.split("\n")) {
        for (const run of line.match(/[▀▄█]+/g) ?? []) {
          widest = Math.max(widest, run.length);
        }
      }
      return widest;
    };

    const short = pictureWidth(t.captureCharFrame());
    expect(short).toBeGreaterThan(0);

    // Never wider than three quarters of the screen either way.
    expect(short).toBeLessThanOrEqual(Math.floor(110 * 0.75));

    t.resize(110, 48);
    await t.flush();
    const tall = await until(t, (f) => pictureWidth(f) > short, 3000);
    expect(pictureWidth(tall)).toBeGreaterThan(short);

    // And back down again when the window shrinks: the fit is not one-way.
    t.resize(110, 24);
    await t.flush();
    const back = await until(
      t,
      (f) => pictureWidth(f) < pictureWidth(tall),
      3000,
    );
    expect(pictureWidth(back)).toBe(short);
  });

  it("summarises straight away on open when summarize is on", async () => {
    const { t } = await startAll({ config: { summarize: true } });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();

    await until(t, (f) => f.includes(SUMMARY_TEXT));
    expect(t.captureCharFrame()).toContain("Show text");
  });

  it("shows an error with a retry hint when summarising fails", async () => {
    const { t } = await startAll({
      config: { summarize: true },
      failSummary: "model down",
    });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();

    const screen = await until(t, (f) =>
      f.includes("Couldn't summarize this message."),
    );
    expect(screen).toContain("model down");
    expect(screen).toContain("Press s to try again.");
  });
});

describe("TUI — reading state", () => {
  it("marks the mail read on open when mark-as-read is on", async () => {
    const { t, calls } = await startAll({ config: { markAsRead: true } });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter(); // the first mail is unread

    await until(t, (f) => !f.includes("● The Pragmatic Engineer"));
    expect(calls.labels).toEqual([
      { id: "1", addLabels: undefined, removeLabels: "unread" },
    ]);
  });

  it("leaves unread mail alone on open when mark-as-read is off", async () => {
    const { t, calls } = await startAll({ config: { markAsRead: false } });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();
    await until(t, (f) => f.includes("Paragraph 1."));

    expect(calls.labels).toEqual([]);
    expect(t.captureCharFrame()).toContain("● The Pragmatic Engineer");
  });

  it("the Mark as read button marks the open mail read", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressKey("j");
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_2));

    await clickText(t, "Mark as read");

    await until(t, (f) => f.includes("Mark as unread"));
    expect(calls.labels.map((l) => l.id)).toEqual(["2"]);
  });

  it("the read button toggles a mail between read and unread", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter(); // the first mail, unread
    await until(t, (f) => f.includes(SUBJECT_1));

    await clickText(t, "Mark as read");
    await until(t, (f) => f.includes("Mark as unread"));
    expect(calls.labels.at(-1)).toEqual({
      id: "1",
      addLabels: undefined,
      removeLabels: "unread",
    });

    await clickText(t, "Mark as unread");
    await until(t, (f) => f.includes("Mark as read"));
    expect(calls.labels.at(-1)).toEqual({
      id: "1",
      addLabels: "unread",
      removeLabels: undefined,
    });
    expect(t.captureCharFrame()).toContain("● The Pragmatic Engineer");
  });

  it("m marks the highlighted mail read from the list", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressKey("j");

    t.mockInput.pressKey("m");

    await until(t, () => calls.labels.length === 1);
    expect(calls.labels[0]?.id).toBe("2");
  });

  it("m flips the highlighted mail, read then unread again", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey("m");
    await until(t, () => calls.labels.length === 1);
    t.mockInput.pressKey("m");
    await until(t, () => calls.labels.length === 2);

    expect(calls.labels.map((l) => l.addLabels)).toEqual([undefined, "unread"]);
  });

  it("a failed mark-as-read shows a notice and keeps the mail unread", async () => {
    const { t } = await startAll({ failLabel: "network down" });
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressKey("j");
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_2));

    await clickText(t, "Mark as read");

    const screen = await until(t, (f) => f.includes("Couldn't mark as read"));
    expect(screen).toContain("network down");
    expect(screen).toContain("● Stratechery");
  });
});

describe("TUI — unread filter", () => {
  it("starts on unread mail, not all", async () => {
    const { t, calls } = await start();

    await until(t, (f) => f.includes("Unread (2)"));

    expect(t.captureCharFrame()).not.toContain(SUBJECT_3);
    expect(calls.lists[0]).toEqual({ labels: ["unread"] });
  });

  it("u shows only unread mail, and u again shows everything", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey("u");

    await until(t, (f) => f.includes("Unread (2)"));
    expect(t.captureCharFrame()).not.toContain(SUBJECT_3);
    expect(calls.lists.at(-1)).toEqual({ labels: ["unread"] });

    t.mockInput.pressKey("u");
    await until(t, (f) => f.includes("Inbox (6)"));
  });

  it("the All / Unread control switches the filter with the mouse", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    await clickText(t, "Unread");

    await until(t, (f) => f.includes("Unread (2)"));
  });

  it("says so when no unread mail is left", async () => {
    const { t } = await start({
      messages: createMockMessages(NOW).map((m) => ({
        ...m,
        labels: ["inbox"],
      })),
    });

    await until(t, (f) => f.includes("No unread mail."));
  });
});

describe("TUI — refresh", () => {
  it("r asks the core for the mail again", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    const before = calls.lists.length;

    t.mockInput.pressKey("r");

    await until(t, () => calls.lists.length === before + 1);
    await until(t, (f) => f.includes("Inbox (6)"));
  });
});

describe("TUI — delete", () => {
  it("d asks for confirmation, and n keeps the mail", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    t.mockInput.pressKey("l");

    t.mockInput.pressKey("d");
    await until(t, (f) => f.includes("Delete this message?"));

    t.mockInput.pressKey("n");

    await until(t, (f) => !f.includes("Delete this message?"));
    expect(calls.deleted).toEqual([]);
    expect(t.captureCharFrame()).toContain("Inbox (6)");
  });

  it("y deletes the open mail after confirmation", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    t.mockInput.pressKey("l");

    t.mockInput.pressKey("d");
    t.mockInput.pressKey("y");

    await until(t, (f) => f.includes("Inbox (5)"));
    expect(calls.deleted).toEqual(["1"]);
    expect(t.captureCharFrame()).not.toContain(SUBJECT_1);
  });

  it("the Delete and Cancel buttons work with the mouse", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();

    await clickText(t, "Delete");
    await until(t, (f) => f.includes("Delete this message?"));
    await clickText(t, "Cancel");
    await until(t, (f) => !f.includes("Delete this message?"));
    expect(calls.deleted).toEqual([]);

    await clickText(t, "Delete");
    await until(t, (f) => f.includes("Delete this message?"));
    await clickText(t, "Yes, delete");
    await until(t, (f) => f.includes("Inbox (5)"));
    expect(calls.deleted).toEqual(["1"]);
  });

  it("a failed delete shows a notice and keeps the mail", async () => {
    const { t } = await startAll({ failDelete: "already gone" });
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    t.mockInput.pressKey("l");
    t.mockInput.pressKey("d");
    t.mockInput.pressKey("y");

    const screen = await until(t, (f) => f.includes("Couldn't delete"));
    expect(screen).toContain("already gone");
    expect(screen).toContain("Inbox (6)");
  });
});

describe("TUI — data states", () => {
  it("shows an error from the stream and r retries", async () => {
    const { t } = await start({ failList: "401 Unauthorized" });

    const screen = await until(t, (f) =>
      f.includes("Couldn't load your mail."),
    );

    expect(screen).toContain("401 Unauthorized");
    expect(screen).toContain("Press r to try again.");
  });
});

describe("TUI — mouse filter and layout (split)", () => {
  it("opens a mail when a row is clicked, and the mouse list stays responsive", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    await t.mockMouse.click(10, 5); // second row (rows 5-7)
    await until(t, (f) => f.includes(SUBJECT_2));
  });

  /** The column where the two panes' borders meet (`││`). */
  const dividerColumn = (frame: string): number => {
    const line = frame.split("\n").find((l) => l.includes("││"));
    if (line === undefined) throw new Error(`no pane divider in:\n${frame}`);
    return line.indexOf("││");
  };

  it("widens and narrows the list by dragging the divider", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    const before = dividerColumn(t.captureCharFrame());

    await t.mockMouse.drag(before, 8, before + 12, 8);
    await t.flush();
    const wider = dividerColumn(t.captureCharFrame());
    expect(wider).toBeGreaterThan(before);

    await t.mockMouse.drag(wider, 8, wider - 8, 8);
    await t.flush();
    expect(dividerColumn(t.captureCharFrame())).toBeLessThan(wider);
  });

  it("keeps both panes usable when the divider is dragged far", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    const before = dividerColumn(t.captureCharFrame());

    // Drag hard right: the list stops at 60% of the terminal, not at the edge.
    await t.mockMouse.drag(before, 8, 105, 8);
    await t.flush();
    const wide = dividerColumn(t.captureCharFrame());
    expect(wide).toBeLessThanOrEqual(Math.floor(110 * 0.6));
    expect(wide).toBeGreaterThan(before);

    // Drag hard left: the preview keeps a readable minimum, so the list stops
    // well short of the screen edge.
    await t.mockMouse.drag(wide, 8, 0, 8);
    await t.flush();
    const narrow = dividerColumn(t.captureCharFrame());
    expect(narrow).toBeGreaterThanOrEqual(29); // listWidth 30, border at 29
    expect(narrow).toBeLessThan(wide);
  });

  it("keeps a dragged width when the terminal is resized", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    const before = dividerColumn(t.captureCharFrame());

    await t.mockMouse.drag(before, 8, before + 12, 8);
    await t.flush();
    const dragged = dividerColumn(t.captureCharFrame());
    expect(dragged).toBeGreaterThan(before);

    // A resize keeps the width the user chose instead of snapping back to 36%.
    t.resize(130, 24);
    const resized = await until(t, (f) => f.includes("Inbox (6)"));
    expect(dividerColumn(resized)).toBe(dragged);
  });

  it("leaves the split alone when the drag starts away from the divider", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    const before = dividerColumn(t.captureCharFrame());

    // Starting in the preview and sweeping left is a text selection sort of
    // drag, not a resize: the split must not move.
    await t.mockMouse.drag(80, 5, 40, 5);
    await t.flush();
    expect(dividerColumn(t.captureCharFrame())).toBe(before);
  });

  /** The row of the grip: the middle of the panes area. */
  const gripRow = (height: number) => Math.floor((height - 1) / 2);

  it("shows a grip centred on both border columns", async () => {
    const { t } = await startAll({}, { width: 110, height: 24 });
    const screen = await until(t, (f) => f.includes("Inbox (6)"));

    const lines = screen.split("\n");
    const row = lines[gripRow(24)]!;
    const column = dividerColumn(screen);

    // The divider is two columns, so the mark is two half blocks: the right half
    // of the left border and the left half of the right one. Together they sit
    // exactly on the seam between the panes.
    expect(row[column]).toBe("|");
    expect(row[column + 1]).toBe("|");
    // Only one row: the borders above and below stay plain.
    expect(lines[gripRow(24) - 1]![column]).toBe("│");
    expect(lines[gripRow(24) + 1]![column]).toBe("│");
    expect(lines[gripRow(24) - 1]![column + 1]).toBe("│");
  });

  it("moves the divider with > and <", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));
    const before = dividerColumn(t.captureCharFrame());

    t.mockInput.pressKey(">");
    await t.flush();
    const wider = dividerColumn(t.captureCharFrame());
    expect(wider).toBe(before + DIVIDER_STEP);

    t.mockInput.pressKey("<");
    await t.flush();
    expect(dividerColumn(t.captureCharFrame())).toBe(before);
  });

  it("moves the grip with the divider", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey(">");
    await t.flush();

    const frame = t.captureCharFrame();
    const row = frame.split("\n")[gripRow(24)]!;
    expect(row.slice(dividerColumn(frame), dividerColumn(frame) + 2)).toBe(
      "||",
    );
  });

  it("stops the keys at the same limits as a drag", async () => {
    const { t } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    for (let i = 0; i < 40; i++) t.mockInput.pressKey(">");
    await t.flush();
    const wide = dividerColumn(t.captureCharFrame());
    expect(wide).toBeLessThanOrEqual(Math.floor(110 * 0.6));

    for (let i = 0; i < 40; i++) t.mockInput.pressKey("<");
    await t.flush();
    expect(dividerColumn(t.captureCharFrame())).toBeGreaterThanOrEqual(29);
  });
});

describe("TUI — the picture overlay", () => {
  /** Open the first mail with a picture in its body, and click the picture. */
  async function openPicture(text?: string) {
    const picture = writeTinyPng(200, 120);
    const harness = await start({
      messages: markdownMail(
        text ?? `Before.\n\n![A chart](${picture})\n\nAfter.`,
      ),
    });
    await until(harness.t, (f) => f.includes("Unread (1)"));
    harness.t.mockInput.pressEnter();
    await until(harness.t, (f) => f.includes("Before."));
    await clickPicture(harness.t);
    return { ...harness, picture };
  }

  it("opens on its own when the picture is clicked", async () => {
    const { t } = await openPicture();

    const screen = await until(t, (f) => f.includes("esc close"));

    expect(screen).toContain("100%");
    expect(screen).toContain("×");
    // Drawn much larger than in the pane, with no frame of its own.
    const row = screen.split("\n").find((l) => /[▀▄█]{5,}/.test(l))!;
    expect(/[▀▄█]+/.exec(row)![0].length).toBeGreaterThan(40);
  });

  it("leaves the mail readable behind the picture", async () => {
    // A wide, shallow picture, so the picture floats over the middle of the mail
    // and the mail stays visible around it.
    const flat = writeTinyPng(200, 20);
    const { t } = await openPicture(`Before.\n\n![A chart](${flat})\n\nAfter.`);
    const screen = await until(t, (f) => f.includes("esc close"));

    // The overlay paints no background of its own: the mail shows through.
    expect(screen).toContain("Summarize");
    expect(screen).toContain("After.");
    expect(screen).toContain("image: "); // the pane's own caption
    expect(screen).toContain("unread · 1/1"); // and the footer, behind the hint
    // …and the picture is drawn over it.
    expect(/[▀▄█]{5,}/.test(screen)).toBe(true);
  });

  it("veils the mail with a translucent layer instead of covering it", async () => {
    // A wide, shallow picture: most of the pane stays free for the mail behind
    // the veil, so its colours can be read.
    const flat = writeTinyPng(200, 20);
    const { t } = await start({
      messages: markdownMail(`Before.\n\n![A chart](${flat})\n\nAfter.`),
    });
    await until(t, (f) => f.includes("Unread (1)"));
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes("Before."));

    const pane = hexToChannel(theme.surface);
    const veil = hexToChannel(theme.bg);
    const before = bgAt(t, 60, 20)[0]!;
    expect(before).toBe(pane);

    await clickPicture(t);
    await until(t, (f) => f.includes("esc close"));
    const after = bgAt(t, 60, 20)[0]!;

    // Darker than the pane, but not the veil's own colour: the terminal blended
    // the two, which is what makes the layer see-through.
    expect(after).toBeLessThan(pane);
    expect(after).toBeGreaterThan(veil);
  });

  it("puts the close button in the extreme top right corner", async () => {
    const { t } = await openPicture();
    const screen = await until(t, (f) => f.includes("esc close"));

    const lines = screen.split("\n");
    // A square button around the cross — one space either side — flush with the
    // top right of the screen.
    expect(lines[0]!.endsWith("┌───┐")).toBe(true);
    expect(lines[1]!.endsWith("│ × │")).toBe(true);
    expect(lines[2]!.endsWith("└───┘")).toBe(true);
  });

  it("zooms with ctrl+wheel and moves sideways with shift+wheel", async () => {
    // A wide picture: once zoomed, all of its overflow is horizontal, so a
    // sideways gesture is the only one that changes what is on screen.
    const flat = writeTinyPng(2000, 200);
    const { t } = await openPicture(`Before.\n\n![A chart](${flat})\n\nAfter.`);
    await until(t, (f) => f.includes("100%"));

    // Ctrl+wheel is the gesture for zooming.
    await t.mockMouse.scroll(20, 5, "up", { modifiers: { ctrl: true } });
    await until(t, (f) => f.includes("150%"));
    await t.mockMouse.scroll(20, 5, "down", { modifiers: { ctrl: true } });
    await until(t, (f) => f.includes("100%"));

    t.mockInput.pressKey("=");
    t.mockInput.pressKey("=");
    await until(t, (f) => f.includes("200%"));

    // There is nothing above or below to reach: a plain wheel does nothing…
    const before = pictureCells(t);
    await t.mockMouse.scroll(20, 5, "down");
    await t.flush();
    expect(pictureCells(t)).toEqual(before);

    // …and Shift+wheel moves along the picture.
    await t.mockMouse.scroll(20, 5, "down", { modifiers: { shift: true } });
    await t.flush();
    expect(pictureCells(t)).not.toEqual(before);
  });

  it("zooms in with = and back out with -", async () => {
    const { t } = await openPicture();
    await until(t, (f) => f.includes("100%"));

    t.mockInput.pressKey("=");
    await until(t, (f) => f.includes("150%"));

    t.mockInput.pressKey("=");
    await until(t, (f) => f.includes("200%"));

    t.mockInput.pressKey("-");
    await until(t, (f) => f.includes("150%"));

    // `0` puts it back to the whole picture.
    t.mockInput.pressKey("0");
    await until(t, (f) => f.includes("100%"));
  });

  it("moves the picture with h/l and the arrows", async () => {
    const { t } = await openPicture();
    await until(t, (f) => f.includes("100%"));

    // Zoomed in, the picture is bigger than the window, so there is something
    // to move to: the colours at a given cell change.
    t.mockInput.pressKey("=");
    t.mockInput.pressKey("=");
    await until(t, (f) => f.includes("200%"));

    const before = pictureCells(t);
    t.mockInput.pressKey("l");
    t.mockInput.pressKey("l");
    await t.flush();
    const moved = pictureCells(t);
    expect(moved).not.toEqual(before);

    // The opposite keys bring the same part back.
    t.mockInput.pressKey("h");
    t.mockInput.pressKey("h");
    await t.flush();
    expect(pictureCells(t)).toEqual(before);
  });

  it("pans with the wheel", async () => {
    const { t } = await openPicture();
    await until(t, (f) => f.includes("100%"));
    t.mockInput.pressKey("=");
    t.mockInput.pressKey("=");
    await until(t, (f) => f.includes("200%"));

    const before = pictureCells(t);
    await t.mockMouse.scroll(20, 5, "down");
    await t.flush();

    expect(pictureCells(t)).not.toEqual(before);
  });

  it("closes on the cross, on esc and on q", async () => {
    const { t } = await openPicture();
    await until(t, (f) => f.includes("esc close"));

    // The cross is in the top right corner of the picture: click it.
    await clickText(t, "×");
    await until(t, (f) => f.includes("Before."));
    expect(t.captureCharFrame()).not.toContain("esc close");

    await clickPicture(t);
    await until(t, (f) => f.includes("esc close"));
    t.mockInput.pressEscape();
    await sleep(150); // Esc is told apart from escape sequences after a delay
    await until(t, (f) => f.includes("Before."));

    await clickPicture(t);
    await until(t, (f) => f.includes("esc close"));
    t.mockInput.pressKey("q");
    await until(t, (f) => f.includes("Before."));
  });

  it("opens the picture of a summary the same way", async () => {
    const picture = writeTinyPng(200, 120);
    const summaryChunks = [
      JSON.stringify({
        title: "Aggregators",
        content: [
          { type: "text", text: "The piece argues it." },
          { type: "image", url: picture },
        ],
      }),
    ];
    const { t } = await start({ config: { summarize: true }, summaryChunks });
    await until(t, (f) => f.includes("Unread (2)"));
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes("The piece argues it."));

    await clickPicture(t);
    const screen = await until(t, (f) => f.includes("esc close"));

    expect(screen).toContain("×");
    expect(screen).not.toContain("The piece argues it.");
  });
});

describe("TUI — bodies are fetched only when a message is opened", () => {
  it("builds the list without fetching a single body", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    expect(calls.fetched).toEqual([]);
  });

  it("fetches exactly the message that is opened", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressKey("j");
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_2));

    expect(calls.fetched).toEqual(["2"]);
  });

  it("does not fetch a body it already has", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_1));

    t.mockInput.pressKey("j");
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_2));

    // Back to the first message: its body is already here.
    t.mockInput.pressKey("k");
    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_1));

    expect(calls.fetched).toEqual(["1", "2"]);
  });

  it("fetches the body again after a reload", async () => {
    const { t, calls } = await startAll();
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_1));
    expect(calls.fetched).toEqual(["1"]);

    // A reload drops the cached body, so the server's copy is what is shown.
    t.mockInput.pressKey("r");
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();
    await until(t, (f) => f.includes(SUBJECT_1));
    expect(calls.fetched).toEqual(["1", "1"]);
  });

  it("reports a body that could not be fetched", async () => {
    const { t } = await startAll({ failGet: "network down" });
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();

    const screen = await until(t, (f) =>
      f.includes("Couldn't load this message."),
    );
    expect(screen).toContain("network down");
  });
});

describe("TUI — account", () => {
  it("shows the username and address in the footer", async () => {
    const { t } = await startAll({
      inbox: { email: "rijulpaul@agentmail.to", displayName: "Rijul" },
    });

    const screen = await until(t, (f) =>
      f.includes("Rijul · rijulpaul@agentmail.to"),
    );

    expect(screen).toContain("Rijul · rijulpaul@agentmail.to");
  });

  it("leaves the account out when the footer is too narrow", async () => {
    const { t } = await startAll({}, { width: 60, height: 14 });

    const screen = await until(t, (f) => f.includes("Inbox (6)"));

    expect(screen).not.toContain("news@example.com");
    expect(screen).toContain("enter");
  });
});

describe("TUI — stacked layout", () => {
  const narrow = { width: 60, height: 14 };

  it("shows only the list until a mail is opened", async () => {
    const { t } = await startAll({}, narrow);
    const screen = await until(t, (f) => f.includes("Inbox (6)"));

    expect(screen).not.toContain("Message");
  });

  it("Enter shows the preview alone and Esc goes back to the list", async () => {
    const { t } = await startAll({}, narrow);
    await until(t, (f) => f.includes("Inbox (6)"));

    t.mockInput.pressEnter();
    let screen = await until(t, (f) => f.includes("Message"));
    expect(screen).not.toContain("Inbox (6)");

    t.mockInput.pressEscape();
    await sleep(150); // Esc is told apart from escape sequences after a short delay
    screen = await until(t, (f) => f.includes("Inbox (6)"));
    expect(screen).toBeDefined();
  });

  it("keeps one full-width pane when dragged in the stacked layout", async () => {
    const { t } = await startAll({}, narrow);
    await until(t, (f) => f.includes("Inbox (6)"));

    // Stacked layout has no divider, so dragging across the list must not leave
    // the pane split or narrowed.
    await t.mockMouse.drag(5, 8, 40, 8);
    await t.flush();
    t.mockInput.pressEscape(); // the drag may have opened a mail; go back
    await sleep(150);

    const screen = await until(t, (f) => f.includes("Inbox (6)"));
    expect(screen).not.toContain("││");
    // No divider means no grip either.
    expect(screen).not.toContain("||");
    // The one visible pane still spans the whole terminal.
    expect(screen.split("\n")[0]!.length).toBe(narrow.width);
  });

  it("switches layout live when the terminal is resized", async () => {
    const { t } = await startAll({}, narrow);
    await until(t, (f) => f.includes("Inbox (6)"));
    t.mockInput.pressEnter();
    await t.flush();

    t.resize(110, 14);
    const wide = await until(
      t,
      (f) => f.includes("Inbox (6)") && f.includes("Message"),
    );
    expect(wide).toContain("Message");
    // Split again means the grip is back.
    expect(wide).toContain("||");

    t.resize(60, 14);
    await t.flush();
    const narrowFrame = t.captureCharFrame();
    expect(narrowFrame.split("\n")[0]).toMatch(/Message|Inbox/);
    expect(narrowFrame).not.toContain("▐");
  });
});
