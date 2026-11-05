/**
 * The arithmetic behind the picture overlay: how far it zooms, where it sits in
 * the window, and how far it may be pushed. Pure, so it is unit-tested without a
 * terminal.
 */

/** Smallest and largest zoom. 1 is "as big as the window allows". */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 6;

/** One press of `=` or `-` changes the zoom by this much. */
export const ZOOM_STEP = 0.5;

/** Columns / rows one movement key (or wheel notch) pans the picture. */
export const PAN_STEP_X = 2;
export const PAN_STEP_Y = 1;

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value));

/** Keep the zoom where both the picture and the keys can live with it. */
export const clampZoom = (zoom: number): number =>
  clamp(Math.round(zoom * 100) / 100, ZOOM_MIN, ZOOM_MAX);

/** The zoom after one `=` (`direction` 1) or `-` (`direction` -1). */
export const stepZoom = (zoom: number, direction: 1 | -1): number =>
  clampZoom(zoom + direction * ZOOM_STEP);

/** `150%` — what the overlay's hint line shows. */
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/**
 * How far the picture may be pushed on one axis: half of what overflows the
 * window, so it can never be moved clear of the frame.
 */
export const panLimit = (viewport: number, picture: number): number =>
  Math.max(0, Math.floor((picture - viewport) / 2));

/** Clamp a pan to what the current picture and window allow. */
export function clampPan(pan: Point, viewport: Size, picture: Size): Point {
  const limitX = panLimit(viewport.width, picture.width);
  const limitY = panLimit(viewport.height, picture.height);
  return {
    x: clamp(pan.x, -limitX, limitX),
    y: clamp(pan.y, -limitY, limitY),
  };
}

/**
 * Where the picture goes inside the window: centred when it fits, and panned
 * within the window's edges when it does not.
 *
 * `pan` is the part of the picture the reader is looking at, the way a scroll
 * position works: pushing right shows the right-hand side, which moves the
 * picture left.
 */
export function placeImage(
  viewport: Size,
  picture: Size,
  pan: Point,
): { left: number; top: number } {
  const centredLeft = Math.round((viewport.width - picture.width) / 2);
  const centredTop = Math.round((viewport.height - picture.height) / 2);

  // Past the edges there is nothing to see, so the picture stops there.
  return {
    left:
      picture.width > viewport.width
        ? clamp(centredLeft - pan.x, viewport.width - picture.width, 0)
        : centredLeft,
    top:
      picture.height > viewport.height
        ? clamp(centredTop - pan.y, viewport.height - picture.height, 0)
        : centredTop,
  };
}
