import {
  BoxRenderable,
  TextRenderable,
  type RenderContext,
} from "@opentui/core";

import { HINTS } from "../keymap";
import { textWidth } from "../lib/fit";
import type { State } from "../state";
import { attr, theme } from "../theme";

type HintSet = keyof typeof HINTS;

/** One-row footer: key hints on the left, status (or the last notice) on the right. */
export class StatusBar {
  readonly root: BoxRenderable;

  private readonly hints: BoxRenderable;
  private readonly right: BoxRenderable;
  private readonly account: TextRenderable;
  private readonly status: TextRenderable;
  private accountText = "";
  private accountShown = false;
  private shownKey = "";
  private counter = 0;
  private readonly ctx: RenderContext;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.root = new BoxRenderable(ctx, {
      id: "status-bar",
      width: "100%",
      height: 1,
      flexShrink: 0,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingX: 1,
      backgroundColor: theme.bg,
      overflow: "hidden",
    });

    this.hints = new BoxRenderable(ctx, {
      id: "status-hints",
      flexDirection: "row",
      gap: 2,
      flexShrink: 1,
      minWidth: 0,
      overflow: "hidden",
      backgroundColor: theme.bg,
    });
    this.status = new TextRenderable(ctx, {
      id: "status-text",
      content: "",
      fg: theme.muted,
      wrapMode: "none",
      flexShrink: 0,
    });

    // Faint, between the hints and the counts: visible but easy to ignore.
    this.account = new TextRenderable(ctx, {
      id: "status-account",
      content: "",
      fg: theme.faint,
      wrapMode: "none",
      flexShrink: 0,
      visible: false,
    });

    // The account sits just left of the counts, at the right edge.
    this.right = new BoxRenderable(ctx, {
      id: "status-right",
      flexDirection: "row",
      gap: 2,
      flexShrink: 0,
      backgroundColor: theme.bg,
    });
    this.right.add(this.account);
    this.right.add(this.status);

    this.root.add(this.hints);
    this.root.add(this.right);
  }

  /** The account line, shown when the footer has room for it. */
  setAccount(label: string): void {
    this.accountText = label;
  }

  /** `width` is the terminal width; hints that don't fit are dropped whole. */
  update(state: State, width: number): void {
    const status = this.describe(state);
    this.status.content = status;
    this.status.fg = state.notice ? theme.strong : theme.muted;
    this.status.attributes = state.notice ? attr.bold : attr.none;

    const set: HintSet = state.confirmingDelete ? "confirm" : state.focus;
    const available = width - 2 /* padding */ - textWidth(status) - 2; /* gap */
    const usedByHints = this.setHints(set, available);

    // The account is the least important thing here, so it goes first.
    this.showAccount(available - usedByHints);
  }

  /** Show the account only if it still fits beside the hints. */
  private showAccount(remaining: number): void {
    const show =
      this.accountText !== "" && textWidth(this.accountText) + 2 <= remaining;
    if (show === this.accountShown) return;

    this.accountShown = show;
    this.account.visible = show;
    if (show) this.account.content = this.accountText;
  }

  private describe(state: State): string {
    if (state.notice) return state.notice;

    const filter = state.filter === "unread" ? "unread · " : "";
    switch (state.status.kind) {
      case "loading":
        return `${filter}Loading… ${state.mails.length}`;
      case "error":
        return `${filter}Error · r to retry`;
      case "ready":
        return state.mails.length === 0
          ? `${filter}0 messages`
          : `${filter}${state.cursor + 1}/${state.mails.length}`;
    }
  }

  /** Fits the hints to `available` columns and returns the width they used. */
  private setHints(set: HintSet, available: number): number {
    // Keep the highest-priority hints (listed first) that fit in one row.
    const visible: Array<readonly [string, string]> = [];
    let used = 0;
    for (const hint of HINTS[set]) {
      const cost =
        textWidth(hint[0]) +
        1 +
        textWidth(hint[1]) +
        (visible.length > 0 ? 2 : 0);
      if (used + cost > available) break;
      used += cost;
      visible.push(hint);
    }

    const key = `${set}:${visible.length}`;
    if (key === this.shownKey) return used;
    this.shownKey = key;

    for (const child of this.hints.getChildren()) {
      this.hints.remove(child);
      child.destroyRecursively();
    }

    for (const [name, label] of visible) {
      const hint = new BoxRenderable(this.ctx, {
        id: `status-hint-${this.counter++}`,
        flexDirection: "row",
        gap: 1,
        flexShrink: 0,
        backgroundColor: theme.bg,
      });
      hint.add(
        new TextRenderable(this.ctx, {
          id: `status-hint-${this.counter++}`,
          content: name,
          fg: theme.text,
          attributes: attr.bold,
        }),
      );
      hint.add(
        new TextRenderable(this.ctx, {
          id: `status-hint-${this.counter++}`,
          content: label,
          fg: theme.muted,
        }),
      );
      this.hints.add(hint);
    }

    return used;
  }
}
