// The summary SiftCore hands out must carry real URLs, not `LINK_<n>`
// placeholders, and it must still arrive chunk by chunk.
//
// The agent module is mocked so the chunks are known exactly — including a
// placeholder split across two chunks, which a plain `replace` would miss.

import { beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({ chunks: [] as string[] }));

vi.mock("../../core/agent", () => ({
  NewsletterSummarizationAgent: {
    create: async () => ({
      async *invoke() {
        for (const chunk of agent.chunks) yield chunk;
      },
    }),
  },
}));

import type { Config } from "../../config/config";
import { SiftCore } from "../../core/index";
import type { Inbox } from "../../core/mail";
import type { MaskedContent } from "../../core/process";

const config = {
  tui: true,
  webui: false,
  email: "news@example.com",
  displayName: undefined,
  createEmail: false,
  markAsRead: false,
  summarize: true,
  llmProvider: "openrouter",
  llmName: "openai/gpt-oss-20b",
  processImages: false,
  vlmProvider: undefined,
  vlmName: undefined,
} satisfies Config;

const newsletter: MaskedContent = {
  content: "body",
  links: {
    0: { id: 0, url: "https://cdn.example.com/chart.png", isImage: true },
    1: { id: 1, url: "https://example.com/post", isImage: false },
  },
};

const summarize = async () => {
  const core = new SiftCore({ config, inbox: {} as Inbox });

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

  it("streams a JSON summary without pausing on its brackets", async () => {
    // A regression guard: a JSON array bracket once looked like the start of a
    // markdown label, and the stream froze until the array closed.
    agent.chunks = [
      '{"title":"Aggregators","content":[',
      '{"type":"text","text":"The piece argues ',
      'that aggregators capture demand."},',
      '{"type":"image","url":"LINK_0"}]}',
    ];

    const { text } = await summarize();

    expect(text).toBe(
      '{"title":"Aggregators","content":[{"type":"text","text":"The piece argues ' +
        'that aggregators capture demand."},{"type":"image","url":"https://cdn.example.com/chart.png"}]}',
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
