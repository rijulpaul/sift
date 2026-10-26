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
  persistEmail,
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

/** The raw config the loader last wrote to defaults.json. */
const written = () => {
  const contents = fs.writeFileSync.mock.calls.at(-1)?.[1] as
    string | undefined;
  return JSON.parse(contents ?? "{}") as Record<string, unknown>;
};

/** A defaults.json containing every known setting. */
const completeRaw = {
  tui: true,
  webui: false,
  email: "news@example.com",
  create_email: false,
  mark_as_read: true,
  summarize: true,
  llm_provider: "openrouter",
  llm_name: "openai/gpt-oss-120b",
  process_images: false,
  vlm_provider: null,
  vlm_name: null,
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

    expect(err.message).toMatch(/is incomplete, missing: tui, webui/);
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
    expect(config.createEmail).toBe(false);
    expect(config.markAsRead).toBe(true);
    expect(config.summarize).toBe(true);
    expect(config.email).toBeUndefined(); // "" counts as unset
    expect(config.vlmName).toBeUndefined(); // whitespace counts as unset
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

describe("persistEmail", () => {
  it("writes the created address without losing the other settings", () => {
    givenFile(completeRaw);

    persistEmail("fresh@agentmail.to");

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(written()).toEqual({ ...completeRaw, email: "fresh@agentmail.to" });
  });

  it("trims the address", () => {
    givenFile(completeRaw);

    persistEmail("  fresh@agentmail.to  ");

    expect(written().email).toBe("fresh@agentmail.to");
  });

  it("writes nothing when there is no address", () => {
    givenFile(completeRaw);

    persistEmail(undefined);
    persistEmail("   ");

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("leaves a complete file complete", () => {
    givenFile(completeRaw);
    persistEmail("fresh@agentmail.to");

    fs.readFileSync.mockReturnValue(
      fs.writeFileSync.mock.calls[0]?.[1] as string,
    );

    expect(() => assertConfigFileComplete()).not.toThrow();
  });
});
