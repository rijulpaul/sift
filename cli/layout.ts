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
