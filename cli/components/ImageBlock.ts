import {
  BoxRenderable,
  ImageRenderable,
  TextRenderable,
  type MouseEvent,
  type RenderContext,
} from "@opentui/core";

import { imageCaption } from "../lib/preview";
import { theme } from "../theme";

/** The room a picture is fitted into: columns, and rows it may take. */
export interface ImageLimits {
  width: number;
  rows: number;
}

/**
 * A picture in the body: the image, with its address captioned underneath and
 * both centred in the pane.
 *
 * This is the one place pictures are drawn — the summary's and the message's
 * own — so they look and behave identically: scaled to fit, never taller than
 * the room allows, and saying so when the image cannot be loaded.
 */
export class ImageBlock {
  readonly root: BoxRenderable;

  private readonly node: ImageRenderable;
  private readonly caption: TextRenderable;
  private currentUrl: string;
  private limits: ImageLimits = { width: 0, rows: 0 };

  constructor(
    ctx: RenderContext,
    id: string,
    url: string,
    /** Fired on a click: the reader wants to look at this picture closely. */
    onOpen?: (url: string) => void,
  ) {
    this.currentUrl = url;
    this.caption = new TextRenderable(ctx, {
      id: `${id}-caption`,
      content: imageCaption(url),
      fg: theme.faint,
      wrapMode: "char",
      textAlign: "center",
      width: "100%",
      flexShrink: 0,
    });

    this.node = new ImageRenderable(ctx, {
      id: `${id}-image`,
      source: url,
      fit: "fit",
      // Kitty or sixel where the terminal has them, blocks everywhere else.
      protocol: "auto",
      flexShrink: 0,
      onLoad: () => this.fit(),
      onError: () => {
        this.caption.content = imageCaption(this.currentUrl, true);
      },
      onMouseDown: (event: MouseEvent) => {
        if (event.button !== 0 || onOpen === undefined) return;
        // The click is for the picture, not for focusing the pane behind it.
        event.stopPropagation();
        onOpen(this.currentUrl);
      },
    });

    // The caption belongs to the picture: no gap between them, or the two would
    // look like separate sections.
    this.root = new BoxRenderable(ctx, {
      id: `${id}-frame`,
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      // Pictures sit in the middle of the pane; the caption fills the width and
      // centres its own text under them.
      alignItems: "center",
    });
    this.root.add(this.node);
    this.root.add(this.caption);
  }

  get url(): string {
    return this.currentUrl;
  }

  /** Point the block at another picture: it reloads and re-fits itself. */
  setSource(url: string): void {
    if (url === this.currentUrl) return;
    this.currentUrl = url;
    this.caption.content = imageCaption(url);
    this.node.source = url;
  }

  /** Scale the picture into the current room, keeping its shape. */
  private fit(): void {
    const { width, rows } = this.limits;
    if (width <= 0 || rows <= 0) return;

    const { width: fitted, height } = this.node.getFittedSize(width, rows);
    if (fitted <= 0 || height <= 0) return; // the pixels are not here yet

    this.node.width = fitted;
    this.node.height = height;
  }

  /** The room changed (a resize, or a first layout): fit the picture into it. */
  setLimits(limits: ImageLimits): void {
    this.limits = limits;
    this.fit();
  }
}
