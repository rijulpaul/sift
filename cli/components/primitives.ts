import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type MouseEvent,
  type Renderable,
  type RenderContext,
} from "@opentui/core";

import { theme } from "../theme";

/** A scroll container with the TUI's monotone scrollbar. */
export function createScrollBox(
  ctx: RenderContext,
  id: string,
): ScrollBoxRenderable {
  return new ScrollBoxRenderable(ctx, {
    id,
    flexGrow: 1,
    width: "100%",
    // Drawing only what is on screen keeps long mailboxes cheap.
    viewportCulling: true,
    rootOptions: { backgroundColor: theme.surface },
    wrapperOptions: { backgroundColor: theme.surface },
    viewportOptions: { backgroundColor: theme.surface },
    contentOptions: { backgroundColor: theme.surface },
    verticalScrollbarOptions: {
      showArrows: false,
      trackOptions: {
        foregroundColor: theme.faint,
        backgroundColor: theme.surface,
      },
    },
  });
}

/** A centred, dim, single-message block used for empty / loading / error states. */
export class Placeholder {
  readonly root: BoxRenderable;
  private readonly text: TextRenderable;

  constructor(ctx: RenderContext, id: string) {
    this.root = new BoxRenderable(ctx, {
      id,
      flexGrow: 1,
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      padding: 2,
      backgroundColor: theme.surface,
    });
    this.text = new TextRenderable(ctx, {
      id: `${id}-text`,
      content: "",
      fg: theme.muted,
      wrapMode: "word",
      textAlign: "center",
    });
    this.root.add(this.text);
  }

  show(message: string): void {
    this.text.content = message;
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }
}

export interface PaneOptions {
  id: string;
  title: string;
  /** Fired when the pane is clicked (and the click was not handled by a child). */
  onActivate?: () => void;
}

/**
 * A bordered, titled panel whose border brightens while it has focus.
 * Reused by the list and the preview so they always look and behave alike.
 */
export class Pane {
  readonly root: BoxRenderable;

  constructor(ctx: RenderContext, options: PaneOptions) {
    this.root = new BoxRenderable(ctx, {
      id: options.id,
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      borderColor: theme.border,
      title: ` ${options.title} `,
      titleColor: theme.muted,
      backgroundColor: theme.surface,
      overflow: "hidden",
      onMouseDown: (event: MouseEvent) => {
        if (event.button === 0) options.onActivate?.();
      },
    });
  }

  add(child: Renderable): void {
    this.root.add(child);
  }

  setTitle(title: string): void {
    this.root.title = ` ${title} `;
  }

  setFocused(focused: boolean): void {
    this.root.borderColor = focused ? theme.borderFocus : theme.border;
    this.root.titleColor = focused ? theme.text : theme.muted;
  }
}
