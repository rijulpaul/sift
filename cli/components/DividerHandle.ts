import { TextRenderable, type RenderContext } from "@opentui/core";

import { attr, theme } from "../theme";

/**
 * The grip on the border between the list and the preview: a bright mark in the
 * middle of the divider.
 *
 * The divider is two columns — the list's right border and the preview's left
 * one — so a single glyph cannot sit between them. Two half blocks can: `▐`
 * fills the right half of the left column and `▌` the left half of the right
 * one, and together they read as one small mark centred exactly on the seam.
 * One row tall, so it never looks like part of the frame.
 */
export class DividerHandle {
  readonly root: TextRenderable;

  constructor(ctx: RenderContext) {
    this.root = new TextRenderable(ctx, {
      id: "divider-handle",
      content: "||",
      fg: theme.borderFocus,
      attributes: attr.dim,
      // Out of the flex flow: it sits exactly where it is put, over the border.
      position: "absolute",
      left: 0,
      top: 0,
      zIndex: 1,
      visible: false,
    });
  }

  /** Put the grip on the divider, `column` cells in and `row` rows down. */
  move(column: number, row: number): void {
    this.root.left = column;
    this.root.top = row;
    this.root.visible = true;
  }

  /** Shown while the panes are side by side, hidden when they are stacked. */
  set visible(visible: boolean) {
    this.root.visible = visible;
  }
}
