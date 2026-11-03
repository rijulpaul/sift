// Tests for reading a streamed summary into blocks.
//
// The document arrives a token at a time, so the reader must cope with every
// prefix of it, never showing braces or keys, and never losing text that has
// already been written.

import { describe, expect, it } from "vitest";

import {
  isEmptySummary,
  parseSummary,
  summaryText,
} from "../../cli/lib/summary";

const document = (title: string, content: unknown[]) =>
  JSON.stringify({ title, content });

describe("parseSummary — a complete summary", () => {
  it("reads the title, the paragraphs and the images", () => {
    const raw = document("Aggregators", [
      {
        type: "text",
        text: "The piece argues that aggregators capture demand.",
      },
      { type: "image", url: "https://cdn.example.com/chart.png" },
      { type: "text", text: "It ends with a caveat." },
    ]);

    expect(parseSummary(raw)).toEqual({
      title: "Aggregators",
      blocks: [
        {
          kind: "text",
          text: "The piece argues that aggregators capture demand.",
          complete: true,
        },
        {
          kind: "image",
          url: "https://cdn.example.com/chart.png",
          complete: true,
        },
        { kind: "text", text: "It ends with a caveat.", complete: true },
      ],
    });
  });

  it("keeps the order of blocks", () => {
    const raw = document("T", [
      { type: "image", url: "https://a/1.png" },
      { type: "text", text: "middle" },
      { type: "image", url: "https://a/2.png" },
    ]);

    expect(parseSummary(raw).blocks.map((block) => block.kind)).toEqual([
      "image",
      "text",
      "image",
    ]);
  });

  it("reads a pretty-printed document", () => {
    const raw = `{
      "title": "Spaced out",
      "content": [
        { "type": "text", "text": "Wrapped over lines." }
      ]
    }`;

    expect(parseSummary(raw)).toEqual({
      title: "Spaced out",
      blocks: [{ kind: "text", text: "Wrapped over lines.", complete: true }],
    });
  });

  it("unescapes the characters the model writes", () => {
    const raw = document('A "quoted" title', [
      { type: "text", text: "first\nsecond\ttabbed — dash \\ slash" },
    ]);

    const view = parseSummary(raw);

    expect(view.title).toBe('A "quoted" title');
    expect(view.blocks[0]).toEqual({
      kind: "text",
      text: "first\nsecond\ttabbed — dash \\ slash",
      complete: true,
    });
  });

  it("reads a unicode escape", () => {
    const raw = '{"title":"caf\\u00e9","content":[]}';

    expect(parseSummary(raw).title).toBe("café");
  });

  it("ignores a code fence around the document", () => {
    const raw = `\`\`\`json
${document("Fenced", [{ type: "text", text: "inside" }])}
\`\`\``;

    expect(parseSummary(raw)).toEqual({
      title: "Fenced",
      blocks: [{ kind: "text", text: "inside", complete: true }],
    });
  });
});

describe("parseSummary — while it streams", () => {
  const raw = document("Aggregators", [
    { type: "text", text: "The piece argues that aggregators capture demand." },
    { type: "image", url: "https://cdn.example.com/chart.png" },
  ]);

  /** Every prefix of the document, as a provider would deliver it. */
  const prefixes = Array.from({ length: raw.length + 1 }, (_, i) =>
    raw.slice(0, i),
  );

  it("never shows JSON punctuation, at any point in the stream", () => {
    for (const prefix of prefixes) {
      const text = summaryText(parseSummary(prefix));

      expect(text).not.toContain("{");
      expect(text).not.toContain("}");
      expect(text).not.toContain('"type"');
      expect(text).not.toContain('"text"');
      expect(text).not.toContain('"url"');
    }
  });

  it("never loses text it has already shown", () => {
    // Each prefix must extend the previous one, so the pane only ever grows.
    let previous = "";
    for (const prefix of prefixes) {
      const text = summaryText(parseSummary(prefix));

      expect(text.startsWith(previous) || text === "").toBe(true);
      if (previous !== "")
        expect(text.length).toBeGreaterThanOrEqual(previous.length);
      previous = text === "" ? previous : text;
    }
  });

  it("shows the title as soon as its string arrives", () => {
    expect(parseSummary('{"title":"Agg').title).toBe("Agg");
    expect(parseSummary('{"title":"Aggregators"').title).toBe("Aggregators");
  });

  it("shows a paragraph as it is written", () => {
    const partial = '{"title":"T","content":[{"type":"text","text":"The piece';

    expect(parseSummary(partial).blocks).toEqual([
      { kind: "text", text: "The piece", complete: false },
    ]);
  });

  it("shows an image only once its address has started", () => {
    const before = '{"title":"T","content":[{"type":"image","url":"';
    const after =
      '{"title":"T","content":[{"type":"image","url":"https://cdn.example.com/c';

    expect(parseSummary(before).blocks).toEqual([]);
    expect(parseSummary(after).blocks).toEqual([
      { kind: "image", url: "https://cdn.example.com/c", complete: false },
    ]);
  });

  it("reads a string whose escape is still arriving", () => {
    // The backslash has landed but what it escapes has not.
    expect(parseSummary('{"title":"a\\').title).toBe("a");
    expect(parseSummary('{"title":"a\\u00').title).toBe("a");
  });

  it("reads nothing from a document that has only just started", () => {
    expect(isEmptySummary(parseSummary("{"))).toBe(true);
    expect(isEmptySummary(parseSummary(""))).toBe(true);
  });

  it("is empty for an answer that ignored the shape", () => {
    expect(isEmptySummary(parseSummary("Just some prose."))).toBe(true);
  });

  it("reads the whole document at every point, once complete", () => {
    const view = parseSummary(raw);

    expect(view.title).toBe("Aggregators");
    expect(view.blocks).toHaveLength(2);
  });
});

describe("summaryText", () => {
  it("puts the title first, paragraphs after, images on their own line", () => {
    const raw = document("Aggregators", [
      { type: "text", text: "Paragraph one." },
      { type: "image", url: "https://cdn.example.com/chart.png" },
      { type: "text", text: "Paragraph two." },
    ]);

    expect(summaryText(parseSummary(raw))).toBe(
      [
        "Aggregators",
        "Paragraph one.",
        "image: https://cdn.example.com/chart.png",
        "Paragraph two.",
      ].join("\n\n"),
    );
  });

  it("leaves out an empty title and empty paragraphs", () => {
    const raw = document("", [
      { type: "text", text: "" },
      { type: "text", text: "Only this." },
    ]);

    expect(summaryText(parseSummary(raw))).toBe("Only this.");
  });

  it("keeps an address whole, so it can be followed in full", () => {
    const url = "https://example.com/a/very/long/path?with=query&and=more";
    const raw = document("T", [{ type: "image", url }]);

    expect(summaryText(parseSummary(raw))).toContain(url);
  });
});
