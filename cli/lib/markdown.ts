/**
 * Splitting a markdown message into the two things the preview draws
 * differently: prose, which the markdown renderer handles, and pictures, which
 * are drawn as pictures.
 *
 * No renderer imports, so this is unit-tested without a terminal.
 */

/** One piece of a message body, in the order it appears. */
export type MarkdownBlock =
  { kind: "markdown"; text: string } | { kind: "image"; url: string };

/** `![alt](url)` — a picture on a line of its own. */
const IMAGE_LINE = /^!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)$/;

/**
 * `[![alt](image)](href)` — the same picture wrapped in a link. Newsletters
 * almost always ship pictures this way, so the picture is what matters and the
 * link around it is dropped.
 */
const LINKED_IMAGE_LINE =
  /^\[!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)\]\([^)]*\)$/;

/** The address of a picture that stands alone on `line`, if it is one. */
function standaloneImage(line: string): string | undefined {
  const trimmed = line.trim();
  return IMAGE_LINE.exec(trimmed)?.[1] ?? LINKED_IMAGE_LINE.exec(trimmed)?.[1];
}

/**
 * The message as blocks: runs of markdown for the renderer, and one block per
 * picture that sits on its own line, which the preview draws. Pictures inside a
 * paragraph stay in the prose — markdown's own text rendering is all that can
 * be done for them without cutting a sentence in half.
 */
export function markdownSegments(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let prose: string[] = [];

  const flush = (): void => {
    const chunk = prose
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (chunk !== "") blocks.push({ kind: "markdown", text: chunk });
    prose = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const url = standaloneImage(line);
    if (url !== undefined) {
      flush();
      blocks.push({ kind: "image", url });
      continue;
    }
    prose.push(line);
  }

  flush();
  return blocks;
}
