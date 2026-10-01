import * as cheerio from "cheerio";
import TurndownService from "turndown";

// Determine what elements to remove while processing html in cleanHtml()
function shouldRemoveElement(
  $: cheerio.CheerioAPI,
  element: any,
): boolean {
  const width = $(element).attr("width");
  const height = $(element).attr("height");

  function isZeroOrOne(value?: string): boolean {
    if (!value) return false;

    return /^(0|1)(px)?$/i.test(
      value.trim().replace(/\s+/g, ""),
    );
  }

  if (isZeroOrOne(width) || isZeroOrOne(height)) {
    return true;
  }

  const style = $(element).attr("style");

  if (!style) return false;

  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");

    if (separator === -1) continue;

    const property = declaration
      .slice(0, separator)
      .trim()
      .toLowerCase();

    const value = declaration
      .slice(separator + 1)
      .trim()
      .toLowerCase();

    if (property === "display" && value === "none") {
      return true;
    }

    if (
      ["width", "height", "max-width", "max-height"].includes(property) &&
      isZeroOrOne(value)
    ) {
      return true;
    }
  }

  return false;
}

// Remove scripts, styles, class etc preserving the main newsletter content only
function cleanHtml(html: string): string {
  const $ = cheerio.load(html);

  // Only DIV and IMG are checked for tiny/hidden dimensions.
  // Remove tracking pixels
  $("div, img").each((_, element) => {
    if (shouldRemoveElement($, element)) {
      $(element).remove();
    }
  });

  // Remove unwanted HTML elements.
  $("script, svg, iframe").remove();

  // Remove styling metadata from everything remaining.
  $("*").each((_, element) => {
    $(element).removeAttr("style");
    $(element).removeAttr("class");
  });

  return $("body").html() ?? "";
}

function htmlToMarkdown(html: string): string {
  /*
    Conver html to markdown, mainly to reduce all
    the lines taken up by html tags and attributes
  */

  const turndownService = new TurndownService({
    headingStyle: 'atx', // Use # instead of underlining for headers
    codeBlockStyle: 'fenced' // Use ``` for code blocks
  });

  const markdown: string = turndownService.turndown(html);

  return markdown
}

/*
replace urls with incremental ids, fetch required data by id via llm tool call
for unifed url storage and to prevent llm from hallucinating on urls
*/

interface MaskedUrl{
  id: number;
  url: string;
  isImage: boolean;
  alt?: string;
  title?: string
}

interface MaskedContent {
  content: string;
  links: Map<number, MaskedUrl>;
}

function maskLinks(html: string): MaskedContent {
  const $ = cheerio.load(html);
  const links = new Map<number, MaskedUrl>();

  let nextId = 0;

  // Images
  $("img[src]").each((_, element) => {
    const $img = $(element);
    const url = $img.attr("src");

    if (!url) return;

    const id = nextId++;

    links.set(id, {
      id,
      url,
      isImage: true,
      alt: $img.attr("alt"),
      title: $img.attr("title"),
    });

    $img.attr("src", `LINK_${id}`);
  });

  // Normal hyperlinks
  $("a[href]").each((_, element) => {
    const $a = $(element);
    const url = $a.attr("href");

    if (!url) return;

    const id = nextId++;

    links.set(id, {
      id,
      url,
      isImage: false,
    });

    $a.attr("href", `LINK_${id}`);
  });

  return {
    content: $.html(),
    links,
  };
}

export function processNewsletter(newsletter_html: string) {
  newsletter_html = cleanHtml(newsletter_html)
  const masked_newsletter = maskLinks(newsletter_html)
  masked_newsletter.content = htmlToMarkdown(masked_newsletter.content)
  return masked_newsletter
}
