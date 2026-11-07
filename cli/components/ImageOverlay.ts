import {
  BoxRenderable,
  ImageRenderable,
  RGBA,
  TextRenderable,
  bold,
  fg,
  t,
  type KeyEvent,
  type MouseEvent,
  type RenderContext,
} from "@opentui/core";

import {
  PAN_STEP_X,
  PAN_STEP_Y,
  clampPan,
  clampZoom,
  placeImage,
  stepZoom,
  zoomLabel,
  type Point,
  type Size,
} from "../lib/zoom";
import { theme } from "../theme";

/** Rows kept clear above the picture for the close button, and below for the hint. */
const TOP_ROWS = 1;
const HINT_ROWS = 1;

/** The close button: a cross in a square outline, one space either side. */
const CLOSE_HEIGHT = 3;
const CLOSE_WIDTH = 5;

/**
 * A key or a number in the hint line: the strongest colour, in bold, so the
 * gestures stand out from the words that explain them.
 */
const strong = (text: string) => fg(theme.strong)(bold(text));

/**
 * The veil over the mail: the screen's own colour, half painted. The terminal
 * blends it with what is underneath, so the mail shows through — dimmed — and
 * the picture stands out. Text keeps its own colour, so nothing is hidden.
 */
const SCRIM = RGBA.fromValues(11 / 255, 11 / 255, 11 / 255, 0.8);

/** The terminal's size; a render context is the screen unless told otherwise. */
const screenWidth = (ctx: RenderContext): number =>
  ctx.terminalWidth ?? ctx.width;
const screenHeight = (ctx: RenderContext): number =>
  ctx.terminalHeight ?? ctx.height;

export interface ImageOverlayProps {
  /** The overlay was dismissed (the cross, `esc`, `q`). */
  onClose: () => void;
}

/**
 * One picture, on its own, over the mail: the reader asked to look at it, so
 * everything else gets out of the way — but stays visible, because the overlay
 * paints no background of its own.
 *
 * The picture is drawn as large as the screen allows and can be zoomed with
 * `=` / `-` or Ctrl+wheel, and moved with the arrows, `hjkl`, the wheel, or
 * Shift+wheel for the sideways axis. The cross in the top right corner closes
 * it again.
 */
export class ImageOverlay {
  readonly root: BoxRenderable;

  private readonly window: BoxRenderable;
  private readonly image: ImageRenderable;
  private readonly closeBox: BoxRenderable;
  private readonly hintBar: BoxRenderable;
  private readonly hint: TextRenderable;

  private url: string | null = null;
  private zoom = 1; // 1: as large as the screen allows
  private pan: Point = { x: 0, y: 0 };

  constructor(
    private readonly ctx: RenderContext,
    private readonly props: ImageOverlayProps,
  ) {
    this.root = new BoxRenderable(ctx, {
      id: "image-overlay",
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      // A translucent veil, not a wall: the mail is still there behind it.
      backgroundColor: SCRIM,
      visible: false,
      onMouseScroll: (event: MouseEvent) => this.onScroll(event),
    });

    // Clips the picture when zooming goes past the edges of the screen.
    this.window = new BoxRenderable(ctx, {
      id: "image-overlay-window",
      position: "absolute",
      left: 0,
      top: 0,
      overflow: "hidden",
    });

    this.image = new ImageRenderable(ctx, {
      id: "image-overlay-image",
      source: "",
      fit: "fit",
      protocol: "auto",
      position: "absolute",
      left: 0,
      top: 0,
      // Pixels arrive after the first layout, and change the shape.
      onLoad: () => this.arrange(),
    });

    this.closeBox = new BoxRenderable(ctx, {
      id: "image-overlay-close",
      position: "absolute",
      left: 0,
      top: 0,
      width: CLOSE_WIDTH,
      height: CLOSE_HEIGHT,
      border: true,
      borderStyle: "single",
      // The colour a pane's border takes while it has focus.
      borderColor: theme.borderFocus,
      backgroundColor: theme.bg,
      alignItems: "center",
      justifyContent: "center",
      onMouseDown: (event: MouseEvent) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        this.close();
      },
    });
    this.closeBox.add(
      new TextRenderable(ctx, {
        id: "image-overlay-close-mark",
        content: "×",
        fg: theme.strong,
        wrapMode: "none",
        flexShrink: 0,
      }),
    );

    // A painted strip across the bottom: the footer behind it would otherwise
    // read through the gaps between the words.
    this.hintBar = new BoxRenderable(ctx, {
      id: "image-overlay-hint",
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: 1,
      backgroundColor: theme.bg,
    });
    this.hint = new TextRenderable(ctx, {
      id: "image-overlay-hint-text",
      content: "",
      fg: theme.muted,
      wrapMode: "none",
      textAlign: "center",
      width: "100%",
    });
    this.hintBar.add(this.hint);

    this.window.add(this.image);
    this.root.add(this.window);
    this.root.add(this.closeBox);
    this.root.add(this.hintBar);
  }

  /** True while a picture is being looked at: the app sends it the keys. */
  get isOpen(): boolean {
    return this.root.visible;
  }

  /** The picture on show, if any. */
  get shownUrl(): string | null {
    return this.url;
  }

  open(url: string): void {
    this.url = url;
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.image.source = url;
    this.root.visible = true;
    this.arrange();
  }

  close(): void {
    if (!this.root.visible) return;
    this.root.visible = false;
    this.url = null;
    this.props.onClose();
  }

  /** `=` (1) or `-` (-1): the picture grows or shrinks; the screen does not. */
  zoomBy(direction: 1 | -1): void {
    this.zoom = stepZoom(this.zoom, direction);
    this.arrange();
  }

  /** Move the part of the picture being looked at. */
  panBy(dx: number, dy: number): void {
    this.pan = { x: this.pan.x + dx, y: this.pan.y + dy };
    this.arrange();
  }

  /** The arrow keys, `hjkl`, the zoom keys, and the ways out. */
  handleKey(key: KeyEvent): boolean {
    const name = key.name;

    if (name === "escape" || name === "q") {
      this.close();
      return true;
    }
    if (name === "=" || name === "+" || name === "equal") {
      this.zoomBy(1);
      return true;
    }
    if (name === "-" || name === "minus" || name === "_") {
      this.zoomBy(-1);
      return true;
    }
    if (name === "0") {
      // Back to the whole picture, centred.
      this.zoom = clampZoom(1);
      this.pan = { x: 0, y: 0 };
      this.arrange();
      return true;
    }

    if (name === "h" || name === "left") {
      this.panBy(-PAN_STEP_X, 0);
      return true;
    }
    if (name === "l" || name === "right") {
      this.panBy(PAN_STEP_X, 0);
      return true;
    }
    if (name === "k" || name === "up") {
      this.panBy(0, -PAN_STEP_Y);
      return true;
    }
    if (name === "j" || name === "down") {
      this.panBy(0, PAN_STEP_Y);
      return true;
    }

    return false;
  }

  /** Size the window to the screen and put the picture in the middle of it. */
  arrange(): void {
    const width = Math.max(8, screenWidth(this.ctx));
    const height = Math.max(4, screenHeight(this.ctx));

    const windowHeight = Math.max(1, height - TOP_ROWS - HINT_ROWS);
    this.window.width = width;
    this.window.height = windowHeight;
    this.window.left = 0;
    this.window.top = TOP_ROWS;

    const viewport: Size = { width, height: windowHeight };

    const picture = this.fittedSize(viewport);
    this.image.width = picture.width;
    this.image.height = picture.height;

    this.pan = clampPan(this.pan, viewport, picture);
    const { left, top } = placeImage(viewport, picture, this.pan);
    this.image.left = left;
    this.image.top = top;

    // The cross sits in the very corner of the screen, out of the picture's way.
    this.closeBox.left = Math.max(0, width - CLOSE_WIDTH);
    this.closeBox.top = 0;

    this.hint.content = t`${strong(zoomLabel(this.zoom))} · ${strong("=/-")} or ${strong("ctrl+wheel")} zoom · ${strong("h/j/k/l")} or ${strong("←/↓/↑/→")} or ${strong("wheel/shift+wheel")} move · ${strong("esc")} close`;
    this.hintBar.top = height - HINT_ROWS;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * The picture at the current zoom: still the largest size that keeps its
   * shape, but fitted into a screen that many times larger.
   */
  private fittedSize(viewport: Size): Size {
    const { width, height } = this.image.getFittedSize(
      Math.max(1, Math.round(viewport.width * this.zoom)),
      Math.max(1, Math.round(viewport.height * this.zoom)),
    );

    // Before the pixels arrive the shape is unknown; stay inside the window.
    if (width <= 0 || height <= 0) return { width: 1, height: 1 };
    return { width, height };
  }

  /**
   * The wheel: on its own it moves up and down the picture, with Ctrl it zooms,
   * and with Shift it moves sideways — the same gestures as in a browser.
   */
  private onScroll(event: MouseEvent): void {
    if (!this.isOpen || event.scroll === undefined) return;
    const { direction } = event.scroll;

    if (event.modifiers.ctrl) {
      if (direction === "up") this.zoomBy(1);
      else if (direction === "down") this.zoomBy(-1);
      return;
    }

    if (event.modifiers.shift) {
      if (direction === "up") this.panBy(-PAN_STEP_X, 0);
      else if (direction === "down") this.panBy(PAN_STEP_X, 0);
      else if (direction === "left") this.panBy(-PAN_STEP_X, 0);
      else this.panBy(PAN_STEP_X, 0);
      return;
    }

    switch (direction) {
      case "up":
        this.panBy(0, -PAN_STEP_Y);
        return;
      case "down":
        this.panBy(0, PAN_STEP_Y);
        return;
      case "left":
        this.panBy(-PAN_STEP_X, 0);
        return;
      default:
        this.panBy(PAN_STEP_X, 0);
    }
  }
}
