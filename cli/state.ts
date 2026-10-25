import type { LayoutMode } from "./layout";
import type { MailSummary } from "./types";

export type Focus = "list" | "preview";
export type Filter = "all" | "unread";

export type ListStatus =
  { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string };

export interface SummaryState {
  status: "streaming" | "done" | "error";
  text: string;
  error?: string;
}

export interface State {
  /** Mail received so far, in arrival order. Grows while a load streams in. */
  mails: MailSummary[];
  /** Highlighted row in the list (keyboard position). */
  cursor: number;
  /** The mail shown in the preview pane, or `null`. */
  openId: string | null;
  focus: Focus;
  layout: LayoutMode;
  filter: Filter;
  status: ListStatus;
  /** The open mail shows its summary (true) or its text (false). */
  showSummary: boolean;
  /** Summaries by mail id. Kept across reloads so a summary is never redone. */
  summaries: Record<string, SummaryState>;
  /** Delete was requested for the open mail and awaits confirmation. */
  confirmingDelete: boolean;
  /** Message from the last failed action, cleared by the next action. */
  notice: string | null;
}

export type Action =
  | { type: "loadStart"; filter: Filter }
  | { type: "mailArrived"; mail: MailSummary }
  | { type: "loaded" }
  | { type: "loadFailed"; message: string }
  | { type: "cursorBy"; delta: number }
  | { type: "cursorTo"; index: number }
  /** Open the mail at `index`. Re-opening the open mail keeps its view. */
  | { type: "open"; index: number; showSummary: boolean }
  | { type: "setUnread"; id: string; unread: boolean }
  | { type: "setShowSummary"; showSummary: boolean }
  | { type: "summaryStart"; id: string }
  | { type: "summaryChunk"; id: string; chunk: string }
  | { type: "summaryDone"; id: string }
  | { type: "summaryFailed"; id: string; message: string }
  | { type: "askDelete"; ask: boolean }
  | { type: "mailRemoved"; id: string }
  | { type: "notice"; message: string | null }
  | { type: "focus"; focus: Focus }
  | { type: "back" }
  | { type: "layout"; mode: LayoutMode };

export const initialState = (layout: LayoutMode): State => ({
  mails: [],
  cursor: 0,
  openId: null,
  focus: "list",
  layout,
  // Start on unread mail: that is what the user came to see.
  filter: "unread",
  status: { kind: "loading" },
  showSummary: false,
  summaries: {},
  confirmingDelete: false,
  notice: null,
});

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const lastIndex = (mails: MailSummary[]) => Math.max(0, mails.length - 1);

/** Pure state transitions. Everything the UI shows derives from `State`. */
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loadStart":
      // A load replaces the list, so the preview closes with it. Summaries are
      // kept: they belong to the message id, not to the load.
      return {
        ...state,
        mails: [],
        cursor: 0,
        openId: null,
        focus: "list",
        filter: action.filter,
        status: { kind: "loading" },
        showSummary: false,
        confirmingDelete: false,
        notice: null,
      };

    case "mailArrived": {
      const index = state.mails.findIndex((m) => m.id === action.mail.id);
      const mails =
        index === -1
          ? [...state.mails, action.mail]
          : state.mails.map((m, i) => (i === index ? action.mail : m));
      return { ...state, mails };
    }

    case "loaded":
      return { ...state, status: { kind: "ready" } };

    case "loadFailed":
      // Keep what already arrived; the status bar reports the failure.
      return { ...state, status: { kind: "error", message: action.message } };

    case "cursorBy":
      if (state.mails.length === 0) return state;
      return {
        ...state,
        cursor: clamp(state.cursor + action.delta, 0, lastIndex(state.mails)),
      };

    case "cursorTo":
      if (state.mails.length === 0) return state;
      return {
        ...state,
        cursor: clamp(action.index, 0, lastIndex(state.mails)),
      };

    case "open": {
      const mail = state.mails[clamp(action.index, 0, lastIndex(state.mails))];
      if (!mail) return state;
      // In stacked layout only one pane is visible, so opening shows the preview.
      const focus = state.layout === "stacked" ? "preview" : state.focus;
      if (mail.id === state.openId) {
        return { ...state, cursor: action.index, focus };
      }
      return {
        ...state,
        cursor: state.mails.indexOf(mail),
        openId: mail.id,
        focus,
        showSummary: action.showSummary,
        confirmingDelete: false,
        notice: null,
      };
    }

    case "setUnread":
      return {
        ...state,
        mails: state.mails.map((m) =>
          m.id === action.id ? { ...m, unread: action.unread } : m,
        ),
      };

    case "setShowSummary":
      if (state.openId === null) return state;
      return { ...state, showSummary: action.showSummary };

    case "summaryStart":
      return {
        ...state,
        summaries: {
          ...state.summaries,
          [action.id]: { status: "streaming", text: "" },
        },
      };

    case "summaryChunk": {
      const current = state.summaries[action.id];
      // Ignore chunks for a summary that was dropped (e.g. its mail was deleted).
      if (!current || current.status !== "streaming") return state;
      return {
        ...state,
        summaries: {
          ...state.summaries,
          [action.id]: { ...current, text: current.text + action.chunk },
        },
      };
    }

    case "summaryDone": {
      const current = state.summaries[action.id];
      if (!current) return state;
      return {
        ...state,
        summaries: {
          ...state.summaries,
          [action.id]: { ...current, status: "done" },
        },
      };
    }

    case "summaryFailed":
      return {
        ...state,
        summaries: {
          ...state.summaries,
          [action.id]: {
            status: "error",
            text: state.summaries[action.id]?.text ?? "",
            error: action.message,
          },
        },
      };

    case "askDelete":
      if (state.openId === null) return state;
      return { ...state, confirmingDelete: action.ask };

    case "mailRemoved": {
      const index = state.mails.findIndex((m) => m.id === action.id);
      if (index === -1) return state;
      const mails = state.mails.filter((m) => m.id !== action.id);
      const summaries = { ...state.summaries };
      delete summaries[action.id];
      const wasOpen = state.openId === action.id;
      return {
        ...state,
        mails,
        summaries,
        cursor: clamp(
          index < state.cursor ? state.cursor - 1 : state.cursor,
          0,
          lastIndex(mails),
        ),
        openId: wasOpen ? null : state.openId,
        focus: wasOpen ? "list" : state.focus,
        showSummary: wasOpen ? false : state.showSummary,
        confirmingDelete: wasOpen ? false : state.confirmingDelete,
      };
    }

    case "notice":
      return { ...state, notice: action.message };

    case "focus":
      // The preview can only take focus once something is open.
      if (action.focus === "preview" && state.openId === null) return state;
      return state.focus === action.focus
        ? state
        : { ...state, focus: action.focus };

    case "back":
      // Esc / h first cancels a pending delete, then returns to the list.
      if (state.confirmingDelete) return { ...state, confirmingDelete: false };
      return state.focus === "preview" ? { ...state, focus: "list" } : state;

    case "layout":
      return state.layout === action.mode
        ? state
        : { ...state, layout: action.mode };
  }
}

/** The open mail, if any. */
export const openMail = (state: State): MailSummary | undefined =>
  state.openId === null
    ? undefined
    : state.mails.find((m) => m.id === state.openId);

type Listener = (state: State, previous: State) => void;

/** Minimal observable store: one state value, `dispatch`, `subscribe`. */
export class Store {
  private listeners = new Set<Listener>();

  constructor(private state: State) {}

  getState(): State {
    return this.state;
  }

  dispatch(action: Action): void {
    const previous = this.state;
    const next = reducer(previous, action);
    if (next === previous) return;
    this.state = next;
    // Iterate a copy so a listener may unsubscribe while being notified.
    for (const listener of Array.from(this.listeners)) listener(next, previous);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
