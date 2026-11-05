import {
  BoxRenderable,
  ImageRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  TextRenderable,
  type RenderContext,
  type ScrollBoxRenderable,
} from "@opentui/core";

import { formatFullDate, parseSender } from "../lib/format";
import {
  PREVIEW_EMPTY_MESSAGE,
  bodySegments,
  bodyView,
  imageCaption,
  labelsLine,
  readActionLabel,
  summaryActionLabel,
  type BodySegmentSpec,
  type TextStyle,
} from "../lib/preview";
import type { BodyState, SummaryState } from "../state";
import { attr, theme } from "../theme";
import type { MailSummary } from "../types";
import { Button, ACTION_STYLE } from "./Button";
import { Pane, Placeholder, createScrollBox } from "./primitives";

/** Most of the screen a picture may span, however wide the terminal is. */
const IMAGE_WIDTH_RATIO = 0.75;

/**
 * Most of the screen a picture may span vertically. A picture still keeps its
 * shape: whatever hits its limit first wins, so tall art stops here and wide
 * art stops at the width above. A summary should not become a gallery.
 */
const IMAGE_HEIGHT_RATIO = 0.5;

export type PreviewView =
  | { kind: "empty" }
  | {
      kind: "mail";
      mail: MailSummary;
      /** Undefined until the message has been fetched. */
      body: BodyState | undefined;
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

/** A picture, drawn with its address underneath. */
type ImageSegment = Extract<BodySegment, { kind: "image" }>;

/** What is drawn. Kept between renders so a stream only changes what changed. */
/** The look of each style of text. */
const TEXT_STYLE: Record<TextStyle, { fg: string; attributes: number }> = {
  title: { fg: theme.strong, attributes: attr.bold },
  body: { fg: theme.text, attributes: attr.none },
  note: { fg: theme.muted, attributes: attr.none },
};

/**
 * How the message's own markdown is drawn: the same monotone palette, with
 * weight and colour doing the work instead of syntax colours. `conceal` hides
 * the markers (`#`, `**`, `[]()`), so the reader sees prose, not source.
 */
const MARKDOWN_STYLE: Record<
  string,
  {
    fg?: string;
    bg?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
  }
> = {
  default: { fg: theme.text },
  conceal: { fg: theme.faint },
  // The highlighter scopes headings per level (`markup.heading.1`…`.6`), so
  // every level is styled rather than just the first.
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((level) => [
      `markup.heading.${level}`,
      { fg: theme.strong, bold: true },
    ]),
  ),
  "markup.strong": { fg: theme.strong, bold: true },
  "markup.italic": { fg: theme.text, italic: true },
  "markup.strikethrough": { fg: theme.muted },
  "markup.raw": { fg: theme.text, bg: theme.raised },
  "markup.quote": { fg: theme.muted, italic: true },
  "markup.list": { fg: theme.strong },
  "markup.link": { fg: theme.muted },
  "markup.link.label": { fg: theme.text, underline: true },
  "markup.link.url": { fg: theme.faint, underline: true },
};

type BodySegment =
  | { kind: "markdown"; node: MarkdownRenderable; text: string }
  | { kind: "text"; node: TextRenderable; text: string; style: TextStyle }
  | {
      kind: "image";
      node: ImageRenderable;
      caption: TextRenderable;
      url: string;
    };

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
 * actions, and the body — its text, or its summary with pictures drawn in it.
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
  /** Holds the body segments: paragraphs of text, and pictures. */
  private readonly body: BoxRenderable;
  /** Shared by every markdown segment: one style table for the pane. */
  private readonly markdownStyle: SyntaxStyle;
  private segments: BodySegment[] = [];
  private segmentId = 0;
  /** Room the pictures were last fitted into, so a resize can re-fit them. */
  private fittedWidth = 0;
  private fittedRows = 0;
  private shownId: string | null = null;

  constructor(
    private readonly ctx: RenderContext,
    props: PreviewProps,
  ) {
    this.pane = new Pane(ctx, {
      id: "mail-preview",
      title: "Message",
      onActivate: props.onActivate,
    });

    this.markdownStyle = SyntaxStyle.fromStyles(
      MARKDOWN_STYLE,
      ctx.nativeScene,
    );

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

    this.body = new BoxRenderable(ctx, {
      id: "mail-preview-body",
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      // One row between sections: paragraphs, pictures and notes are told
      // apart without the pane turning into empty space.
      gap: 1,
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

    // Layout is final after each frame, which is where a resize is noticed.
    ctx.on("frame", this.onFrame);

    this.show({ kind: "empty" });
  }

  dispose(): void {
    this.ctx.off("frame", this.onFrame);
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
      this.setSegments([]);
      this.placeholder.show(PREVIEW_EMPTY_MESSAGE);
      return;
    }

    const { mail, body, showSummary, summary, confirming } = view;
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

    this.setSegments(bodySegments(bodyView(body, showSummary, summary)));

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

  // ── the body ──────────────────────────────────────────────────────────────

  /**
   * Bring the drawn segments in line with the wanted ones. Text is updated in
   * place — a summary streams into the same nodes — and anything whose shape
   * changed is rebuilt from there on.
   */
  private setSegments(wanted: BodySegmentSpec[]): void {
    for (let i = wanted.length; i < this.segments.length; i++) {
      this.destroySegment(this.segments[i]!);
    }
    this.segments.length = Math.min(this.segments.length, wanted.length);

    for (let i = 0; i < wanted.length; i++) {
      const want = wanted[i]!;
      const have = this.segments[i];

      if (have === undefined || have.kind !== want.kind) {
        for (let j = i; j < this.segments.length; j++) {
          this.destroySegment(this.segments[j]!);
        }
        this.segments.length = i;
        for (let j = i; j < wanted.length; j++) {
          this.segments.push(this.createSegment(wanted[j]!));
        }
        return;
      }

      if (have.kind === "markdown" && want.kind === "markdown") {
        if (have.text !== want.text) {
          have.text = want.text;
          have.node.content = want.text; // re-parsed, and re-wrapped to the pane
        }
        continue;
      }

      if (have.kind === "text" && want.kind === "text") {
        if (have.text !== want.text) {
          have.text = want.text;
          have.node.content = want.text;
        }
        if (have.style !== want.style) {
          have.style = want.style;
          this.applyTextStyle(have.node, want.style);
        }
        continue;
      }

      if (
        have.kind === "image" &&
        want.kind === "image" &&
        have.url !== want.url
      ) {
        have.url = want.url;
        have.caption.content = imageCaption(want.url);
        have.node.source = want.url; // reloads, and re-fits on load
      }
    }
  }

  private createSegment(want: BodySegmentSpec): BodySegment {
    const id = `mail-preview-segment-${this.segmentId++}`;

    if (want.kind === "markdown") {
      const node = new MarkdownRenderable(this.ctx, {
        id,
        content: want.text,
        syntaxStyle: this.markdownStyle,
        fg: theme.text,
        // Markers are hidden: the reader gets the writing, not the source.
        conceal: true,
        width: "100%",
        flexShrink: 0,
      });
      this.body.add(node);
      return { kind: "markdown", node, text: want.text };
    }

    if (want.kind === "text") {
      const node = new TextRenderable(this.ctx, {
        id,
        content: want.text,
        ...TEXT_STYLE[want.style],
        // Character wrapping: addresses are long and unbroken, and must wrap
        // rather than be clipped.
        wrapMode: "char",
        width: "100%",
        flexShrink: 0,
      });
      this.body.add(node);
      return { kind: "text", node, text: want.text, style: want.style };
    }

    const caption = new TextRenderable(this.ctx, {
      id: `${id}-caption`,
      content: imageCaption(want.url),
      fg: theme.faint,
      wrapMode: "char",
      textAlign: "center",
      width: "100%",
      flexShrink: 0,
    });
    const node = new ImageRenderable(this.ctx, {
      id: `${id}-image`,
      source: want.url,
      fit: "fit",
      // Kitty or sixel where the terminal has them, blocks everywhere else.
      protocol: "auto",
      flexShrink: 0,
      onLoad: () => {
        if (segment !== undefined) this.fitImage(segment);
      },
      onError: () => {
        caption.content = imageCaption(want.url, true);
      },
    });
    let segment: ImageSegment | undefined;

    // The caption belongs to the picture: no gap between them, or the two
    // would look like separate sections.
    const frame = new BoxRenderable(this.ctx, {
      id: `${id}-frame`,
      width: "100%",
      flexDirection: "column",
      flexShrink: 0,
      // Pictures sit in the middle of the pane; the caption fills the width and
      // centres its own text under them.
      alignItems: "center",
    });
    frame.add(node);
    frame.add(caption);
    this.body.add(frame);

    segment = { kind: "image", node, caption, url: want.url };
    return segment;
  }

  private destroySegment(segment: BodySegment): void {
    if (segment.kind === "image") {
      const frame = segment.node.parent;
      if (frame !== null) this.body.remove(frame);
      frame?.destroyRecursively();
      return;
    }

    this.body.remove(segment.node);
    segment.node.destroyRecursively();
  }

  private applyTextStyle(node: TextRenderable, style: TextStyle): void {
    node.fg = TEXT_STYLE[style].fg;
    node.attributes = TEXT_STYLE[style].attributes;
  }

  /** Scale a picture to the pane, keeping its shape. */
  private fitImage(segment: ImageSegment): void {
    const width = this.imageMaxWidth();
    if (width <= 0) return;

    const { width: fitted, height } = segment.node.getFittedSize(
      width,
      this.imageMaxRows(),
    );
    if (fitted <= 0 || height <= 0) return; // the pixels are not here yet

    segment.node.width = fitted;
    segment.node.height = height;
  }

  /** Columns a segment may use. */
  private contentWidth(): number {
    const width = this.body.width;
    if (width > 0) return width;
    return Math.max(8, this.scroll.viewport.width - 2);
  }

  /**
   * Columns a picture may use: the pane, but never more than three quarters of
   * the screen, so a picture cannot take over a wide terminal.
   */
  private imageMaxWidth(): number {
    const screen = this.ctx.terminalWidth ?? this.ctx.width;
    return Math.max(
      8,
      Math.min(this.contentWidth(), Math.floor(screen * IMAGE_WIDTH_RATIO)),
    );
  }

  /**
   * Rows a picture may use: the terminal's height allows a picture to grow
   * with the window, so a fullscreen summary shows real art rather than a
   * stamp, while a short terminal keeps it modest.
   */
  private imageMaxRows(): number {
    const screen = this.ctx.terminalHeight ?? this.ctx.height;
    return Math.max(4, Math.floor(screen * IMAGE_HEIGHT_RATIO));
  }

  /** A resize changes the room pictures should be drawn into. */
  private readonly onFrame = (): void => {
    const width = this.contentWidth();
    const rows = this.imageMaxRows();
    if (width <= 0) return;
    if (width === this.fittedWidth && rows === this.fittedRows) return;

    this.fittedWidth = width;
    this.fittedRows = rows;
    for (const segment of this.segments) {
      if (segment.kind === "image") this.fitImage(segment);
    }
  };
}
