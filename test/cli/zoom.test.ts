import { describe, expect, it } from "vitest";

import {
  PAN_STEP_X,
  PAN_STEP_Y,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampPan,
  clampZoom,
  panLimit,
  placeImage,
  stepZoom,
  zoomLabel,
} from "../../cli/lib/zoom";

const viewport = { width: 40, height: 20 };

describe("zoom", () => {
  it("steps up and down by half", () => {
    expect(stepZoom(1, 1)).toBe(1 + ZOOM_STEP);
    expect(stepZoom(1.5, -1)).toBe(1);
  });

  it("stops at the ends", () => {
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
  });

  it("shows itself as a percentage", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(1.5)).toBe("150%");
    expect(zoomLabel(0.5)).toBe("50%");
  });

  it("steps by whole columns and rows", () => {
    expect(PAN_STEP_X).toBeGreaterThan(0);
    expect(PAN_STEP_Y).toBeGreaterThan(0);
  });
});

describe("placeImage", () => {
  it("centres a picture that fits", () => {
    expect(
      placeImage(viewport, { width: 20, height: 10 }, { x: 0, y: 0 }),
    ).toEqual({ left: 10, top: 5 });
  });

  it("ignores pan when the picture fits: there is nothing to reveal", () => {
    expect(
      placeImage(viewport, { width: 20, height: 10 }, { x: 30, y: 30 }),
    ).toEqual({ left: 10, top: 5 });
  });

  it("puts a picture bigger than the window at its top left", () => {
    expect(
      placeImage(viewport, { width: 80, height: 40 }, { x: 0, y: 0 }),
    ).toEqual({ left: -20, top: -10 });
  });

  it("moves the picture the other way when panned", () => {
    // Pushing right reveals the right-hand side, so the picture moves left.
    expect(
      placeImage(viewport, { width: 80, height: 40 }, { x: 5, y: 3 }),
    ).toEqual({ left: -25, top: -13 });
  });

  it("stops at the edges of the picture", () => {
    expect(
      placeImage(viewport, { width: 80, height: 40 }, { x: 999, y: 999 }),
    ).toEqual({ left: viewport.width - 80, top: viewport.height - 40 });
  });
});

describe("panning limits", () => {
  it("is half the overflow", () => {
    expect(panLimit(40, 80)).toBe(20);
    expect(panLimit(40, 41)).toBe(0); // one column of overflow cannot be shared
  });

  it("is zero when the picture is smaller than the window", () => {
    expect(panLimit(40, 10)).toBe(0);
  });

  it("clamps a pan to the limit", () => {
    expect(
      clampPan({ x: 100, y: -100 }, viewport, { width: 80, height: 60 }),
    ).toEqual({ x: 20, y: -20 });
  });

  it("clamps to zero when the picture fits", () => {
    expect(
      clampPan({ x: 8, y: 8 }, viewport, { width: 10, height: 10 }),
    ).toEqual({ x: 0, y: 0 });
  });
});
