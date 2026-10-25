/**
 * Terminal-cell aware text fitting. Pure and renderer-free so it can be unit
 * tested; `EllipsisText` uses it to truncate with a trailing `…`.
 */

const ELLIPSIS = "…";

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Split into user-perceived characters (keeps emoji / combining marks whole). */
function graphemes(text: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Wide (2-cell) code point ranges: CJK, fullwidth forms, most emoji. */
const WIDE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u;
/** Zero-width: combining marks, variation selectors, ZWJ. */
const ZERO = /^(?:\p{M}|[\u200B-\u200D]|\uFE0E|\uFE0F)+$/u;

/** Number of terminal cells one grapheme occupies. */
export function cellWidth(grapheme: string): number {
  if (grapheme === "") return 0;
  if (ZERO.test(grapheme)) return 0;
  return WIDE.test(grapheme) ? 2 : 1;
}

export function textWidth(text: string): number {
  let width = 0;
  for (const g of graphemes(text)) width += cellWidth(g);
  return width;
}

/**
 * Fit `text` into `width` cells. Longer text is cut and ends with `…`.
 * Newlines are flattened so a multi-line value can never break a one-line row.
 */
export function fitToWidth(text: string, width: number): string {
  const flat = text.replace(/\s*[\r\n]+\s*/g, " ");
  if (width <= 0) return "";
  if (textWidth(flat) <= width) return flat;
  if (width === 1) return ELLIPSIS;

  const budget = width - 1; // leave a cell for the ellipsis
  let used = 0;
  let out = "";
  for (const g of graphemes(flat)) {
    const w = cellWidth(g);
    if (used + w > budget) break;
    out += g;
    used += w;
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}
