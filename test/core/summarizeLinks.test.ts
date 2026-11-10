// The summary SiftCore hands out must carry real URLs, not `LINK_<n>`
// placeholders, and it must still arrive chunk by chunk.
//
// The agent module is mocked so the chunks are known exactly — including a
// placeholder split across two chunks, which a plain `replace` would miss.

import { beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({
  chunks: [] as string[],
  /** Arguments `create` was called with, in order. */
  created: [] as unknown[][],
}));

vi.mock("../../core/agent", () => ({
  NewsletterSummarizationAgent: {
    create: async (...args: unknown[]) => {
      agent.created.push(args);
      return {
        async *invoke() {
          for (const chunk of agent.chunks) yield chunk;
        },
      };
    },
  },
}));

import type { Config } from "../../config/config";
import { SiftCore } from "../../core/index";
import type { Inbox } from "../../core/mail";
import type { MaskedContent } from "../../core/process";

const config = {
  email: "news@example.com",
  displayName: undefined,
  markAsRead: false,
  llmProvider: "openrouter",
  llmName: "openai/gpt-oss-20b",
  llmBaseUrl: undefined,
  processImages: false,
  vlmProvider: undefined,
  vlmName: undefined,
  vlmBaseUrl: undefined,
  userPrompt: undefined,
} satisfies Config;

const newsletter: MaskedContent = {
  content: "body",
  links: {
    0: { id: 0, url: "https://cdn.example.com/chart.png", isImage: true },
    1: { id: 1, url: "https://example.com/post", isImage: false },
  },
};

const summarize = async (overrides: Partial<Config> = {}) => {
  const core = new SiftCore({
    config: { ...config, ...overrides },
    inbox: {} as Inbox,
  });

  const events: Array<{ done: boolean; chunk: string | undefined }> = [];
  for await (const event of core.summarize(newsletter)) events.push(event);

  return {
    /** Everything the reader is shown, in order. */
    parts: events.filter((event) => !event.done).map((event) => event.chunk),
    text: events
      .filter((event) => !event.done)
      .map((event) => event.chunk)
      .join(""),
    doneCount: events.filter((event) => event.done).length,
    last: events.at(-1),
  };
};

beforeEach(() => {
  agent.chunks = [];
  agent.created = [];
});

describe("SiftCore.summarize — links", () => {
  it("replaces a placeholder with the real url", async () => {
    agent.chunks = ['{"type":"image","url":"LINK_0"}'];

    const { text } = await summarize();

    expect(text).toBe(
      '{"type":"image","url":"https://cdn.example.com/chart.png"}',
    );
  });

  it("replaces a placeholder split across two chunks", async () => {
    agent.chunks = ["See LINK_", "1 for the post"];

    expect((await summarize()).text).toBe(
      "See https://example.com/post for the post",
    );
  });

  it("emits a placeholder that only completes at the end of the stream", async () => {
    agent.chunks = ["Read LINK_1"];

    expect((await summarize()).text).toBe("Read https://example.com/post");
  });

  it("keeps an id it cannot resolve, so the bug is visible", async () => {
    agent.chunks = ["See LINK_9"];

    expect((await summarize()).text).toBe("See LINK_9");
  });
});

describe("SiftCore.summarize — streaming", () => {
  it("hands over every chunk as it arrives", async () => {
    agent.chunks = ["The ", "quarterly ", "numbers."];

    const { parts } = await summarize();

    expect(parts).toEqual(["The ", "quarterly ", "numbers."]);
  });

  it("streams a markdown summary without pausing on its syntax", async () => {
    // A regression guard: markdown punctuation once looked like the start of a
    // link label, and the stream froze until it closed.
    agent.chunks = [
      "## Aggregators\n\n",
      "The piece argues that **aggregators** ",
      "capture demand.\n\n![Chart](LINK_0)",
    ];

    const { text } = await summarize();

    expect(text).toBe(
      "## Aggregators\n\nThe piece argues that **aggregators** capture demand.\n\n" +
        "![Chart](https://cdn.example.com/chart.png)",
    );
  });

  it("never shows a partial placeholder", async () => {
    agent.chunks = ["See LIN", "K_1", " and LINK_", "1"];

    const { text } = await summarize();

    expect(text).toBe(
      "See https://example.com/post and https://example.com/post",
    );
    expect(text).not.toContain("LINK_");
  });

  it("still ends with exactly one done event", async () => {
    agent.chunks = ["a", "b"];

    const { doneCount, last } = await summarize();

    expect(doneCount).toBe(1);
    expect(last).toEqual({ done: true, chunk: undefined });
  });
});

describe("SiftCore.summarize — the reader's own instructions", () => {
  it("hands them to the agent when they are configured", async () => {
    agent.chunks = ["ok"];

    await summarize({ userPrompt: "Only the numbers, please." });

    // create(modelInfo, toolConfig, userPrompt)
    expect(agent.created).toHaveLength(1);
    expect(agent.created[0]?.[2]).toBe("Only the numbers, please.");
  });

  it("sends an empty string when they are not configured", async () => {
    agent.chunks = ["ok"];

    await summarize({ userPrompt: undefined });

    expect(agent.created[0]?.[2]).toBe("");
  });
});
