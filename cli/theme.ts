import { TextAttributes } from "@opentui/core";

/**
 * Monotone palette. Every colour in the TUI comes from here, so re-theming
 * (or adding a real accent colour later) is a one-file change.
 */
export const theme = {
  /** Screen background. */
  bg: "#0b0b0b",
  /** Pane background. */
  surface: "#101010",
  /** Cursor row while its pane is focused. */
  raised: "#262626",
  /** Cursor row while its pane is NOT focused. */
  raisedDim: "#1a1a1a",

  border: "#3a3a3a",
  borderFocus: "#d0d0d0",

  text: "#e6e6e6",
  muted: "#9a9a9a",
  faint: "#5e5e5e",
  /** Strongest emphasis: the open-mail marker and unread dot. */
  strong: "#ffffff",
} as const;

export const attr = {
  none: 0,
  bold: TextAttributes.BOLD,
  dim: TextAttributes.DIM,
} as const;
