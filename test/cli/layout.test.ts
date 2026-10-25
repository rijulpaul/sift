import { describe, expect, it } from "vitest";

import { SPLIT_MIN_WIDTH, computeLayout } from "../../cli/layout";

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
