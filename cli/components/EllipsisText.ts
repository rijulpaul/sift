import { TextRenderable, type RenderContext } from "@opentui/core";

import { fitToWidth, textWidth } from "../lib/fit";

type TextOptions = ConstructorParameters<typeof TextRenderable>[1];

/**
 * A single-line text that truncates with a trailing `…` to a width the owner
 * hands it via `fit(width)`.
 *
 * (OpenTUI's built-in `truncate` ellipsizes in the middle, which reads badly
 * for subjects and names. Its size-change hooks also don't fire for text
 * nodes, so the owner drives re-fitting explicitly.)
 */
export class EllipsisText {
  readonly node: TextRenderable;

  private full: string;
  private width = Number.POSITIVE_INFINITY;
  private shown: string;

  constructor(
    ctx: RenderContext,
    options: Omit<TextOptions, "content" | "wrapMode" | "truncate">,
    content: string,
  ) {
    this.full = content;
    this.shown = content;
    this.node = new TextRenderable(ctx, {
      ...options,
      content,
      wrapMode: "none",
      truncate: false,
    });
  }

  /** Natural (untruncated) width in terminal cells. */
  get naturalWidth(): number {
    return textWidth(this.full);
  }

  setText(content: string): void {
    this.full = content;
    this.apply();
  }

  /** Truncate to at most `width` cells. */
  fit(width: number): void {
    this.width = width;
    this.apply();
  }

  private apply(): void {
    const next = fitToWidth(this.full, this.width);
    if (next === this.shown) return;
    this.shown = next;
    this.node.content = next;
  }
}
