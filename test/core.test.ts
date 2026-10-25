// Tests for the SiftCore agent lifecycle.
//
// The agent stack (langchain + the provider SDK) is ~570ms of module loading,
// so it must NOT be built during startup: `new SiftCore()` defers it to the
// first summarize()/warmup() and memoizes it. These tests pin that contract.
//
// The agent module is mocked, so no LLM or network is involved.

import { beforeEach, describe, expect, it, vi } from "vitest";

const agent = vi.hoisted(() => ({
  create: vi.fn(),
  invoked: [] as unknown[],
}));

vi.mock("../core/agent", () => ({
  NewsletterSummarizationAgent: { create: agent.create },
}));

import { SiftCore } from "../core/index";
import type { Config } from "../config/config";
import type { Inbox } from "../core/mail";

const config: Config = {
  tui: true,
  webui: false,
  email: "news@example.com",
  displayName: undefined,
  createEmail: false,
  markAsRead: true,
  summarize: true,
  llmProvider: "openrouter",
  llmName: "openai/gpt-oss-120b",
  processImages: false,
  vlmProvider: undefined,
  vlmName: undefined,
};

const inbox = {
  get: async () => [],
  updateLabels: async () => {},
  delete: async () => {},
} as unknown as Inbox;

const newCore = () => new SiftCore({ config, inbox });

/** A fake agent that yields the given chunks from invoke(). */
function fakeAgent(chunks: string[] = ["chunk"]) {
  return {
    async *invoke(input: unknown) {
      agent.invoked.push(input);
      for (const chunk of chunks) yield chunk;
    },
  };
}

const collect = async (stream: AsyncIterable<unknown>) => {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const message = { content: "hello", links: {} };

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks only clears vi.fn() mocks, not this plain array.
  agent.invoked.length = 0;
  agent.create.mockImplementation(async () => fakeAgent());
});

describe("SiftCore agent lifecycle", () => {
  it("does not build the agent during construction", () => {
    newCore();

    expect(agent.create).not.toHaveBeenCalled();
  });

  it("builds the agent on the first summarize, not before", async () => {
    const core = newCore();
    expect(agent.create).not.toHaveBeenCalled();

    await collect(core.summarize(message));

    expect(agent.create).toHaveBeenCalledTimes(1);
  });

  it("passes the configured model and vision settings to the agent factory", async () => {
    await collect(newCore().summarize(message));

    expect(agent.create).toHaveBeenCalledWith(
      { model: "openai/gpt-oss-120b", modelProvider: "openrouter" },
      { vlmProvider: undefined, vlmName: undefined, processImages: false },
    );
  });

  it("shares one agent across calls", async () => {
    const core = newCore();

    await collect(core.summarize(message));
    await collect(core.summarize(message));
    await core.warmup();

    expect(agent.create).toHaveBeenCalledTimes(1);
  });

  it("warmup builds the agent ahead of the first summary", async () => {
    const core = newCore();

    await core.warmup();

    expect(agent.create).toHaveBeenCalledTimes(1);
  });

  it("runs concurrent callers through a single agent build", async () => {
    const core = newCore();

    await Promise.all([core.warmup(), core.warmup(), core.warmup()]);

    expect(agent.create).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed build, so a later call can retry", async () => {
    const core = newCore();
    agent.create.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(collect(core.summarize(message))).rejects.toThrow(
      "provider unavailable",
    );

    // The retry succeeds instead of replaying the cached rejection.
    await expect(collect(core.summarize(message))).resolves.toBeDefined();
    expect(agent.create).toHaveBeenCalledTimes(2);
  });

  it("treats warmup as advisory: it never throws", async () => {
    const core = newCore();
    agent.create.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(core.warmup()).resolves.toBeUndefined();
  });
});

describe("SiftCore.summarize protocol", () => {
  it("yields one event per chunk in order, then a single done event", async () => {
    agent.create.mockResolvedValueOnce(fakeAgent(["a", "b", "c"]));

    const events = await collect(newCore().summarize(message));

    expect(events).toEqual([
      { done: false, chunk: "a" },
      { done: false, chunk: "b" },
      { done: false, chunk: "c" },
      { done: true, chunk: undefined },
    ]);
  });

  it("still terminates when the agent yields nothing", async () => {
    agent.create.mockResolvedValueOnce(fakeAgent([]));

    expect(await collect(newCore().summarize(message))).toEqual([
      { done: true, chunk: undefined },
    ]);
  });

  it("forwards the message to the agent untouched", async () => {
    const enriched = {
      content: "body",
      links: { 0: { id: 0, url: "u", isImage: false } },
    };

    await collect(newCore().summarize(enriched));

    expect(agent.invoked).toEqual([enriched]);
  });

  it("propagates an agent failure instead of emitting done", async () => {
    const failing = {
      async *invoke() {
        yield "partial";
        throw new Error("stream broke");
      },
    };
    agent.create.mockResolvedValueOnce(failing);

    const core = newCore();
    const events: unknown[] = [];
    await expect(
      (async () => {
        for await (const event of core.summarize(message)) events.push(event);
      })(),
    ).rejects.toThrow("stream broke");

    expect(events).toEqual([{ done: false, chunk: "partial" }]);
  });
});
