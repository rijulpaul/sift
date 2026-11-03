/**
 * The summary the model returns, and a reader for it that works while it is
 * still arriving.
 *
 * The model streams a JSON document:
 *
 *   { "title": "...", "content": [ { "type": "text", "text": "" },
 *                                  { "type": "image", "url": "LINK_0" } ] }
 *
 * Rendering that text directly would put braces and keys in front of the
 * reader, so it is read into blocks as it streams: whatever has arrived is
 * shown, including a string that is still being written, and anything the
 * reader has not seen yet simply is not there yet.
 *
 * Deliberately tolerant: a truncated document, a missing field or a stray code
 * fence must not stop the pane from showing what did arrive.
 */

export type SummaryBlock =
  | { kind: "text"; text: string; complete: boolean }
  | { kind: "image"; url: string; complete: boolean };

export interface SummaryView {
  title: string;
  blocks: SummaryBlock[];
}

const EMPTY: SummaryView = { title: "", blocks: [] };

/** True when nothing usable was found, so the caller can fall back. */
export const isEmptySummary = (view: SummaryView): boolean =>
  view.title.trim() === "" && view.blocks.length === 0;

interface ReadString {
  value: string;
  /** Index just past the closing quote, or the end of the input. */
  end: number;
}

/**
 * Reads the JSON string starting at its opening quote. An unterminated string —
 * the usual case mid-stream — yields what has arrived so far.
 */
function readString(src: string, start: number): ReadString {
  let value = "";
  let i = start + 1;

  while (i < src.length) {
    const char = src[i]!;

    if (char === "\\") {
      const escape = src[i + 1];
      if (escape === undefined) break; // the escape is still arriving

      if (escape === "u") {
        const hex = src.slice(i + 2, i + 6);
        if (hex.length < 4) return { value, end: src.length };
        const code = Number.parseInt(hex, 16);
        if (!Number.isNaN(code)) value += String.fromCharCode(code);
        i += 6;
        continue;
      }

      const simple: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        b: "\b",
        f: "\f",
      };
      value += simple[escape] ?? escape;
      i += 2;
      continue;
    }

    if (char === '"') return { value, end: i + 1 };

    value += char;
    i++;
  }

  return { value, end: src.length };
}

/**
 * The string value of `"key"` inside `src`, if the key has arrived.
 *
 * The key must be followed by a colon, otherwise the name is a value: in
 * `{"type":"text",...}` the word `text` appears first as the type's value, and
 * reading it as the key would drop the paragraph.
 */
function readKeyString(src: string, key: string): ReadString | undefined {
  const needle = `"${key}"`;
  let from = 0;

  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return undefined;

    let i = at + needle.length;
    while (i < src.length && /\s/.test(src[i]!)) i++;

    if (src[i] === ":") {
      i++;
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src[i] !== '"') return undefined; // the key is here, its value is not
      return readString(src, i);
    }

    from = at + 1; // that was a value, not the key
  }
}

/** The index of the `[` opening the content array, or -1. */
function contentStart(src: string): number {
  const at = src.indexOf('"content"');
  if (at === -1) return -1;
  return src.indexOf("[", at);
}

/** The index just past the object starting at `start`, or the end of input. */
function objectEnd(src: string, start: number): number {
  let depth = 0;
  let i = start;

  while (i < src.length) {
    const char = src[i]!;

    if (char === '"') {
      i = readString(src, i).end; // never treat braces inside a string as structure
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }

  return src.length; // the object is still arriving
}

function parseBlocks(src: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = [];
  const open = contentStart(src);
  if (open === -1) return blocks;

  let i = open + 1;
  while (i < src.length) {
    const char = src[i]!;

    if (char === '"') {
      i = readString(src, i).end;
      continue;
    }
    if (char === "]") break;
    if (char !== "{") {
      i++;
      continue;
    }

    const end = objectEnd(src, i);
    const object = src.slice(i, end);
    // The closing brace means the block is whole: until it arrives, a value —
    // an image's address, say — may still be growing.
    const complete = end > i && src[end - 1] === "}";
    const kind = readKeyString(object, "type")?.value;

    if (kind === "text") {
      const text = readKeyString(object, "text")?.value ?? "";
      if (text !== "") blocks.push({ kind: "text", text, complete });
    } else if (kind === "image") {
      const url = readKeyString(object, "url")?.value ?? "";
      if (url !== "") blocks.push({ kind: "image", url, complete });
    }

    i = end;
  }

  return blocks;
}

/** Drop a ```json fence if the model wrapped its answer in one. */
function withoutFence(raw: string): string {
  let src = raw.trimStart();

  const open = /^```[a-zA-Z]*[ \t]*\r?\n?/.exec(src);
  if (open !== null) src = src.slice(open[0].length);

  const close = src.indexOf("```");
  if (close !== -1) src = src.slice(0, close);

  return src;
}

/** Read a streamed summary into the blocks the preview shows. */
export function parseSummary(raw: string): SummaryView {
  const src = withoutFence(raw);
  if (src.trim() === "") return EMPTY;

  return {
    title: readKeyString(src, "title")?.value ?? "",
    blocks: parseBlocks(src),
  };
}

/**
 * The summary as readable text: the title, then each paragraph, with images on
 * a line of their own showing the address they point at.
 */
export function summaryText(view: SummaryView): string {
  const parts: string[] = [];

  const title = view.title.trim();
  if (title !== "") parts.push(title);

  for (const block of view.blocks) {
    if (block.kind === "text") {
      const text = block.text.trim();
      if (text !== "") parts.push(text);
    } else {
      // The address stays whole and wraps; it is the point of the entry.
      parts.push(`image: ${block.url}`);
    }
  }

  return parts.join("\n\n");
}
