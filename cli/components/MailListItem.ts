import {
  BoxRenderable,
  TextRenderable,
  type MouseEvent,
  type RenderContext,
} from "@opentui/core";

import { textWidth } from "../lib/fit";
import { formatListTime, senderLabel } from "../lib/format";
import { EllipsisText } from "./EllipsisText";
import { attr, theme } from "../theme";
import type { MailSummary } from "../types";

/** Rows per item: sender+time, subject, and one spacer row. */
export const ITEM_HEIGHT = 3;

/** Columns a row spends outside its text: the open-mail marker and 1 cell of padding per side. */
export const ITEM_CHROME = 3;

export interface MailListItemProps {
  mail: MailSummary;
  now: Date;
  /** Fired on a left click. */
  onSelect: () => void;
}

export interface ItemVisual {
  /** The keyboard cursor is on this row. */
  cursor: boolean;
  /** This mail is the one open in the preview. */
  open: boolean;
  /** The list pane has focus (dims the cursor highlight when it does not). */
  listFocused: boolean;
}

/**
 * One mailbox row:
 *
 *   ▌ ● Sender name                 14:32
 *   ▌ Subject line of the message
 *
 * `▌` marks the open mail; the highlighted background marks the cursor.
 * A row is updated in place when its mail changes, so only changed rows are
 * repainted.
 */
export class MailListItem {
  /** Renderable id, used by the list to scroll this row into view. */
  readonly id: string;
  readonly root: BoxRenderable;

  private readonly marker: BoxRenderable;
  private readonly sender: EllipsisText;
  private readonly time: TextRenderable;
  private readonly subject: EllipsisText;

  private currentMailId: string;
  private timeText = "";
  private unread = false;
  /** Row width the text was last fitted to (0 until the first layout). */
  private rowWidth = 0;

  constructor(ctx: RenderContext, { mail, now, onSelect }: MailListItemProps) {
    this.id = `mail-${mail.id}`;
    this.currentMailId = mail.id;

    this.root = new BoxRenderable(ctx, {
      id: this.id,
      width: "100%",
      height: ITEM_HEIGHT,
      flexShrink: 0,
      flexDirection: "row",
      backgroundColor: theme.surface,
      onMouseDown: (event: MouseEvent) => {
        if (event.button !== 0) return;
        // Don't let the pane's own click handler steal focus afterwards.
        event.stopPropagation();
        onSelect();
      },
    });

    this.marker = new BoxRenderable(ctx, {
      id: `${this.id}-marker`,
      width: 1,
      flexShrink: 0,
      backgroundColor: theme.surface,
    });

    const content = new BoxRenderable(ctx, {
      id: `${this.id}-content`,
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      flexDirection: "column",
      paddingX: 1,
      overflow: "hidden",
    });

    const top = new BoxRenderable(ctx, {
      id: `${this.id}-top`,
      height: 1,
      flexDirection: "row",
      overflow: "hidden",
    });

    this.sender = new EllipsisText(
      ctx,
      {
        id: `${this.id}-sender`,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
      },
      "",
    );

    this.time = new TextRenderable(ctx, {
      id: `${this.id}-time`,
      content: "",
      wrapMode: "none",
      flexShrink: 0,
      marginLeft: 1,
    });

    this.subject = new EllipsisText(
      ctx,
      {
        id: `${this.id}-subject`,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
      },
      "",
    );

    const bottom = new BoxRenderable(ctx, {
      id: `${this.id}-bottom`,
      height: 1,
      flexDirection: "row",
      overflow: "hidden",
    });

    top.add(this.sender.node);
    top.add(this.time);
    bottom.add(this.subject.node);
    content.add(top);
    content.add(bottom);
    this.root.add(this.marker);
    this.root.add(content);

    this.update(mail, now);
  }

  /** Id of the mail this row shows. */
  get mailId(): string {
    return this.currentMailId;
  }

  /** Repaint the row for a (possibly changed) mail. */
  update(mail: MailSummary, now: Date): void {
    this.currentMailId = mail.id;
    this.unread = mail.unread;

    this.sender.setText(`${mail.unread ? "● " : ""}${senderLabel(mail.from)}`);
    this.sender.node.attributes = mail.unread ? attr.bold : attr.none;

    this.timeText = formatListTime(mail.receivedAt, now);
    this.time.content = this.timeText;
    this.subject.setText(mail.subject.trim() || "(no subject)");

    this.paintText();
    if (this.rowWidth > 0) this.fit(this.rowWidth);
  }

  /**
   * Truncate the text to a row `rowWidth` cells wide. The time column keeps
   * its natural width; the sender gives way to it.
   */
  fit(rowWidth: number): void {
    this.rowWidth = rowWidth;
    const textArea = Math.max(0, rowWidth - ITEM_CHROME);
    const timeCells = textWidth(this.timeText);
    this.sender.fit(textArea - timeCells - 1);
    this.subject.fit(textArea);
  }

  /** The row's width when it was last fitted, or 0. */
  get fittedWidth(): number {
    return this.rowWidth;
  }

  setVisual({ cursor, open, listFocused }: ItemVisual): void {
    const background = cursor
      ? listFocused
        ? theme.raised
        : theme.raisedDim
      : theme.surface;
    this.root.backgroundColor = background;
    this.marker.backgroundColor = open ? theme.strong : background;

    // Already-read mail is dimmed, but not so far that it vanishes on the
    // cursor highlight.
    if (!this.unread) {
      this.sender.node.fg = cursor ? theme.text : theme.muted;
      this.subject.node.fg = cursor ? theme.muted : theme.faint;
    }
  }

  private paintText(): void {
    // Base colours. setVisual() refines them for read rows under the cursor.
    this.sender.node.fg = this.unread ? theme.strong : theme.text;
    this.subject.node.fg = this.unread ? theme.text : theme.muted;
    this.time.fg = this.unread ? theme.text : theme.muted;
  }
}
