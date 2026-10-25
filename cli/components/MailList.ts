import {
  BoxRenderable,
  type RenderContext,
  type ScrollBoxRenderable,
} from "@opentui/core";

import type { Filter } from "../state";
import type { MailSummary } from "../types";
import { theme } from "../theme";
import { Button } from "./Button";
import { ITEM_HEIGHT, MailListItem } from "./MailListItem";
import { Pane, Placeholder, createScrollBox } from "./primitives";

export interface MailListProps {
  /** A row was clicked: `index` is its position in the current mails. */
  onSelect: (index: number) => void;
  /** The pane background was clicked. */
  onActivate: () => void;
  /** The All / Unread control was clicked. */
  onFilter: (filter: Filter) => void;
}

export interface ListSelection {
  cursor: number;
  openId: string | null;
  focused: boolean;
}

export const LIST_LOADING_MESSAGE = "Loading…";
export const LIST_EMPTY_MESSAGE =
  "No mail yet.\nNew messages will show up here.";
export const LIST_EMPTY_UNREAD_MESSAGE = "No unread mail.";
export const listErrorMessage = (message: string) =>
  `Couldn't load your mail.\n${message}\n\nPress r to try again.`;

const FILTER_ACTIVE = { fg: theme.strong, bg: theme.raised, bold: true };
const FILTER_IDLE = { fg: theme.muted, bg: theme.surface, bold: false };

/**
 * The left pane: an All / Unread control above a scrollable column of
 * `MailListItem`s. Rows are kept by mail id, so a streamed arrival or a
 * removal touches only that row.
 */
export class MailList {
  readonly pane: Pane;

  private readonly scroll: ScrollBoxRenderable;
  private readonly placeholder: Placeholder;
  private readonly filterAll: Button;
  private readonly filterUnread: Button;
  private items: MailListItem[] = [];
  private mails: MailSummary[] = [];

  constructor(
    private readonly ctx: RenderContext,
    private readonly props: MailListProps,
  ) {
    this.pane = new Pane(ctx, {
      id: "mail-list",
      title: "Inbox",
      onActivate: props.onActivate,
    });

    const filterRow = new BoxRenderable(ctx, {
      id: "mail-list-filter",
      height: 1,
      width: "100%",
      flexShrink: 0,
      flexDirection: "row",
      paddingX: 1,
      backgroundColor: theme.surface,
    });
    this.filterAll = new Button(ctx, {
      id: "mail-list-filter-all",
      label: "All",
      style: FILTER_ACTIVE,
      onPress: () => props.onFilter("all"),
    });
    this.filterUnread = new Button(ctx, {
      id: "mail-list-filter-unread",
      label: "Unread",
      style: FILTER_IDLE,
      onPress: () => props.onFilter("unread"),
    });
    filterRow.add(this.filterAll.root);
    filterRow.add(this.filterUnread.root);

    this.scroll = createScrollBox(ctx, "mail-list-scroll");
    this.placeholder = new Placeholder(ctx, "mail-list-placeholder");
    this.placeholder.hide();

    this.pane.add(filterRow);
    this.pane.add(this.scroll);
    this.pane.add(this.placeholder.root);

    // Layout is final after each frame, so this is where row widths are known.
    ctx.on("frame", this.onFrame);
  }

  dispose(): void {
    this.ctx.off("frame", this.onFrame);
  }

  /** Fit any row that has not been fitted to the current row width. */
  private readonly onFrame = (): void => {
    const width = this.items[0]?.root.width ?? 0;
    if (width <= 0) return;
    for (const item of this.items) {
      if (item.fittedWidth !== width) item.fit(width);
    }
  };

  get root() {
    return this.pane.root;
  }

  setTitle(title: string): void {
    this.pane.setTitle(title);
  }

  setFilter(filter: Filter): void {
    this.filterAll.setStyle(filter === "all" ? FILTER_ACTIVE : FILTER_IDLE);
    this.filterUnread.setStyle(
      filter === "unread" ? FILTER_ACTIVE : FILTER_IDLE,
    );
  }

  /**
   * Bring the rows in line with `mails`. Existing rows are updated, new ones
   * are added at the end, and rows whose mail is gone are removed.
   */
  setMails(mails: MailSummary[], now: Date): void {
    this.mails = mails;

    const existing = new Map(this.items.map((item) => [item.mailId, item]));
    const next: MailListItem[] = [];

    for (const mail of mails) {
      let item = existing.get(mail.id);
      if (item) {
        existing.delete(mail.id);
        item.update(mail, now);
      } else {
        item = new MailListItem(this.ctx, {
          mail,
          now,
          onSelect: () => this.props.onSelect(this.indexOf(mail.id)),
        });
        this.scroll.add(item.root);
      }
      next.push(item);
    }

    for (const stale of existing.values()) {
      this.scroll.remove(stale.root);
      stale.root.destroyRecursively();
    }

    this.items = next;
  }

  /** Message shown instead of the rows (empty / loading / error), or `null`. */
  setPlaceholder(message: string | null): void {
    if (message === null) {
      this.placeholder.hide();
      this.scroll.visible = true;
    } else {
      this.placeholder.show(message);
      this.scroll.visible = false;
    }
  }

  setFocused(focused: boolean): void {
    this.pane.setFocused(focused);
  }

  /** Restyle rows for the cursor / open mail and keep the cursor in view. */
  setSelection({ cursor, openId, focused }: ListSelection): void {
    this.items.forEach((item, index) => {
      item.setVisual({
        cursor: index === cursor,
        open: item.mailId === openId,
        listFocused: focused,
      });
    });

    const current = this.items[cursor];
    if (current) this.scroll.scrollChildIntoView(current.id);
  }

  /** How many rows a page jump should move. */
  pageSize(): number {
    const rows = Math.floor(this.scroll.viewport.height / ITEM_HEIGHT);
    return Math.max(1, rows - 1);
  }

  private indexOf(id: string): number {
    return this.mails.findIndex((mail) => mail.id === id);
  }
}
