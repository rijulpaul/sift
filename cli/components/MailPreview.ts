import {
  BoxRenderable,
  TextRenderable,
  type RenderContext,
  type ScrollBoxRenderable,
} from "@opentui/core";

import { formatFullDate, parseSender } from "../lib/format";
import {
  PREVIEW_EMPTY_MESSAGE,
  bodyView,
  labelsLine,
  readActionLabel,
  summaryActionLabel,
} from "../lib/preview";
import type { SummaryState } from "../state";
import { attr, theme } from "../theme";
import type { MailSummary } from "../types";
import { Button, ACTION_STYLE } from "./Button";
import { Pane, Placeholder, createScrollBox } from "./primitives";

export type PreviewView =
  | { kind: "empty" }
  | {
      kind: "mail";
      mail: MailSummary;
      showSummary: boolean;
      summary: SummaryState | undefined;
      confirming: boolean;
    };

export interface PreviewProps {
  /** The pane was clicked (focus the preview). */
  onActivate: () => void;
  onSummary: () => void;
  onMarkRead: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/** `Label   value` line in the message header. Wraps long values. */
class MetaRow {
  readonly root: BoxRenderable;
  private readonly value: TextRenderable;

  constructor(ctx: RenderContext, id: string, label: string) {
    this.root = new BoxRenderable(ctx, {
      id,
      width: "100%",
      flexDirection: "row",
      flexShrink: 0,
    });
    this.root.add(
      new TextRenderable(ctx, {
        id: `${id}-label`,
        content: label.padEnd(8),
        fg: theme.faint,
        width: 8,
        flexShrink: 0,
      }),
    );
    this.value = new TextRenderable(ctx, {
      id: `${id}-value`,
      content: "",
      fg: theme.muted,
      wrapMode: "word",
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
    });
    this.root.add(this.value);
  }

  set(text: string): void {
    this.value.content = text;
  }
}

/**
 * The right pane: the message header (subject, from, date, labels), the
 * actions, and the body (its text, or its summary), all in one scroll view.
 */
export class MailPreview {
  readonly pane: Pane;

  private readonly scroll: ScrollBoxRenderable;
  private readonly placeholder: Placeholder;
  private readonly subject: TextRenderable;
  private readonly from: MetaRow;
  private readonly date: MetaRow;
  private readonly labels: MetaRow;
  private readonly actions: BoxRenderable;
  private readonly confirmRow: BoxRenderable;
  private readonly summaryButton: Button;
  private readonly readButton: Button;
  private readonly deleteButton: Button;
  private readonly body: TextRenderable;
  private shownId: string | null = null;

  constructor(ctx: RenderContext, props: PreviewProps) {
    this.pane = new Pane(ctx, {
      id: "mail-preview",
      title: "Message",
      onActivate: props.onActivate,
    });

    this.scroll = createScrollBox(ctx, "mail-preview-scroll");
    this.scroll.contentOptions = {
      backgroundColor: theme.surface,
      flexDirection: "column",
      padding: 1,
      gap: 0,
    };

    this.subject = new TextRenderable(ctx, {
      id: "mail-preview-subject",
      content: "",
      fg: theme.strong,
      attributes: attr.bold,
      wrapMode: "word",
      width: "100%",
      flexShrink: 0,
    });
    this.from = new MetaRow(ctx, "mail-preview-from", "From");
    this.date = new MetaRow(ctx, "mail-preview-date", "Date");
    this.labels = new MetaRow(ctx, "mail-preview-labels", "Labels");

    this.actions = new BoxRenderable(ctx, {
      id: "mail-preview-actions",
      width: "100%",
      height: 1,
      flexDirection: "row",
      flexShrink: 0,
      marginTop: 1,
    });
    this.summaryButton = new Button(ctx, {
      id: "mail-preview-summary",
      label: summaryActionLabel(false),
      onPress: props.onSummary,
    });
    this.readButton = new Button(ctx, {
      id: "mail-preview-read",
      label: readActionLabel(true),
      onPress: props.onMarkRead,
    });
    this.deleteButton = new Button(ctx, {
      id: "mail-preview-delete",
      label: "Delete",
      onPress: props.onDelete,
    });
    this.actions.add(this.summaryButton.root);
    this.actions.add(this.readButton.root);
    this.actions.add(this.deleteButton.root);

    // Shown in place of the actions while a delete awaits confirmation.
    this.confirmRow = new BoxRenderable(ctx, {
      id: "mail-preview-confirm",
      width: "100%",
      height: 1,
      flexDirection: "row",
      flexShrink: 0,
      marginTop: 1,
      visible: false,
    });
    this.confirmRow.add(
      new TextRenderable(ctx, {
        id: "mail-preview-confirm-text",
        content: "Delete this message?",
        fg: theme.strong,
        attributes: attr.bold,
        wrapMode: "none",
        marginRight: 2,
        flexShrink: 0,
      }),
    );
    this.confirmRow.add(
      new Button(ctx, {
        id: "mail-preview-confirm-yes",
        label: "Yes, delete",
        onPress: props.onConfirmDelete,
      }).root,
    );
    this.confirmRow.add(
      new Button(ctx, {
        id: "mail-preview-confirm-no",
        label: "Cancel",
        style: ACTION_STYLE,
        onPress: props.onCancelDelete,
      }).root,
    );

    // A one-row horizontal rule that stretches with the pane.
    const rule = new BoxRenderable(ctx, {
      id: "mail-preview-rule",
      width: "100%",
      height: 1,
      flexShrink: 0,
      marginY: 1,
      border: ["top"],
      borderColor: theme.border,
    });

    this.body = new TextRenderable(ctx, {
      id: "mail-preview-body",
      content: "",
      fg: theme.text,
      wrapMode: "word",
      width: "100%",
      flexShrink: 0,
    });

    this.scroll.add(this.subject);
    this.scroll.add(this.from.root);
    this.scroll.add(this.date.root);
    this.scroll.add(this.labels.root);
    this.scroll.add(this.actions);
    this.scroll.add(this.confirmRow);
    this.scroll.add(rule);
    this.scroll.add(this.body);

    this.placeholder = new Placeholder(ctx, "mail-preview-placeholder");
    this.pane.add(this.scroll);
    this.pane.add(this.placeholder.root);

    this.show({ kind: "empty" });
  }

  get root() {
    return this.pane.root;
  }

  setFocused(focused: boolean): void {
    this.pane.setFocused(focused);
  }

  show(view: PreviewView): void {
    if (view.kind === "empty") {
      this.shownId = null;
      this.scroll.visible = false;
      this.placeholder.show(PREVIEW_EMPTY_MESSAGE);
      return;
    }

    const { mail, showSummary, summary, confirming } = view;
    this.placeholder.hide();
    this.scroll.visible = true;

    const sender = parseSender(mail.from);
    this.subject.content = mail.subject.trim() || "(no subject)";
    this.from.set(
      sender.name === sender.address
        ? sender.address
        : `${sender.name} <${sender.address}>`,
    );
    this.date.set(formatFullDate(mail.receivedAt));
    this.labels.set(labelsLine(mail.labels));

    this.actions.visible = !confirming;
    this.confirmRow.visible = confirming;
    this.summaryButton.setLabel(summaryActionLabel(showSummary));
    this.readButton.setLabel(readActionLabel(mail.unread));

    const { text, dim } = bodyView(mail, showSummary, summary);
    this.body.content = text;
    this.body.fg = dim ? theme.muted : theme.text;

    // A different mail starts at the top; refreshes of the same one keep position.
    if (this.shownId !== mail.id) this.scroll.scrollTo(0);
    this.shownId = mail.id;
  }

  scrollBy(lines: number): void {
    this.scroll.scrollBy(lines);
  }

  scrollToTop(): void {
    this.scroll.scrollTo(0);
  }

  scrollToBottom(): void {
    this.scroll.scrollTo(this.scroll.scrollHeight);
  }

  /** Lines to move for a page jump, keeping one line of context. */
  pageSize(): number {
    return Math.max(1, this.scroll.viewport.height - 1);
  }
}
