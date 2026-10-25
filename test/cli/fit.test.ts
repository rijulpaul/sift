import { describe, expect, it } from "vitest";

import { cellWidth, fitToWidth, textWidth } from "../../cli/lib/fit";

describe("textWidth", () => {
  it("counts one cell per ASCII character", () => {
    expect(textWidth("hello")).toBe(5);
  });

  it("counts CJK characters and emoji as two cells", () => {
    expect(cellWidth("山")).toBe(2);
    expect(textWidth("山田")).toBe(4);
    expect(cellWidth("🚀")).toBe(2);
  });

  it("counts combining marks as zero cells", () => {
    expect(textWidth("e\u0301")).toBe(1);
  });
});

describe("fitToWidth", () => {
  it("returns text that already fits unchanged", () => {
    expect(fitToWidth("hello", 5)).toBe("hello");
    expect(fitToWidth("hello", 20)).toBe("hello");
  });

  it("truncates with a trailing ellipsis within the width", () => {
    const out = fitToWidth("hello world", 8);
    expect(out).toBe("hello w…");
    expect(textWidth(out)).toBeLessThanOrEqual(8);
  });

  it("never exceeds the width for wide characters", () => {
    const out = fitToWidth("山田太郎です", 7);
    expect(textWidth(out)).toBeLessThanOrEqual(7);
    expect(out.endsWith("…")).toBe(true);
  });

  it("handles degenerate widths", () => {
    expect(fitToWidth("hello", 0)).toBe("");
    expect(fitToWidth("hello", -3)).toBe("");
    expect(fitToWidth("hello", 1)).toBe("…");
  });

  it("flattens newlines so a value cannot break a one-line row", () => {
    expect(fitToWidth("line one\nline two", 40)).toBe("line one line two");
  });

  it("does not leave a dangling space before the ellipsis", () => {
    expect(fitToWidth("ab cdefgh", 4)).toBe("ab…");
  });
});
