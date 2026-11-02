import type { SiftCore } from "../../core";
import { resolveLinks } from "../../core/links";
import type { MailSummary } from "../types";

/** One message as yielded by `SiftCore.getMessagesStream`. */
export type CoreMessage =
  ReturnType<SiftCore["getMessagesStream"]> extends AsyncGenerator<
    infer T,
    unknown,
    unknown
  >
    ? T
    : never;

/** The label AgentMail uses for unread mail. Marking as read removes it. */
export const UNREAD_LABEL = "unread";

export const isUnread = (labels: readonly string[]): boolean =>
  labels.includes(UNREAD_LABEL);

/** Map a core message onto the TUI's view model. */
export function toMailSummary(message: CoreMessage): MailSummary {
  const labels = message.labels ?? [];
  return {
    id: message.id,
    from: message.from ?? "",
    subject: message.subject ?? "",
    receivedAt: new Date(message.recievedAt),
    labels,
    unread: isUnread(labels),
    text: message.text ?? "",
    content: message.body,
  };
}

/**
 * The message as readable text. Uses the plain text when there is one, and
 * otherwise turns the processed markdown back into text, resolving the masked
 * link placeholders (`[text](LINK_3)`) to the real URLs.
 */
export function plainTextOf(mail: MailSummary): string {
  const text = mail.text.trim();
  if (text !== "") return text;

  // The processed body carries placeholders, not addresses; resolve them so the
  // preview shows the real links.
  return resolveLinks(mail.content.content, mail.content.links)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
