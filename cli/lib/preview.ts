/**
 * What the preview pane shows, as pure functions of the mail and its summary.
 * No renderer imports, so these are unit-tested without a terminal.
 */
import type { BodyState, SummaryState } from "../state";
import { plainTextOf } from "./mail";

export const PREVIEW_EMPTY_MESSAGE = "Select a message to read it.";
export const BODY_PENDING_MESSAGE = "Loading…";
export const SUMMARY_PENDING_MESSAGE = "Summarizing…";
export const NO_CONTENT_MESSAGE = "(no content)";

export interface BodyView {
  text: string;
  /** Rendered dimmed: placeholders and errors, not message content. */
  dim: boolean;
}

/** A failure the reader can act on: what failed, why, and how to retry. */
const failureText = (what: string, reason: string, retry: string): string =>
  `Couldn't ${what}.\n${reason}\n\n${retry}`;

/**
 * The body text. With `showSummary` it is the summary (live while it streams);
 * otherwise it is the message text. `body` is undefined until the message has
 * been fetched, which happens when it is opened.
 */
export function bodyView(
  body: BodyState | undefined,
  showSummary: boolean,
  summary: SummaryState | undefined,
): BodyView {
  if (body === undefined || body.status === "loading") {
    return { text: BODY_PENDING_MESSAGE, dim: true };
  }

  if (body.status === "error") {
    return {
      text: failureText(
        "load this message",
        body.message,
        "Press enter to try again.",
      ),
      dim: true,
    };
  }

  if (!showSummary) {
    const text = plainTextOf(body.body);
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
        text: failureText(
          "summarize this message",
          summary.error ?? "Unknown error.",
          "Press s to try again.",
        ),
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
