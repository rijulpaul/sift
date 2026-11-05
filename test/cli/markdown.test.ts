import { describe, expect, it } from "vitest";

import { markdownSegments } from "../../cli/lib/markdown";

const kinds = (text: string) => markdownSegments(text).map((b) => b.kind);

describe("markdownSegments", () => {
  it("hands plain prose to the markdown renderer whole", () => {
    const text = "# Title\n\nA paragraph with **bold** text.";

    expect(markdownSegments(text)).toEqual([{ kind: "markdown", text }]);
  });

  it("takes a picture on its own line out of the prose", () => {
    expect(
      markdownSegments("Before.\n\n![A chart](https://cdn.example.com/a.png)"),
    ).toEqual([
      { kind: "markdown", text: "Before." },
      { kind: "image", url: "https://cdn.example.com/a.png" },
    ]);
  });

  it("keeps the order of prose and pictures", () => {
    const blocks = markdownSegments(
      [
        "Intro line.",
        "![One](https://cdn.example.com/1.png)",
        "Middle line.",
        "![Two](https://cdn.example.com/2.png)",
        "Outro line.",
      ].join("\n\n"),
    );

    expect(blocks.map((b) => b.kind)).toEqual([
      "markdown",
      "image",
      "markdown",
      "image",
      "markdown",
    ]);
    expect(blocks[1]).toEqual({
      kind: "image",
      url: "https://cdn.example.com/1.png",
    });
  });

  it("takes the picture out of the link newsletters wrap it in", () => {
    // `<a href><img></a>` becomes `[![alt](image)](href)` in markdown.
    expect(
      markdownSegments(
        "[![Growth](https://cdn.example.com/pic.png)](https://example.com/post)",
      ),
    ).toEqual([{ kind: "image", url: "https://cdn.example.com/pic.png" }]);
  });

  it("ignores a title on the picture", () => {
    expect(
      markdownSegments('![Alt text](https://cdn.example.com/x.png "A title")'),
    ).toEqual([{ kind: "image", url: "https://cdn.example.com/x.png" }]);
  });

  it("leaves a picture inside a sentence in the prose", () => {
    // Cutting a paragraph in half to draw a picture would break the writing.
    const text = "Look ![inline](https://cdn.example.com/y.png) at this.";

    expect(markdownSegments(text)).toEqual([{ kind: "markdown", text }]);
  });

  it("trims the blank lines around each piece of prose", () => {
    const blocks = markdownSegments(
      "\n\nFirst.\n\n![Pic](https://cdn.example.com/a.png)\n\n\n\nSecond.\n\n",
    );

    expect(blocks).toEqual([
      { kind: "markdown", text: "First." },
      { kind: "image", url: "https://cdn.example.com/a.png" },
      { kind: "markdown", text: "Second." },
    ]);
  });

  it("draws nothing for an empty message", () => {
    expect(markdownSegments("")).toEqual([]);
    expect(markdownSegments("   \n\n  ")).toEqual([]);
  });

  it("treats a picture-only message as one picture", () => {
    expect(kinds("![Only](https://cdn.example.com/only.png)")).toEqual([
      "image",
    ]);
  });
});
