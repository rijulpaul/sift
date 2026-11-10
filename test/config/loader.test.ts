// Tests for config loading and validation.
//
// `node:fs` is mocked so these tests never touch the real
// config/defaults.json (CI would otherwise reformat and commit it).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  assertConfigFileComplete,
  readRawConfig,
  resolveConfig,
  validateConfig,
} from "../../config/loader";
import type { Config } from "../../config/config";

const fs = {
  existsSync: vi.mocked(existsSync),
  readFileSync: vi.mocked(readFileSync),
  writeFileSync: vi.mocked(writeFileSync),
};

/** A defaults.json containing every known setting. */
const completeRaw = {
  email: "news@example.com",
  mark_as_read: true,
  llm_provider: "openrouter",
  llm_name: "openai/gpt-oss-120b",
  llm_base_url: null,
  process_images: false,
  vlm_provider: null,
  vlm_name: null,
  vlm_base_url: null,
  user_prompt: null,
};

const givenFile = (raw: unknown) => {
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(raw));
};

const givenNoFile = () => {
  fs.existsSync.mockReturnValue(false);
};

const caught = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected the call to throw, but it returned");
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readRawConfig", () => {
  it("returns an empty object when the file does not exist", () => {
    // The launcher reads the raw config to bootstrap a fresh file, so this
    // must not throw.
    givenNoFile();

    expect(readRawConfig()).toEqual({});
  });

  it("parses the file when it exists", () => {
    givenFile(completeRaw);

    expect(readRawConfig()).toEqual(completeRaw);
  });

  it("throws a clear error when the file is not valid JSON", () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue("{ not json");

    const err = caught(readRawConfig);

    expect(err.message).toMatch(/config\/defaults\.json is not valid JSON/);
    expect(err.cause).toBeDefined();
  });
});

describe("assertConfigFileComplete", () => {
  it("reports a missing file as not configured", () => {
    givenNoFile();

    const err = caught(assertConfigFileComplete);

    expect(err.message).toMatch(/config\/defaults\.json was not found/);
    expect(err.message).toMatch(/not configured/);
    expect(err.message).toMatch(/--no-launcher/);
  });

  it("reports which settings an incomplete file is missing", () => {
    const { vlm_provider: _a, vlm_name: _b, ...partial } = completeRaw;
    givenFile(partial);

    const err = caught(assertConfigFileComplete);

    expect(err.message).toMatch(/config\/defaults\.json is incomplete/);
    expect(err.message).toMatch(/vlm_provider, vlm_name/);
    expect(err.message).toMatch(/not configured/);
  });

  it("names every missing setting when the file is empty", () => {
    givenFile({});

    const err = caught(assertConfigFileComplete);

    expect(err.message).toMatch(/is incomplete, missing: email/);
  });

  it("accepts a complete file, including keys whose value is null", () => {
    givenFile(completeRaw);

    expect(() => assertConfigFileComplete()).not.toThrow();
  });
});

describe("resolveConfig", () => {
  it("maps snake_case settings onto Config and treats blanks as unset", () => {
    givenFile({ ...completeRaw, email: "", vlm_name: "  " });

    const config = resolveConfig();

    expect(config.llmProvider).toBe("openrouter");
    expect(config.llmName).toBe("openai/gpt-oss-120b");
    expect(config.markAsRead).toBe(true);
    expect(config.email).toBeUndefined(); // "" counts as unset
    expect(config.vlmName).toBeUndefined(); // whitespace counts as unset
  });

  it("carries the reader's own instructions through, and drops blanks", () => {
    givenFile({ ...completeRaw, user_prompt: "Only the numbers, please." });

    expect(resolveConfig().userPrompt).toBe("Only the numbers, please.");

    givenFile({ ...completeRaw, user_prompt: "   " });

    expect(resolveConfig().userPrompt).toBeUndefined();
  });

  it("lets CLI overrides win, and ignores flags that were not passed", () => {
    givenFile(completeRaw);

    const config = resolveConfig({ llm_name: "override", email: undefined });

    expect(config.llmName).toBe("override");
    expect(config.email).toBe("news@example.com"); // undefined override keeps the file value
  });
});

describe("validateConfig — vision settings", () => {
  const configWith = (overrides: Partial<Config>): Config => ({
    ...resolveConfig(),
    ...overrides,
  });

  it("runs normally with image processing off and no vision settings", () => {
    givenFile(completeRaw);

    const config = configWith({
      processImages: false,
      vlmProvider: undefined,
      vlmName: undefined,
    });

    expect(() => validateConfig(config)).not.toThrow();
  });

  it("runs normally with image processing off and blank vision settings", () => {
    givenFile({ ...completeRaw, vlm_provider: "", vlm_name: "" });

    const config = configWith({
      processImages: false,
      vlmProvider: undefined,
      vlmName: undefined,
    });

    expect(() => validateConfig(config)).not.toThrow();
  });

  it("requires both vision settings when image processing is on", () => {
    givenFile(completeRaw);

    const config = configWith({
      processImages: true,
      vlmProvider: undefined,
      vlmName: undefined,
    });

    const err = caught(() => validateConfig(config));

    expect(err.message).toMatch(/Missing configuration for/);
    expect(err.message).toMatch(/vlm_provider/);
    expect(err.message).toMatch(/vlm_name/);
  });

  it("accepts image processing when both vision settings are set", () => {
    givenFile({
      ...completeRaw,
      vlm_provider: "openai",
      vlm_name: "gpt-4o-mini",
    });

    const config = configWith({
      processImages: true,
      vlmProvider: "openai",
      vlmName: "gpt-4o-mini",
    });

    expect(() => validateConfig(config)).not.toThrow();
  });

  it("reports an unconfigured file before reporting missing values", () => {
    givenNoFile();

    const err = caught(() => validateConfig(resolveConfig()));

    expect(err.message).toMatch(/was not found/);
    expect(err.message).not.toMatch(/Missing configuration for/);
  });
});

describe("validateConfig — model settings", () => {
  /** A file and a config in step: only the model settings differ per test. */
  const validateWith = (overrides: Partial<Config>) => {
    givenFile(completeRaw);
    return validateConfig({ ...resolveConfig(), ...overrides });
  };

  it("accepts a base URL instead of a model name", () => {
    // A self-hosted OpenAI endpoint is identified by its address, so the
    // launcher never asks for a model name.
    expect(() =>
      validateWith({
        llmProvider: "openai",
        llmName: undefined,
        llmBaseUrl: "http://localhost:11434/v1",
      }),
    ).not.toThrow();
  });

  it("asks for a name or a base URL, not both, when neither is set", () => {
    const err = caught(() =>
      validateWith({
        llmProvider: "openai",
        llmName: undefined,
        llmBaseUrl: undefined,
      }),
    );

    expect(err.message).toMatch(/llm_name/);
    expect(err.message).toMatch(/llm_base_url/);
  });

  it("accepts a vision base URL instead of a vision model name", () => {
    expect(() =>
      validateWith({
        processImages: true,
        vlmProvider: "openai",
        vlmName: undefined,
        vlmBaseUrl: "http://vision.local:8000/v1",
      }),
    ).not.toThrow();
  });

  it("names both vision settings when neither is set", () => {
    const err = caught(() =>
      validateWith({
        processImages: true,
        vlmProvider: "openai",
        vlmName: undefined,
        vlmBaseUrl: undefined,
      }),
    );

    expect(err.message).toMatch(/vlm_name/);
    expect(err.message).toMatch(/vlm_base_url/);
  });
});
