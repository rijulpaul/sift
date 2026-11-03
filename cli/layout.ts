export type LayoutMode = "split" | "stacked";

export interface LayoutSpec {
  mode: LayoutMode;
  /** Width of the list pane in columns (the full width when stacked). */
  listWidth: number;
}

/** Below this terminal width the panes no longer fit side by side. */
export const SPLIT_MIN_WIDTH = 80;
const LIST_MIN = 30;
const LIST_MAX = 56;
const LIST_RATIO = 0.36;
/** Most of the terminal a dragged list may take before the preview is squeezed. */
const LIST_DRAG_MAX_RATIO = 0.6;

/** Columns the divider moves per `<` / `>` press: small enough to feel movable. */
export const DIVIDER_STEP = 4;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/**
 * Pure function of the terminal width, so responsive behaviour is testable
 * without a terminal.
 *
 * - wide:   list | preview side by side, list ≈ 36% (30–56 cols)
 * - narrow: one pane at a time, the list/preview toggles on open/back
 */
export function computeLayout(width: number): LayoutSpec {
  if (width < SPLIT_MIN_WIDTH) return { mode: "stacked", listWidth: width };
  return {
    mode: "split",
    listWidth: clamp(Math.round(width * LIST_RATIO), LIST_MIN, LIST_MAX),
  };
}

/**
 * Clamp a list width the user dragged to something the preview can live with.
 * Unlike the default, dragging may go wider than `LIST_MAX`, up to 60% of the
 * terminal, but never so far that either pane becomes unusable.
 */
export function clampListWidth(width: number, terminalWidth: number): number {
  const max = Math.max(
    LIST_MIN,
    Math.min(
      Math.floor(terminalWidth * LIST_DRAG_MAX_RATIO),
      terminalWidth - 24, // leave the preview a readable minimum
    ),
  );
  return clamp(Math.round(width), LIST_MIN, max);
}
