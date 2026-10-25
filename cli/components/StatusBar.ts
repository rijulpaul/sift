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
  private readonly status: TextRenderable;
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
      marginLeft: 2,
    });

    this.root.add(this.hints);
    this.root.add(this.status);
  }

  /** `width` is the terminal width; hints that don't fit are dropped whole. */
  update(state: State, width: number): void {
    const status = this.describe(state);
    this.status.content = status;
    this.status.fg = state.notice ? theme.strong : theme.muted;
    this.status.attributes = state.notice ? attr.bold : attr.none;

    const set: HintSet = state.confirmingDelete ? "confirm" : state.focus;
    this.setHints(
      set,
      width - 2 /* padding */ - textWidth(status) - 2 /* gap */,
    );
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

  private setHints(set: HintSet, available: number): void {
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
    if (key === this.shownKey) return;
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
  }
}
