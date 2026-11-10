/**
 * What the preview pane shows, as pure functions of the mail and its summary.
 * No renderer imports, so these are unit-tested without a terminal.
 */
import type { BodyState, SummaryState } from "../state";
import { markdownOf } from "./mail";
import { markdownSegments } from "./markdown";

export const PREVIEW_EMPTY_MESSAGE = "Select a message to read it.";
export const BODY_PENDING_MESSAGE = "Loading…";
export const SUMMARY_PENDING_MESSAGE = "Summarizing…";
export const NO_CONTENT_MESSAGE = "(no content)";

/**
 * How a piece of running text is drawn: the message's own markdown, or a plain
 * dim note (a loading / empty / failed state), which must never be parsed as
 * markdown — its punctuation is meant literally.
 */
export type TextFormat = "markdown" | "note";

/** What the pane should draw: the message, or its summary, as text. */
export interface BodyView {
  text: string;
  format: TextFormat;
}

/** A failure the reader can act on: what failed, why, and how to retry. */
const failureText = (what: string, reason: string, retry: string): string =>
  `Couldn't ${what}.\n${reason}\n\n${retry}`;

const asText = (text: string, format: TextFormat): BodyView => ({
  text,
  format,
});

/**
 * The body. With `showSummary` it is the summary (rendered as it streams);
 * otherwise it is the message text. `body` is undefined until the message has
 * been fetched, which happens when it is opened.
 */
export function bodyView(
  body: BodyState | undefined,
  showSummary: boolean,
  summary: SummaryState | undefined,
): BodyView {
  if (body === undefined || body.status === "loading") {
    return asText(BODY_PENDING_MESSAGE, "note");
  }

  if (body.status === "error") {
    return asText(
      failureText(
        "load this message",
        body.message,
        "Press enter to try again.",
      ),
      "note",
    );
  }

  if (!showSummary) {
    const text = markdownOf(body.body);
    return text === ""
      ? asText(NO_CONTENT_MESSAGE, "note")
      : asText(text, "markdown");
  }

  if (summary === undefined) {
    return asText(SUMMARY_PENDING_MESSAGE, "note");
  }

  const raw = summary.text.trim();

  // Nothing to read yet: either the stream has not started, or it failed
  // before it produced anything.
  if (raw === "") {
    return summary.status === "error"
      ? asText(
          failureText(
            "summarize this message",
            summary.error ?? "Unknown error.",
            "Press s to try again.",
          ),
          "note",
        )
      : asText(SUMMARY_PENDING_MESSAGE, "note");
  }

  // The model answers in markdown, so what has arrived is drawn as it arrives.
  return asText(summary.text, "markdown");
}

/** One thing to draw in the body. */
/** How a piece of text is emphasised. */
export type TextStyle = "title" | "body" | "note";

export type BodySegmentSpec =
  /** The message itself: markdown, drawn by the markdown renderer. */
  | { kind: "markdown"; text: string }
  | { kind: "text"; text: string; style: TextStyle }
  | { kind: "image"; url: string };

/**
 * The body as a list of things to draw. A picture only stands on its own line
 * once its address is whole — half an address is not something to fetch.
 */
export function bodySegments(view: BodyView): BodySegmentSpec[] {
  if (view.format !== "markdown") {
    return [{ kind: "text", text: view.text, style: "note" }];
  }

  // The text is markdown, except for the pictures that stand on their own line:
  // those are drawn as pictures.
  return markdownSegments(view.text);
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

/** The caption under a picture: its address, so it can still be followed. */
export const imageCaption = (url: string, failed = false): string =>
  failed ? `image: ${url} (couldn't load)` : `image: ${url}`;
