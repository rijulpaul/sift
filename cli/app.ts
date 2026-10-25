import {
  BoxRenderable,
  CliRenderEvents,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";

import type { SiftCore } from "../core";
import {
  LIST_EMPTY_MESSAGE,
  LIST_EMPTY_UNREAD_MESSAGE,
  LIST_LOADING_MESSAGE,
  MailList,
  listErrorMessage,
} from "./components/MailList";
import { MailPreview } from "./components/MailPreview";
import { StatusBar } from "./components/StatusBar";
import { resolveCommand, type Command } from "./keymap";
import { computeLayout, type LayoutSpec } from "./layout";
import { toMailSummary } from "./lib/mail";
import {
  Store,
  initialState,
  openMail,
  type Filter,
  type State,
} from "./state";
import { theme } from "./theme";
import type { MailSummary, TuiHandle, TuiOptions } from "./types";

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The request that lists the mail for a filter. */
const requestFor = (filter: Filter) =>
  filter === "unread" ? { labels: ["unread"] } : {};

/**
 * Controller: owns the store, builds the component tree, and translates input
 * (keys, clicks, resize) into store actions and core calls.
 *
 * The core is the only source of mail, summaries and changes. Components
 * never call it: they render `State` and report user intent back here.
 */
export class App implements TuiHandle {
  private readonly store: Store;
  private readonly list: MailList;
  private readonly preview: MailPreview;
  private readonly statusBar: StatusBar;
  private layout: LayoutSpec;
  private loadToken = 0;
  private destroyed = false;

  constructor(
    private readonly renderer: CliRenderer,
    private readonly core: SiftCore,
    private readonly options: TuiOptions = {},
  ) {
    this.layout = computeLayout(renderer.terminalWidth);
    this.store = new Store(initialState(this.layout.mode));

    this.list = new MailList(renderer, {
      onSelect: (index) => {
        // A click on a row always selects it, even while the preview has focus.
        this.store.dispatch({ type: "focus", focus: "list" });
        this.openAt(index);
      },
      onActivate: () => this.store.dispatch({ type: "focus", focus: "list" }),
      onFilter: (filter) => this.applyFilter(filter),
    });

    this.preview = new MailPreview(renderer, {
      onActivate: () =>
        this.store.dispatch({ type: "focus", focus: "preview" }),
      onSummary: () => this.toggleSummary(),
      onMarkRead: () => this.toggleReadOpen(),
      onDelete: () => this.store.dispatch({ type: "askDelete", ask: true }),
      onConfirmDelete: () => void this.confirmDelete(),
      onCancelDelete: () =>
        this.store.dispatch({ type: "askDelete", ask: false }),
    });
    this.statusBar = new StatusBar(renderer);

    this.mount();
  }

  /**
   * Wire input and rendering, then start loading the mail. The load is not
   * awaited: mail appears as the core streams it in.
   */
  start(): void {
    this.store.subscribe((state, previous) => {
      // Work started before shutdown (a stream, a summary) may still dispatch.
      if (!this.destroyed) this.render(state, previous);
    });
    this.render(this.store.getState(), initialState(this.layout.mode));

    this.renderer.keyInput.on("keypress", this.onKey);
    this.renderer.on(CliRenderEvents.RESIZE, this.onResize);
    this.renderer.once(CliRenderEvents.DESTROY, this.onDestroyed);

    void this.reload();
  }

  /** Full reload with the current filter: lists the mail from scratch. */
  async reload(filter: Filter = this.store.getState().filter): Promise<void> {
    // Only the most recent load may write to the store.
    const token = ++this.loadToken;
    this.store.dispatch({ type: "loadStart", filter });

    try {
      const stream = this.core.getMessagesStream(requestFor(filter));
      for await (const message of stream) {
        // A newer load started, or the TUI closed: stop pulling.
        if (token !== this.loadToken || this.destroyed) break;
        this.store.dispatch({
          type: "mailArrived",
          mail: toMailSummary(message),
        });
      }
      if (token === this.loadToken) this.store.dispatch({ type: "loaded" });
    } catch (error) {
      if (token === this.loadToken) {
        this.store.dispatch({
          type: "loadFailed",
          message: errorMessage(error),
        });
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.destroy();
  }

  // ── tree ──────────────────────────────────────────────────────────────────

  private mount(): void {
    const panes = new BoxRenderable(this.renderer, {
      id: "panes",
      flexGrow: 1,
      width: "100%",
      flexDirection: "row",
      backgroundColor: theme.bg,
    });
    panes.add(this.list.root);
    panes.add(this.preview.root);

    const shell = new BoxRenderable(this.renderer, {
      id: "shell",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: theme.bg,
    });
    shell.add(panes);
    shell.add(this.statusBar.root);

    this.preview.root.flexGrow = 1;
    this.preview.root.minWidth = 0;
    this.list.root.flexShrink = 0;
    this.applyLayout();

    this.renderer.root.add(shell);
  }

  private applyLayout(): void {
    this.list.root.width =
      this.layout.mode === "split" ? this.layout.listWidth : "100%";
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(state: State, previous: State): void {
    const now = (this.options.now ?? (() => new Date()))();
    const listFocused = state.focus === "list";

    if (state.mails !== previous.mails) {
      this.list.setMails(state.mails, now);
    }
    this.list.setFilter(state.filter);
    this.list.setTitle(
      `${state.filter === "unread" ? "Unread" : "Inbox"} (${state.mails.length})`,
    );
    this.list.setPlaceholder(this.listPlaceholder(state));
    this.list.setFocused(listFocused);
    this.list.setSelection({
      cursor: state.cursor,
      openId: state.openId,
      focused: listFocused,
    });

    this.preview.setFocused(!listFocused);
    const open = openMail(state);
    this.preview.show(
      open
        ? {
            kind: "mail",
            mail: open,
            showSummary: state.showSummary,
            summary: state.summaries[open.id],
            confirming: state.confirmingDelete,
          }
        : { kind: "empty" },
    );

    // Stacked layout shows exactly one pane: whichever has focus.
    if (state.layout === "stacked") {
      this.list.root.visible = listFocused;
      this.preview.root.visible = !listFocused;
    } else {
      this.list.root.visible = true;
      this.preview.root.visible = true;
    }

    this.statusBar.update(state, this.renderer.terminalWidth);
  }

  private listPlaceholder(state: State): string | null {
    if (state.mails.length > 0) return null;
    switch (state.status.kind) {
      case "loading":
        return LIST_LOADING_MESSAGE;
      case "error":
        return listErrorMessage(state.status.message);
      case "ready":
        return state.filter === "unread"
          ? LIST_EMPTY_UNREAD_MESSAGE
          : LIST_EMPTY_MESSAGE;
    }
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private readonly onKey = (key: KeyEvent): void => {
    const command = resolveCommand(key);
    if (command) this.run(command);
  };

  private readonly onResize = (): void => {
    this.layout = computeLayout(this.renderer.terminalWidth);
    this.applyLayout();
    this.store.dispatch({ type: "layout", mode: this.layout.mode });
    // Pane visibility depends on the mode; re-render even if only the width changed.
    const state = this.store.getState();
    this.render(state, state);
  };

  private readonly onDestroyed = (): void => {
    this.destroyed = true;
    this.renderer.keyInput.off("keypress", this.onKey);
    this.renderer.off(CliRenderEvents.RESIZE, this.onResize);
    this.list.dispose();
    this.options.onExit?.();
  };

  private run(command: Command): void {
    const state = this.store.getState();
    const { focus, cursor, mails } = state;
    const inList = focus === "list";

    switch (command) {
      case "quit":
        this.destroy();
        return;
      case "refresh":
        void this.reload();
        return;
      case "toggleUnread":
        this.applyFilter(state.filter === "unread" ? "all" : "unread");
        return;

      case "down":
      case "up": {
        const delta = command === "down" ? 1 : -1;
        if (inList) this.store.dispatch({ type: "cursorBy", delta });
        else this.preview.scrollBy(delta);
        return;
      }
      case "pageDown":
      case "pageUp": {
        const sign = command === "pageDown" ? 1 : -1;
        if (inList)
          this.store.dispatch({
            type: "cursorBy",
            delta: sign * this.list.pageSize(),
          });
        else this.preview.scrollBy(sign * this.preview.pageSize());
        return;
      }
      case "first":
        if (inList) this.store.dispatch({ type: "cursorTo", index: 0 });
        else this.preview.scrollToTop();
        return;
      case "last":
        if (inList)
          this.store.dispatch({ type: "cursorTo", index: mails.length - 1 });
        else this.preview.scrollToBottom();
        return;

      case "open":
        if (inList) this.openAt(cursor);
        return;

      case "right":
        this.focusPreview(cursor, state.openId);
        return;
      case "left":
        this.store.dispatch({ type: "back" });
        return;
      case "back":
        this.store.dispatch({ type: "back" });
        return;
      case "toggleFocus":
        if (inList) this.focusPreview(cursor, state.openId);
        else this.store.dispatch({ type: "back" });
        return;

      case "markRead":
        // In the list it acts on the highlighted row, in the preview on the open mail.
        if (inList) {
          const id = mails[cursor]?.id;
          if (id !== undefined) this.toggleRead(id);
        } else {
          this.toggleReadOpen();
        }
        return;
      case "summarize":
        if (!inList) this.toggleSummary();
        return;
      case "delete":
        if (!inList && state.openId !== null) {
          this.store.dispatch({ type: "askDelete", ask: true });
        }
        return;
      case "confirm":
        if (state.confirmingDelete) void this.confirmDelete();
        return;
      case "deny":
        if (state.confirmingDelete) {
          this.store.dispatch({ type: "askDelete", ask: false });
        }
        return;
    }
  }

  /** Move focus to the preview, opening the cursor's mail first if none is open. */
  private focusPreview(cursor: number, openId: string | null): void {
    if (openId === null) this.openAt(cursor);
    this.store.dispatch({ type: "focus", focus: "preview" });
  }

  /** Open the mail at `index`: apply the config's open behaviour, then show it. */
  private openAt(index: number): void {
    const state = this.store.getState();
    const mail = state.mails[index];
    if (!mail) return;

    // Re-opening the open mail keeps its view and does nothing else.
    if (mail.id === state.openId) {
      this.store.dispatch({
        type: "open",
        index,
        showSummary: state.showSummary,
      });
      return;
    }

    const { summarize, markAsRead } = this.core.config;
    this.store.dispatch({ type: "open", index, showSummary: summarize });

    if (markAsRead && mail.unread) void this.setUnread(mail.id, false);
    if (summarize) void this.summarize(mail.id);
  }

  /** Summary button / `s`: switch between the summary and the text, summarizing on first use. */
  private toggleSummary(): void {
    const state = this.store.getState();
    if (state.openId === null) return;

    if (state.showSummary) {
      this.store.dispatch({ type: "setShowSummary", showSummary: false });
      return;
    }
    this.store.dispatch({ type: "setShowSummary", showSummary: true });
    void this.summarize(state.openId);
  }

  /** Stream the summary of one mail into the store. A finished summary is reused. */
  private async summarize(id: string): Promise<void> {
    const mail = this.store.getState().mails.find((m) => m.id === id);
    if (!mail) return;

    const existing = this.store.getState().summaries[id];
    if (existing && existing.status !== "error") return; // streaming or done

    this.store.dispatch({ type: "summaryStart", id });
    try {
      for await (const event of this.core.summarize(mail.content)) {
        if (!event.done && event.chunk) {
          this.store.dispatch({ type: "summaryChunk", id, chunk: event.chunk });
        }
      }
      this.store.dispatch({ type: "summaryDone", id });
    } catch (error) {
      this.store.dispatch({
        type: "summaryFailed",
        id,
        message: errorMessage(error),
      });
    }
  }

  /** The read button, and `m` with the open mail: flip it between read and unread. */
  private toggleReadOpen(): void {
    const id = this.store.getState().openId;
    if (id !== null) this.toggleRead(id);
  }

  /** `m` in the list: flip the highlighted mail between read and unread. */
  private toggleRead(id: string): void {
    const mail = this.store.getState().mails.find((m) => m.id === id);
    if (mail) void this.setUnread(id, !mail.unread);
  }

  /**
   * Set a mail's unread label through the core. The change shows at once and
   * is undone if the core rejects it.
   */
  private async setUnread(id: string, unread: boolean): Promise<void> {
    const mail = this.store.getState().mails.find((m) => m.id === id);
    if (!mail || mail.unread === unread) return;

    this.store.dispatch({ type: "setUnread", id, unread });
    try {
      await this.core.setMessageLabel(
        id,
        unread
          ? { addLabels: "unread", removeLabels: undefined }
          : { addLabels: undefined, removeLabels: "unread" },
      );
    } catch (error) {
      this.store.dispatch({ type: "setUnread", id, unread: !unread });
      this.store.dispatch({
        type: "notice",
        message: `Couldn't mark as ${unread ? "unread" : "read"}: ${errorMessage(error)}`,
      });
    }
  }

  /** Delete the open mail, after the user confirmed. */
  private async confirmDelete(): Promise<void> {
    const id = this.store.getState().openId;
    if (id === null) return;

    this.store.dispatch({ type: "askDelete", ask: false });
    try {
      await this.core.deleteMessage(id);
      this.store.dispatch({ type: "mailRemoved", id });
    } catch (error) {
      this.store.dispatch({
        type: "notice",
        message: `Couldn't delete: ${errorMessage(error)}`,
      });
    }
  }

  /** All / Unread: change the filter and reload the list with it. */
  private applyFilter(filter: Filter): void {
    if (filter === this.store.getState().filter) return;
    void this.reload(filter);
  }
}
