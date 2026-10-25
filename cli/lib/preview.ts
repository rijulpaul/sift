/**
 * What the preview pane shows, as pure functions of the mail and its summary.
 * No renderer imports, so these are unit-tested without a terminal.
 */
import type { SummaryState } from "../state";
import type { MailSummary } from "../types";
import { plainTextOf } from "./mail";

export const PREVIEW_EMPTY_MESSAGE = "Select a message to read it.";
export const SUMMARY_PENDING_MESSAGE = "Summarizing…";
export const NO_CONTENT_MESSAGE = "(no content)";

export interface BodyView {
  text: string;
  /** Rendered dimmed: placeholders and errors, not message content. */
  dim: boolean;
}

/**
 * The body text. With `showSummary` it is the summary (live while it streams);
 * otherwise it is the message text.
 */
export function bodyView(
  mail: MailSummary,
  showSummary: boolean,
  summary: SummaryState | undefined,
): BodyView {
  if (!showSummary) {
    const text = plainTextOf(mail);
    return text === ""
      ? { text: NO_CONTENT_MESSAGE, dim: true }
      : { text, dim: false };
  }

  if (
    summary === undefined ||
    (summary.status === "streaming" && summary.text === "")
  ) {
    return { text: SUMMARY_PENDING_MESSAGE, dim: true };
  }

  if (summary.status === "error") {
    // Keep any partial summary, and say why it stopped.
    if (summary.text === "") {
      return {
        text: `Couldn't summarize this message.\n${summary.error ?? "Unknown error."}\n\nPress s to try again.`,
        dim: true,
      };
    }
    return {
      text: `${summary.text}\n\n— Summary interrupted: ${summary.error ?? "unknown error"}`,
      dim: false,
    };
  }

  return { text: summary.text, dim: false };
}

/** Label of the summary button: it switches to whichever view is not showing. */
export const summaryActionLabel = (showSummary: boolean): string =>
  showSummary ? "Show text" : "Summarize";

/** Label of the read button: it switches the mail to the other state. */
export const readActionLabel = (unread: boolean): string =>
  unread ? "Mark as read" : "Mark as unread";

/** Labels as a single line, or a dash when the message has none. */
export const labelsLine = (labels: readonly string[]): string =>
  labels.length === 0 ? "—" : labels.join("  ·  ");
