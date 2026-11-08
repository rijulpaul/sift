// Tests for the interactive launcher.
//
// Both `node:fs` and `@clack/prompts` are mocked: the prompts are answered from
// a queue and the "file" that gets written is read back out of the mock, so
// nothing touches config/defaults.json and no terminal is needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  isCancel: (value: unknown) => value === "cancelled",
  cancel: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  log: { step: vi.fn(), message: vi.fn(), success: vi.fn() },
  select: vi.fn(),
  text: vi.fn(),
  confirm: vi.fn(),
}));

import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { createConfig } from "../launcher";

const fs = {
  existsSync: vi.mocked(existsSync),
  readFileSync: vi.mocked(readFileSync),
  writeFileSync: vi.mocked(writeFileSync),
};

const select = vi.mocked(p.select);
const text = vi.mocked(p.text);
const confirm = vi.mocked(p.confirm);

/** A defaults.json with nothing set, so every prompt asks its question. */
const emptyRaw = {
  email: null,
  create_email: false,
  mark_as_read: false,
  summarize: false,
  llm_provider: null,
  llm_name: null,
  llm_base_url: null,
  process_images: false,
  vlm_provider: null,
  vlm_name: null,
  vlm_base_url: null,
};

/** The raw config the launcher last wrote to defaults.json. */
const written = () => {
  const contents = fs.writeFileSync.mock.calls.at(-1)?.[1] as
    string | undefined;
  return JSON.parse(contents ?? "{}") as Record<string, unknown>;
};

/** The messages of the prompts of one kind, in the order they were asked. */
const asked = (prompt: typeof text | typeof select | typeof confirm) =>
  (
    prompt as unknown as { mock: { calls: Array<[{ message: string }]> } }
  ).mock.calls.map((call) => call[0].message);

/** Answer every prompt from a queue, in order. */
const givenAnswers = (answers: {
  select?: string[];
  text?: string[];
  confirm?: boolean[];
}) => {
  const queue = {
    select: [...(answers.select ?? [])],
    text: [...(answers.text ?? [])],
    confirm: [...(answers.confirm ?? [])],
  };

  const next = <T>(values: T[], kind: string): T => {
    const value = values.shift();
    if (value === undefined) throw new Error(`no ${kind} answer left`);
    return value;
  };

  select.mockImplementation(async () => next(queue.select, "select") as never);
  text.mockImplementation(async () => next(queue.text, "text") as never);
  confirm.mockImplementation(
    async () => next(queue.confirm, "confirm") as never,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(emptyRaw));
});

/** The answers every run needs, whatever it is testing. */
const baseAnswers = {
  text: ["news@example.com"],
  confirm: [false, false, false, false], // create_email, mark_as_read, summarize, process_images
};

describe("launcher — custom OpenAI endpoints", () => {
  it("asks for a base URL instead of a model name", async () => {
    givenAnswers({
      ...baseAnswers,
      select: ["custom endpoint (OpenAI compatible)"],
      text: [...baseAnswers.text, "http://localhost:11434/v1"],
    });

    await createConfig();

    // The question that appears where the model name would have been asked.
    expect(asked(text)).toEqual([
      "Email address to use (leave empty to auto-create an inbox)",
      "LLM Custom Endpoint URL (OpenAI compatible)",
    ]);
    expect(asked(text)).not.toContain("LLM model name");
    expect(written()).toMatchObject({
      llm_provider: "openai",
      llm_base_url: "http://localhost:11434/v1",
      llm_name: null,
    });
  });

  it("asks for a model name when a built-in provider is chosen", async () => {
    givenAnswers({
      ...baseAnswers,
      select: ["openrouter"],
      text: [...baseAnswers.text, "openai/gpt-oss-20b"],
    });

    await createConfig();

    expect(asked(text)).toContain("LLM model name");
    expect(asked(text)).not.toContain(
      "LLM Custom Endpoint URL (OpenAI compatible)",
    );
    expect(written()).toMatchObject({
      llm_provider: "openrouter",
      llm_name: "openai/gpt-oss-20b",
      llm_base_url: null,
    });
  });

  it("asks for the vision base URL when the vision endpoint is custom", async () => {
    givenAnswers({
      text: [
        ...baseAnswers.text,
        "openai/gpt-oss-20b",
        "http://vision.local:8000/v1",
      ],
      // create_email, mark_as_read, summarize, process_images = true
      confirm: [false, false, false, true],
      select: ["openrouter", "custom endpoint (OpenAI compatible)"],
    });

    await createConfig();

    expect(asked(text)).toContain(
      "Vision-language model Custom Endpoint URL (OpenAI compatible)",
    );
    expect(written()).toMatchObject({
      vlm_provider: "openai",
      vlm_base_url: "http://vision.local:8000/v1",
      vlm_name: null,
      llm_base_url: null,
    });
  });

  it("rejects a base URL that is not a URL", async () => {
    givenAnswers({
      ...baseAnswers,
      select: ["custom endpoint (OpenAI compatible)"],
      text: [...baseAnswers.text, "localhost:11434"],
    });

    // The validator is handed to the prompt; call it the way clack would.
    await createConfig();
    const baseUrlPrompt = text.mock.calls.at(-1)?.[0] as {
      validate?: (input: string) => string | undefined;
    };

    expect(baseUrlPrompt.validate?.("localhost:11434")).toMatch(/full URL/);
    expect(baseUrlPrompt.validate?.("")).toMatch(/required/);
    expect(
      baseUrlPrompt.validate?.("http://localhost:11434/v1"),
    ).toBeUndefined();
    expect(
      baseUrlPrompt.validate?.("https://api.example.com/v1"),
    ).toBeUndefined();
  });
});
