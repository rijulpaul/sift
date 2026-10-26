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
import {
  createMockCore,
  createMockMessages,
  type MockCoreOptions,
} from "../../cli/mock";
import type { SiftCore } from "../../core";

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

    t.resize(60, 14);
    await t.flush();
    expect(t.captureCharFrame().split("\n")[0]).toMatch(/Message|Inbox/);
  });
});
