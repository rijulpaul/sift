import { describe, expect, it } from "vitest";

import {
  Store,
  initialState,
  openMail,
  reducer,
  type Action,
  type State,
} from "../../cli/state";
import type { MailSummary } from "../../cli/types";

const mail = (id: string, extra: Partial<MailSummary> = {}): MailSummary => ({
  id,
  from: `${id}@x.io`,
  subject: `subject ${id}`,
  receivedAt: new Date(2024, 0, 1),
  labels: [],
  unread: false,
  text: `text ${id}`,
  content: { content: `text ${id}`, links: {} },
  ...extra,
});

const run = (state: State, ...actions: Action[]) =>
  actions.reduce(reducer, state);

/** A state with mails a, b, c already streamed in and the load finished. */
const loaded = (layout: "split" | "stacked" = "split", ids = ["a", "b", "c"]) =>
  run(
    initialState(layout),
    { type: "loadStart", filter: "all" },
    ...ids.map((id) => ({ type: "mailArrived" as const, mail: mail(id) })),
    { type: "loaded" },
  );

describe("startup", () => {
  it("starts on the unread filter, not all", () => {
    expect(initialState("split").filter).toBe("unread");
  });
});

describe("loading", () => {
  it("starts loading with no mail", () => {
    const state = initialState("split");
    expect(state.status).toEqual({ kind: "loading" });
    expect(state.mails).toEqual([]);
  });

  it("appends mail as it streams in, in arrival order", () => {
    const state = run(
      initialState("split"),
      { type: "loadStart", filter: "all" },
      { type: "mailArrived", mail: mail("a") },
      { type: "mailArrived", mail: mail("b") },
    );
    expect(state.mails.map((m) => m.id)).toEqual(["a", "b"]);
    expect(state.status.kind).toBe("loading");
  });

  it("becomes ready when the stream ends", () => {
    expect(loaded().status).toEqual({ kind: "ready" });
  });

  it("replaces a mail that arrives twice instead of duplicating it", () => {
    const state = run(loaded(), {
      type: "mailArrived",
      mail: mail("b", { subject: "newer" }),
    });
    expect(state.mails).toHaveLength(3);
    expect(state.mails[1]?.subject).toBe("newer");
  });

  it("keeps what arrived when the stream fails", () => {
    const state = run(
      initialState("split"),
      { type: "loadStart", filter: "all" },
      { type: "mailArrived", mail: mail("a") },
      { type: "loadFailed", message: "offline" },
    );
    expect(state.status).toEqual({ kind: "error", message: "offline" });
    expect(state.mails).toHaveLength(1);
  });

  it("a full reload clears the list and closes the preview", () => {
    const opened = run(loaded(), { type: "open", index: 1, showSummary: true });
    const reloaded = run(opened, { type: "loadStart", filter: "all" });

    expect(reloaded.mails).toEqual([]);
    expect(reloaded.openId).toBeNull();
    expect(reloaded.showSummary).toBe(false);
    expect(reloaded.focus).toBe("list");
  });

  it("a reload keeps the summaries, which belong to the message ids", () => {
    const summarised = run(
      loaded(),
      { type: "summaryStart", id: "a" },
      { type: "summaryChunk", id: "a", chunk: "hi" },
      { type: "summaryDone", id: "a" },
    );
    const reloaded = run(summarised, { type: "loadStart", filter: "all" });

    expect(reloaded.summaries.a).toEqual({ status: "done", text: "hi" });
  });

  it("records the filter the load was started with", () => {
    const state = run(loaded(), { type: "loadStart", filter: "unread" });
    expect(state.filter).toBe("unread");
  });
});

describe("cursor", () => {
  it("moves and clamps at both ends", () => {
    let state = loaded();
    state = run(state, { type: "cursorBy", delta: -1 });
    expect(state.cursor).toBe(0);
    state = run(state, { type: "cursorBy", delta: 99 });
    expect(state.cursor).toBe(2);
  });

  it("jumps to an index", () => {
    expect(run(loaded(), { type: "cursorTo", index: 2 }).cursor).toBe(2);
  });

  it("does nothing on an empty list", () => {
    const state = initialState("split");
    expect(reducer(state, { type: "cursorBy", delta: 1 })).toBe(state);
    expect(reducer(state, { type: "cursorTo", index: 4 })).toBe(state);
  });
});

describe("opening mail", () => {
  it("opens the mail at the given index and moves the cursor there", () => {
    const state = run(loaded(), { type: "open", index: 1, showSummary: false });
    expect(state.openId).toBe("b");
    expect(state.cursor).toBe(1);
    expect(openMail(state)?.id).toBe("b");
  });

  it("starts in summary view only when asked to", () => {
    expect(
      run(loaded(), { type: "open", index: 0, showSummary: true }).showSummary,
    ).toBe(true);
    expect(
      run(loaded(), { type: "open", index: 0, showSummary: false }).showSummary,
    ).toBe(false);
  });

  it("re-opening the open mail keeps the view it is in", () => {
    let state = run(loaded(), { type: "open", index: 0, showSummary: false });
    state = run(state, { type: "setShowSummary", showSummary: true });
    state = run(state, { type: "open", index: 0, showSummary: false });
    expect(state.showSummary).toBe(true);
  });

  it("keeps focus on the list in split layout", () => {
    expect(
      run(loaded("split"), { type: "open", index: 0, showSummary: false })
        .focus,
    ).toBe("list");
  });

  it("moves focus to the preview in stacked layout", () => {
    expect(
      run(loaded("stacked"), { type: "open", index: 0, showSummary: false })
        .focus,
    ).toBe("preview");
  });

  it("ignores open on an empty list", () => {
    const state = initialState("split");
    expect(reducer(state, { type: "open", index: 0, showSummary: false })).toBe(
      state,
    );
  });
});

describe("unread state", () => {
  it("setUnread changes only the named mail", () => {
    const state = run(loaded(), { type: "setUnread", id: "b", unread: true });
    expect(state.mails.map((m) => m.unread)).toEqual([false, true, false]);
  });
});

describe("summaries", () => {
  const started = () => run(loaded(), { type: "summaryStart", id: "a" });

  it("streams chunks into the summary text", () => {
    const state = run(
      started(),
      { type: "summaryChunk", id: "a", chunk: "Hello " },
      { type: "summaryChunk", id: "a", chunk: "world" },
    );
    expect(state.summaries.a).toEqual({
      status: "streaming",
      text: "Hello world",
    });
  });

  it("finishes as done", () => {
    const state = run(started(), { type: "summaryDone", id: "a" });
    expect(state.summaries.a?.status).toBe("done");
  });

  it("keeps a partial summary when it fails", () => {
    const state = run(
      started(),
      { type: "summaryChunk", id: "a", chunk: "partial" },
      { type: "summaryFailed", id: "a", message: "stream broke" },
    );
    expect(state.summaries.a).toEqual({
      status: "error",
      text: "partial",
      error: "stream broke",
    });
  });

  it("ignores chunks for a summary that was never started", () => {
    const state = loaded();
    expect(reducer(state, { type: "summaryChunk", id: "a", chunk: "x" })).toBe(
      state,
    );
  });

  it("ignores chunks once the summary has finished", () => {
    const done = run(started(), { type: "summaryDone", id: "a" });
    expect(
      reducer(done, { type: "summaryChunk", id: "a", chunk: "late" }),
    ).toBe(done);
  });

  it("setShowSummary only applies while a mail is open", () => {
    const state = loaded();
    expect(reducer(state, { type: "setShowSummary", showSummary: true })).toBe(
      state,
    );
  });
});

describe("deleting", () => {
  it("asks for confirmation only while a mail is open", () => {
    const state = loaded();
    expect(reducer(state, { type: "askDelete", ask: true })).toBe(state);

    const opened = run(state, { type: "open", index: 0, showSummary: false });
    expect(run(opened, { type: "askDelete", ask: true }).confirmingDelete).toBe(
      true,
    );
  });

  it("removes the mail, closes the preview and keeps the cursor in range", () => {
    let state = run(loaded(), { type: "open", index: 2, showSummary: false });
    state = run(state, { type: "mailRemoved", id: "c" });

    expect(state.mails.map((m) => m.id)).toEqual(["a", "b"]);
    expect(state.openId).toBeNull();
    expect(state.focus).toBe("list");
    expect(state.cursor).toBe(1);
  });

  it("keeps the open mail when another mail is removed", () => {
    let state = run(loaded(), { type: "open", index: 1, showSummary: false });
    state = run(state, { type: "mailRemoved", id: "a" });

    expect(state.openId).toBe("b");
    expect(state.cursor).toBe(0);
  });

  it("drops the summary of a removed mail", () => {
    let state = run(loaded(), { type: "summaryStart", id: "a" });
    state = run(state, { type: "mailRemoved", id: "a" });
    expect(state.summaries.a).toBeUndefined();
  });

  it("back cancels a pending delete before it leaves the preview", () => {
    let state = run(
      loaded(),
      { type: "open", index: 0, showSummary: false },
      { type: "focus", focus: "preview" },
      { type: "askDelete", ask: true },
    );
    state = run(state, { type: "back" });

    expect(state.confirmingDelete).toBe(false);
    expect(state.focus).toBe("preview");

    state = run(state, { type: "back" });
    expect(state.focus).toBe("list");
  });
});

describe("focus", () => {
  it("cannot focus the preview before anything is open", () => {
    const state = loaded();
    expect(reducer(state, { type: "focus", focus: "preview" })).toBe(state);
  });

  it("focuses the preview once a mail is open, and goes back", () => {
    let state = run(
      loaded(),
      { type: "open", index: 0, showSummary: false },
      { type: "focus", focus: "preview" },
    );
    expect(state.focus).toBe("preview");
    state = run(state, { type: "back" });
    expect(state.focus).toBe("list");
  });

  it("back is a no-op from the list", () => {
    const state = loaded();
    expect(reducer(state, { type: "back" })).toBe(state);
  });
});

describe("notices", () => {
  it("are set and cleared", () => {
    let state = run(loaded(), { type: "notice", message: "nope" });
    expect(state.notice).toBe("nope");
    state = run(state, { type: "notice", message: null });
    expect(state.notice).toBeNull();
  });

  it("are cleared when a different mail is opened", () => {
    let state = run(loaded(), { type: "notice", message: "nope" });
    state = run(state, { type: "open", index: 0, showSummary: false });
    expect(state.notice).toBeNull();
  });
});

describe("layout", () => {
  it("records layout changes", () => {
    expect(
      run(loaded("split"), { type: "layout", mode: "stacked" }).layout,
    ).toBe("stacked");
  });

  it("returns the same state when nothing changed", () => {
    const state = loaded("split");
    expect(reducer(state, { type: "layout", mode: "split" })).toBe(state);
  });
});

describe("Store", () => {
  it("notifies subscribers with the new and previous state", () => {
    const store = new Store(initialState("split"));
    const seen: Array<[string, string]> = [];
    store.subscribe((next, previous) =>
      seen.push([next.status.kind, previous.status.kind]),
    );

    store.dispatch({ type: "loadStart", filter: "all" });
    store.dispatch({ type: "loaded" });

    expect(seen).toEqual([
      ["loading", "loading"],
      ["ready", "loading"],
    ]);
  });

  it("does not notify when an action changes nothing", () => {
    const store = new Store(initialState("split"));
    let calls = 0;
    store.subscribe(() => calls++);

    store.dispatch({ type: "back" });

    expect(calls).toBe(0);
  });

  it("stops notifying after unsubscribe", () => {
    const store = new Store(initialState("split"));
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    unsubscribe();

    store.dispatch({ type: "loadStart", filter: "all" });

    expect(calls).toBe(0);
  });
});
