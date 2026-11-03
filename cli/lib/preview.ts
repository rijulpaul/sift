/**
 * What the preview pane shows, as pure functions of the mail and its summary.
 * No renderer imports, so these are unit-tested without a terminal.
 */
import type { BodyState, SummaryState } from "../state";
import { plainTextOf } from "./mail";
import { isEmptySummary, parseSummary, type SummaryBlock } from "./summary";

export const PREVIEW_EMPTY_MESSAGE = "Select a message to read it.";
export const BODY_PENDING_MESSAGE = "Loading…";
export const SUMMARY_PENDING_MESSAGE = "Summarizing…";
export const NO_CONTENT_MESSAGE = "(no content)";

/** What the pane should draw: running text, or a summary with pictures in it. */
export type BodyView =
  | { kind: "text"; text: string; dim: boolean }
  | {
      kind: "blocks";
      title: string;
      blocks: SummaryBlock[];
      /** Appended after the blocks, dimmed: why a summary stopped. */
      note?: string;
    };

/** A failure the reader can act on: what failed, why, and how to retry. */
const failureText = (what: string, reason: string, retry: string): string =>
  `Couldn't ${what}.\n${reason}\n\n${retry}`;

/** True when the answer is the JSON document the prompt asks for. */
const looksLikeJson = (text: string): boolean =>
  /^\s*(?:```[a-zA-Z]*\s*)?\{/.test(text);

const asText = (text: string, dim: boolean): BodyView => ({
  kind: "text",
  text,
  dim,
});

/** `text`, with the interruption note under it when there is one. */
const withNote = (text: string, note: string | undefined): string =>
  note === undefined ? text : `${text}\n\n${note}`;

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
    return asText(BODY_PENDING_MESSAGE, true);
  }

  if (body.status === "error") {
    return asText(
      failureText(
        "load this message",
        body.message,
        "Press enter to try again.",
      ),
      true,
    );
  }

  if (!showSummary) {
    const text = plainTextOf(body.body);
    return text === "" ? asText(NO_CONTENT_MESSAGE, true) : asText(text, false);
  }

  if (
    summary === undefined ||
    (summary.status === "streaming" && summary.text === "")
  ) {
    return asText(SUMMARY_PENDING_MESSAGE, true);
  }

  const note =
    summary.status === "error"
      ? `— Summary interrupted: ${summary.error ?? "unknown error"}`
      : undefined;
  const view = parseSummary(summary.text);

  // The model answers with a JSON document; showing it raw would put braces and
  // keys in front of the reader, so only what can be read is drawn.
  if (isEmptySummary(view)) {
    const raw = summary.text.trim();

    if (raw === "") {
      return asText(
        failureText(
          "summarize this message",
          summary.error ?? "Unknown error.",
          "Press s to try again.",
        ),
        true,
      );
    }

    // A document that has only just started has nothing to show yet. An answer
    // that is not that document is shown as the text it is.
    if (looksLikeJson(summary.text) && summary.status === "streaming") {
      return asText(SUMMARY_PENDING_MESSAGE, true);
    }
    return asText(withNote(raw, note), false);
  }

  // A parsed summary is drawn as its parts, so the title can be emphasised and
  // each picture drawn where it belongs.
  return {
    kind: "blocks",
    title: view.title.trim(),
    blocks: view.blocks,
    note,
  };
}

/** One thing to draw in the body. */
/** How a piece of text is emphasised. */
export type TextStyle = "title" | "body" | "note";

export type BodySegmentSpec =
  | { kind: "text"; text: string; style: TextStyle }
  | { kind: "image"; url: string };

/**
 * The body as a list of things to draw. A picture is only drawn once its block
 * is whole, since half an address is not something to fetch; until then the
 * address itself is shown.
 */
export function bodySegments(view: BodyView): BodySegmentSpec[] {
  if (view.kind === "text") {
    return [
      { kind: "text", text: view.text, style: view.dim ? "note" : "body" },
    ];
  }

  const segments: BodySegmentSpec[] = [];
  if (view.title !== "") {
    segments.push({ kind: "text", text: view.title, style: "title" });
  }

  for (const block of view.blocks) {
    if (block.kind === "text") {
      const text = block.text.trim();
      if (text !== "") segments.push({ kind: "text", text, style: "body" });
      continue;
    }

    segments.push(
      block.complete
        ? { kind: "image", url: block.url }
        : { kind: "text", text: imageCaption(block.url), style: "note" },
    );
  }

  if (view.note !== undefined) {
    segments.push({ kind: "text", text: view.note, style: "note" });
  }

  return segments;
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
