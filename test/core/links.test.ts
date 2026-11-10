// Tests for resolving masked links back to real URLs.
//
// The masked form keeps the model away from real URLs; these helpers put them
// back for the reader. The streaming tests here are the important ones: every
// push must produce output, so a summary is watched as it arrives.

import { describe, expect, it } from "vitest";

import {
  createLinkResolver,
  pendingFrom,
  resolveLinks,
} from "../../core/links";
import type { MaskedUrls } from "../../core/process";

const links: MaskedUrls = {
  0: {
    id: 0,
    url: "https://cdn.example.com/chart.png",
    isImage: true,
    alt: "Chart",
  },
  1: { id: 1, url: "https://example.com/post", isImage: false },
  2: { id: 2, url: "https://example.com/plain", isImage: false },
};

describe("resolveLinks", () => {
  it("replaces a bare placeholder", () => {
    expect(resolveLinks("See LINK_1 for details.", links)).toBe(
      "See https://example.com/post for details.",
    );
  });

  it("keeps a markdown link a link, with the real url", () => {
    // The summary is drawn as markdown, so the shape has to survive.
    expect(resolveLinks("[our post](LINK_1)", links)).toBe(
      "[our post](https://example.com/post)",
    );
  });

  it("keeps a markdown image an image, with the real url", () => {
    expect(resolveLinks("![Chart of revenue](LINK_0)", links)).toBe(
      "![Chart of revenue](https://cdn.example.com/chart.png)",
    );
  });

  it("handles several placeholders in one string", () => {
    expect(resolveLinks("LINK_1 and [two](LINK_2)", links)).toBe(
      "https://example.com/post and [two](https://example.com/plain)",
    );
  });

  it("leaves an unknown id alone, so the bug stays visible", () => {
    expect(resolveLinks("See LINK_9.", links)).toBe("See LINK_9.");
    expect(resolveLinks("[x](LINK_9)", links)).toBe("[x](LINK_9)");
  });

  it("leaves text without placeholders untouched", () => {
    expect(resolveLinks("Nothing to resolve.", links)).toBe(
      "Nothing to resolve.",
    );
  });

  it("collapses a label-less markdown link to the url", () => {
    expect(resolveLinks("[](LINK_1)", links)).toBe("https://example.com/post");
  });
});

describe("pendingFrom", () => {
  it("is the end of the buffer when nothing is pending", () => {
    expect(pendingFrom("plain text")).toBe("plain text".length);
    expect(pendingFrom("See LINK_1 and more")).toBe(
      "See LINK_1 and more".length,
    );
  });

  it("points at a partially streamed placeholder", () => {
    expect(pendingFrom("See L")).toBe(4);
    expect(pendingFrom("See LIN")).toBe(4);
    expect(pendingFrom("See LINK")).toBe(4);
    expect(pendingFrom("See LINK_")).toBe(4);
  });

  it("holds a complete placeholder at the end, since more digits may follow", () => {
    expect(pendingFrom("See LINK_1")).toBe(4);
    expect(pendingFrom("See LINK_12")).toBe(4);
  });

  it("does not hold a letter that merely ends a word", () => {
    expect(pendingFrom("well")).toBe(4);
    expect(pendingFrom("The trail")).toBe("The trail".length);
  });

  it("never holds JSON, so a summary always streams", () => {
    const open = '{"title":"X","content":[';
    expect(pendingFrom(open)).toBe(open.length);
    expect(pendingFrom('{"content":[{"type":"text","text":"Hi')).toBe(
      '{"content":[{"type":"text","text":"Hi'.length,
    );
  });

  it("does not hold an ordinary bracketed number", () => {
    expect(pendingFrom("see [1] and")).toBe("see [1] and".length);
  });
});

describe("createLinkResolver", () => {
  /** Feed the chunks, then flush, and return everything that came out. */
  const run = (chunks: string[]) => {
    const resolver = createLinkResolver(links);
    const out = chunks.map((chunk) => resolver.push(chunk));
    return { emitted: out, text: out.join("") + resolver.flush() };
  };

  it("resolves a placeholder delivered in one chunk", () => {
    expect(run(["See LINK_1 now"]).text).toBe(
      "See https://example.com/post now",
    );
  });

  it.each([
    ["LIN", "K_1"],
    ["LINK", "_1"],
    ["LINK_", "1"],
    ["LI", "NK_1"],
  ])("resolves a placeholder split as %s + %s", (first, second) => {
    expect(run([`See ${first}`, `${second} now`]).text).toBe(
      "See https://example.com/post now",
    );
  });

  it("resolves a placeholder that only completes at the end of the stream", () => {
    expect(run(["Read LINK_1"]).text).toBe("Read https://example.com/post");
  });

  it("resolves a streamed JSON image block", () => {
    expect(run(['{"url":"', "LINK_0", '"}']).text).toBe(
      '{"url":"https://cdn.example.com/chart.png"}',
    );
  });

  it("streams a JSON summary without pausing", () => {
    // The regression this guards: a JSON array bracket once looked like the
    // start of a markdown label, so the stream froze until the array closed.
    const chunks = [
      '{"title":"Aggregators","content":[',
      '{"type":"text","text":"The piece argues ',
      'that aggregators capture demand."},',
      '{"type":"image","url":"LINK_0"}]}',
    ];

    const { emitted, text } = run(chunks);

    expect(emitted.every((part) => part !== "")).toBe(true);
    expect(text).toBe(
      '{"title":"Aggregators","content":[{"type":"text","text":"The piece argues ' +
        'that aggregators capture demand."},{"type":"image","url":"https://cdn.example.com/chart.png"}]}',
    );
  });

  it("emits text without links straight through", () => {
    const resolver = createLinkResolver(links);
    expect(resolver.push("The quarterly ")).toBe("The quarterly ");
    expect(resolver.push("numbers are up. ")).toBe("numbers are up. ");
    expect(resolver.push("See [1] and [2]")).toBe("See [1] and [2]");
    expect(resolver.flush()).toBe("");
  });

  it("still yields the url when a markdown link is split", () => {
    // The brackets stay, because holding the label back would risk a stall.
    // The url is what matters; a complete string resolves the markdown form.
    expect(run(["[our post](LIN", "K_1) done"]).text).toBe(
      "[our post](https://example.com/post) done",
    );
  });

  it("keeps an id it cannot resolve, so the bug is visible", () => {
    expect(run(["See LINK_9"]).text).toBe("See LINK_9");
  });

  it("never leaks a partial placeholder to the reader", () => {
    const { text } = run(["See LIN", "K_1", " and LINK_", "2"]);

    expect(text).toBe(
      "See https://example.com/post and https://example.com/plain",
    );
    expect(text).not.toContain("LINK_");
  });
});
