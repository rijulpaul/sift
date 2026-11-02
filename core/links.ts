/**
 * Masked links, resolved back to real URLs for the reader.
 *
 * `processNewsletter` replaces every link and image URL with a `LINK_<n>`
 * placeholder and keeps the real URL in `MaskedContent.links`. That is
 * deliberate: the model never sees a URL, so it cannot cite or invent one.
 *
 * These helpers do the reverse, on the way out.
 *
 * The streaming side is deliberately narrow: it holds back **only** a partial
 * placeholder, at most a few characters at the very end of the buffer. Holding
 * anything more — bracketed text, for instance, hoping to render a markdown
 * link — means waiting for text that may never come, which stalls the stream.
 */
import type { MaskedUrls } from "./process";

/** Shown in place of an image when the model kept no alt text. */
const IMAGE = "image";

const imageLabel = (alt: string, url: string): string =>
  alt.trim() === ""
    ? `[${IMAGE}] (${url})`
    : `[${IMAGE}: ${alt.trim()}] (${url})`;

const linkLabel = (text: string, url: string): string =>
  text.trim() === "" ? url : `${text} (${url})`;

/** `![alt](LINK_0)` and `[text](LINK_0)`, most specific first. */
const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(LINK_(\d+)\)/gi;
const LINK_MARKDOWN = /\[([^\]]*)\]\(LINK_(\d+)\)/gi;
/** A bare `LINK_0`, as it appears in prose or in a JSON value. */
const BARE_TOKEN = /LINK_(\d+)/gi;

/**
 * Replace every placeholder in `text` with its real URL. The markdown shapes
 * become `label (url)` rather than `[label](url)`, since the result is read as
 * plain text. Unknown ids are left alone, so a bug stays visible.
 */
export function resolveLinks(text: string, links: MaskedUrls): string {
  return text
    .replace(IMAGE_MARKDOWN, (whole, alt: string, id: string) => {
      const url = links[Number(id)]?.url;
      return url === undefined ? whole : imageLabel(alt, url);
    })
    .replace(LINK_MARKDOWN, (whole, label: string, id: string) => {
      const url = links[Number(id)]?.url;
      return url === undefined ? whole : linkLabel(label, url);
    })
    .replace(
      BARE_TOKEN,
      (whole, id: string) => links[Number(id)]?.url ?? whole,
    );
}

/**
 * A placeholder sitting at the end of the buffer. It may still grow — more
 * digits can follow — so it is not resolved until something else arrives.
 */
const PENDING_TOKEN = /LINK_\d{0,9}$/i;
/** The head of a placeholder already streamed, e.g. `LIN`, with no `K_` yet. */
const PENDING_PREFIX = /(?:L|LI|LIN|LINK)$/i;

/**
 * The offset from which `buffer` may still become a placeholder, so everything
 * before it can be resolved and shown straight away. Returns the buffer length
 * when nothing is pending.
 */
export function pendingFrom(buffer: string): number {
  const token = PENDING_TOKEN.exec(buffer);
  if (token !== null) return token.index;

  const prefix = PENDING_PREFIX.exec(buffer);
  if (prefix !== null) {
    // Only a placeholder starts a word: "well" ends in an innocent "l".
    const before = buffer[prefix.index - 1];
    if (before === undefined || !/[A-Za-z0-9]/.test(before))
      return prefix.index;
  }

  return buffer.length;
}

export interface LinkResolver {
  /** Resolve what is settled; hold back at most a partial placeholder. */
  push(chunk: string): string;
  /** Resolve whatever is left when the stream ends. */
  flush(): string;
}

/** Resolve masked links across a stream of text chunks. */
export function createLinkResolver(links: MaskedUrls): LinkResolver {
  let pending = "";

  return {
    push(chunk: string): string {
      pending += chunk;
      const settled = pendingFrom(pending);
      const ready = pending.slice(0, settled);
      pending = pending.slice(settled);
      return resolveLinks(ready, links);
    },

    flush(): string {
      const rest = resolveLinks(pending, links);
      pending = "";
      return rest;
    },
  };
}
