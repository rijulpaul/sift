import {
  BoxRenderable,
  TextRenderable,
  type MouseEvent,
  type RenderContext,
} from "@opentui/core";

import { textWidth } from "../lib/fit";
import { attr, theme } from "../theme";

export interface ButtonStyle {
  fg: string;
  bg: string;
  bold: boolean;
}

/** The default look for an action the user can take. */
export const ACTION_STYLE: ButtonStyle = {
  fg: theme.text,
  bg: theme.raised,
  bold: true,
};

/** Dimmed look for an action that is not available right now. */
export const DISABLED_STYLE: ButtonStyle = {
  fg: theme.faint,
  bg: theme.surface,
  bold: false,
};

export interface ButtonOptions {
  id: string;
  label: string;
  onPress: () => void;
  style?: ButtonStyle;
}

/**
 * A one-row clickable label. It is only the mouse path: every button has a
 * key shortcut, and the footer lists them.
 */
export class Button {
  readonly root: BoxRenderable;
  private readonly text: TextRenderable;
  private style: ButtonStyle;
  private enabled = true;

  constructor(ctx: RenderContext, options: ButtonOptions) {
    this.style = options.style ?? ACTION_STYLE;

    this.root = new BoxRenderable(ctx, {
      id: options.id,
      height: 1,
      flexShrink: 0,
      paddingX: 1,
      marginRight: 1,
      onMouseDown: (event: MouseEvent) => {
        if (event.button !== 0 || !this.enabled) return;
        event.stopPropagation();
        options.onPress();
      },
    });

    this.text = new TextRenderable(ctx, {
      id: `${options.id}-label`,
      content: options.label,
      wrapMode: "none",
    });
    this.root.add(this.text);

    this.setLabel(options.label);
    this.applyStyle();
  }

  setLabel(label: string): void {
    this.text.content = label;
    // Width counts the one-cell padding on each side.
    this.root.width = textWidth(label) + 2;
  }

  setStyle(style: ButtonStyle): void {
    this.style = style;
    this.applyStyle();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private applyStyle(): void {
    this.root.backgroundColor = this.style.bg;
    this.text.fg = this.style.fg;
    this.text.attributes = this.style.bold ? attr.bold : attr.none;
  }
}
