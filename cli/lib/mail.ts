import type { SiftCore } from "../../core";
import { resolveLinks } from "../../core/links";
import type { MailBody, MailSummary } from "../types";

/** One row as `SiftCore.listMessages` yields it. */
export type CoreListItem =
  ReturnType<SiftCore["listMessages"]> extends AsyncGenerator<
    infer T,
    unknown,
    unknown
  >
    ? T
    : never;

/** A whole message, as `SiftCore.getMessage` returns it. */
export type CoreMessageDetail = Awaited<ReturnType<SiftCore["getMessage"]>>;

/** The label AgentMail uses for unread mail. Marking as read removes it. */
export const UNREAD_LABEL = "unread";

export const isUnread = (labels: readonly string[]): boolean =>
  labels.includes(UNREAD_LABEL);

/** Map a list row onto the TUI's view model. */
export function toMailSummary(item: CoreListItem): MailSummary {
  const labels = item.labels ?? [];
  return {
    id: item.id,
    from: item.from ?? "",
    subject: item.subject ?? "",
    receivedAt: new Date(item.receivedAt),
    labels,
    unread: isUnread(labels),
  };
}

/** Map a fetched message onto the body the preview shows. */
export function toMailBody(detail: CoreMessageDetail): MailBody {
  return { text: detail.text ?? "", content: detail.body };
}

/**
 * The message as the markdown the preview renders. The core already hands back
 * markdown (the newsletter is converted once, for both the reader and the
 * agent); when only the processed body is available, its masked placeholders
 * (`[text](LINK_3)`) are resolved first so the links are real.
 */
export function markdownOf(body: MailBody): string {
  const text = body.text.trim();
  if (text !== "") return text;

  return resolveLinks(body.content.content, body.content.links)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
