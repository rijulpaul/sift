// core/process.test.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//   processNewsletter is a PURE function: same input → same output, no side
//   effects (no network, files, timers). Pure functions are the easiest code
//   to test, they are the backbone of the newsletter pipeline, and they are
//   good place to learn the fundamentals.
//
// TEST ANATOMY (every test follows it):
//   1. Arrange — set up the input
//   2. Act     — call the function
//   3. Assert  — check the result is what we expect
//
// KEY VITEST CONCEPTS USED:
//   describe("...")  → groups related tests into a suite (for reporting)
//   it("...does...") → one individual test case
//   expect(...)      → asserts a value; matchers do the comparing:
//     .toBe()                      strict equality (===)
//     .toEqual()                   deep equality (objects/maps compare by value)
//     .toContain(substring)        string contains
//     .toMatch(/regex/)            string matches a pattern
//     .not.toXxx()                 the negation of any matcher
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { processNewsletter } from "./process";

// ── cleanHtml: strips tracking pixels & hidden elements ─────────────────────
// Newsletters are full of 1x1 tracking pixels (width/height of 0 or 1, often
// via inline styles) used by senders to see if you opened the email. We
// remove those so the LLM and the user only see real content.
describe("cleanHtml", () => {
  it("removes tracking pixels declared with width/height attributes", () => {
    // Arrange
    const html = `
      <div>
        <img src="https://tracker.example/pixel.gif" width="1" height="1">
        <p>Real article content</p>
      </div>`;

    // Act
    const { content } = processNewsletter(html);

    // Assert
    expect(content).not.toContain("tracker.example"); // pixel is gone
    expect(content).toContain("Real article content"); // ...but the article survives
  });

  it("removes tracking pixels hidden via inline styles (1px / 0px / max-width)", () => {
    // Arrange: three different ways newsletters hide 1x1 images
    const html = `
      <img src="a.png" style="width: 1px; height: 1px">
      <img src="b.png" style="width: 0px">
      <img src="c.png" style="max-width: 1px; max-height: 1px">
      <p>Visible content</p>`;

    // Act
    const { content } = processNewsletter(html);

    // Assert: none of the hidden images should survive
    expect(content).not.toContain("a.png");
    expect(content).not.toContain("b.png");
    expect(content).not.toContain("c.png");
  });

  it("removes elements with display: none", () => {
    const html = `<div style="display: none">hidden promo box</div><p>All good here</p>`;

    const { content } = processNewsletter(html);

    expect(content).not.toContain("hidden promo box");
    expect(content).toContain("All good here");
  });

  it("removes script, svg and iframe elements", () => {
    const html = `
      <script>alert("tracking")</script>
      <svg><circle r="10"></circle></svg>
      <iframe src="https://ads.example"></iframe>
      <p>Real content</p>`;

    const { content } = processNewsletter(html);

    expect(content).not.toContain("alert");
    expect(content).not.toContain("circle");
    expect(content).not.toContain("ads.example");
    expect(content).toContain("Real content");
  });

  it("strips style and class attributes from everything that remains", () => {
    const html = `<p class="lead" style="color: red">Plain text now</p>`;

    const { content } = processNewsletter(html);

    expect(content).not.toContain("color: red");
    expect(content).not.toContain('class="lead"');
    expect(content).not.toContain("<p"); // no raw HTML tags left after markdown
    expect(content).toContain("Plain text now");
  });
});

// ── htmlToMarkdown: compact representation for the LLM ──────────────────────
describe("htmlToMarkdown", () => {
  it("uses # for headings (ATX style)", () => {
    const html = `<h1>Big title</h1><h2>Smaller subtitle</h2>`;

    const { content } = processNewsletter(html);

    // Turndown is configured with headingStyle: 'atx'
    expect(content).toContain("# Big title");
    expect(content).toContain("## Smaller subtitle");
  });

  it("renders code blocks as fenced (```) blocks", () => {
    const html = `<pre><code>const x = 1;</code></pre>`;

    const { content } = processNewsletter(html);

    // Turndown is configured with codeBlockStyle: 'fenced'
    expect(content).toContain("```");
    expect(content).toContain("const x = 1;");
  });
});

// ── maskLinks: URLs become placeholders the agent resolves via tool calls ──
// Links are replaced with LINK_<id> placeholders and the real URL is kept
// in a map. The LLM then references ids (never raw URLs) — this avoids the
// model hallucinating or mangling long tracking URLs.
describe("maskLinks", () => {
  it("masks hyperlink hrefs and records the real url", () => {
    const html = `<a href="https://example.com/article">Read more</a>`;

    const { content, links } = processNewsletter(html);

    // The markdown link now points at the placeholder id...
    expect(content).toContain("[Read more](LINK_0)");
    // ...and the real URL lives in the map, keyed by that same id
    expect(links.get(0)).toEqual({
      id: 0,
      url: "https://example.com/article",
      isImage: false,
    });
    // The raw URL never appears in the content sent to the LLM
    expect(content).not.toContain("https://example.com/article");
  });

  it("masks images, keeping alt/title metadata", () => {
    const html = `<img src="https://ex.com/chart.png" alt="Growth chart" title="Q3 chart">`;

    const { content, links } = processNewsletter(html);

    expect(content).toContain("LINK_0");
    expect(links.get(0)).toEqual({
      id: 0,
      url: "https://ex.com/chart.png",
      isImage: true,
      alt: "Growth chart",
      title: "Q3 chart",
    });
  });

  it("assigns sequential ids: images first, then links", () => {
    const html = `
      <a href="/first">one</a>
      <img src="pic.png" alt="pic">
      <a href="/second">two</a>`;

    const { content, links } = processNewsletter(html);

    // maskLinks processes $("img[src]") first (id 0 = the image),
    // then $("a[href]") (ids 1, 2 = the links)
    expect(links.get(0)?.isImage).toBe(true);                      // image got id 0
    expect(links.get(1)).toEqual({ id: 1, url: "/first", isImage: false });
    expect(links.get(2)).toEqual({ id: 2, url: "/second", isImage: false });
    expect(content).toContain("![pic](LINK_0)");
    expect(content).toContain("[one](LINK_1)");
    expect(content).toContain("[two](LINK_2)");
  });
});
