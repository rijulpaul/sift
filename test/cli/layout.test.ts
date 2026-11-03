import { describe, expect, it } from "vitest";

import {
  SPLIT_MIN_WIDTH,
  clampListWidth,
  computeLayout,
} from "../../cli/layout";

describe("computeLayout", () => {
  it("stacks panes below the split breakpoint", () => {
    expect(computeLayout(SPLIT_MIN_WIDTH - 1)).toEqual({
      mode: "stacked",
      listWidth: SPLIT_MIN_WIDTH - 1,
    });
  });

  it("splits panes at and above the breakpoint", () => {
    expect(computeLayout(SPLIT_MIN_WIDTH).mode).toBe("split");
  });

  it("sizes the list to about a third of the screen", () => {
    expect(computeLayout(100).listWidth).toBe(36);
  });

  it("clamps the list width on very wide terminals", () => {
    expect(computeLayout(400).listWidth).toBe(56);
  });

  it("never lets the list drop below its minimum when split", () => {
    expect(computeLayout(SPLIT_MIN_WIDTH).listWidth).toBeGreaterThanOrEqual(30);
  });
});

describe("clampListWidth", () => {
  it("keeps a dragged width the preview can live with", () => {
    expect(clampListWidth(50, 200)).toBe(50);
  });

  it("stops a wide drag at 60% of the terminal", () => {
    expect(clampListWidth(190, 200)).toBe(120);
  });

  it("stops a narrow drag at the list minimum", () => {
    expect(clampListWidth(4, 200)).toBe(30);
  });

  it("leaves room for the preview on a narrow split screen", () => {
    // 60% of 80 is 48, and 80 - 24 is 56, so 48 wins; the preview still gets 32.
    expect(clampListWidth(70, 80)).toBe(48);
  });
});
