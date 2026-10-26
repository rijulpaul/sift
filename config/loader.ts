import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ModelProvider } from "../core/agent/model";
import completions from "./completions.json" with { type: "json" };
import type { Config } from "./config";

/** A single config value as serialized in defaults.json. */
export type ConfigValue = boolean | string | null;

/** The raw (snake_case) shape of defaults.json. */
export type RawConfig = Record<string, ConfigValue>;

/** Per-run overrides, e.g. parsed CLI flags (`undefined` = flag not passed). */
export type ConfigOverrides = Record<string, ConfigValue | undefined>;

const defaultsPath = fileURLToPath(new URL("./defaults.json", import.meta.url));

/** Every setting sift knows about; a complete defaults.json defines all of them. */
const CONFIG_KEYS = Object.keys(completions);

/** Path as the user sees it, for error messages. */
const DEFAULTS_FILE = "config/defaults.json";

const CONFIGURE_HINT =
  "Run without --no-launcher to configure sift, or pass the values as CLI flags.";

/**
 * Read defaults.json as-is.
 *
 * A missing file is not fatal here: the launcher reads the raw config to
 * bootstrap a fresh one, so it gets `{}` back. Rejecting an absent file is
 * `assertConfigFileComplete`'s job.
 */
export const readRawConfig = (): RawConfig => {
  if (!existsSync(defaultsPath)) return {};

  try {
    return JSON.parse(readFileSync(defaultsPath, "utf8")) as RawConfig;
  } catch (error) {
    throw new Error(
      `${DEFAULTS_FILE} is not valid JSON. Fix or delete it, then configure sift again.`,
      { cause: error },
    );
  }
};

/**
 * Throw unless defaults.json exists and defines every known setting, so a
 * missing or half-written file reports itself as "not configured" instead of
 * failing later on some unrelated value.
 */
export const assertConfigFileComplete = (): void => {
  if (!existsSync(defaultsPath)) {
    throw new Error(
      `${DEFAULTS_FILE} was not found, so sift is not configured. ${CONFIGURE_HINT}`,
    );
  }

  const raw = readRawConfig();
  const missing = CONFIG_KEYS.filter((key) => !(key in raw));

  if (missing.length > 0) {
    throw new Error(
      `${DEFAULTS_FILE} is incomplete, missing: ${missing.join(", ")}. ` +
        `Sift is not configured. ${CONFIGURE_HINT}`,
    );
  }
};

export const writeRawConfig = (config: RawConfig): void => {
  writeFileSync(defaultsPath, `${JSON.stringify(config, null, 2)}\n`);
};

/**
 * Save the address the core ended up with. When no email is configured the
 * core creates an inbox, and without this the next run would create another
 * one and the first would be unreachable.
 */
export const persistEmail = (email: string | undefined): void => {
  const address = (email ?? "").trim();
  if (address === "") return;

  writeRawConfig({ ...readRawConfig(), email: address });
};

export const toSnakeCase = (key: string): string =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const asString = (value: ConfigValue | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/**
 * Merge defaults.json with per-run CLI overrides (`undefined` = not passed,
 * so the saved value is kept) and map the snake_case keys to `Config`.
 */
export const resolveConfig = (overrides: ConfigOverrides = {}): Config => {
  const raw: RawConfig = { ...readRawConfig() };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) raw[key] = value;
  }

  return {
    tui: Boolean(raw.tui),
    webui: Boolean(raw.webui),
    email: asString(raw.email),
    displayName: undefined,
    createEmail: Boolean(raw.create_email),
    markAsRead: Boolean(raw.mark_as_read),
    summarize: Boolean(raw.summarize),
    llmProvider: asString(raw.llm_provider) as ModelProvider | undefined,
    llmName: asString(raw.llm_name),
    processImages: Boolean(raw.process_images),
    vlmProvider: asString(raw.vlm_provider) as ModelProvider | undefined,
    vlmName: asString(raw.vlm_name),
  };
};

/**
 * Config values that are still unset and required to run sift.
 * `email` is optional when `create_email` is enabled (a random inbox is
 * created), and the vision settings are only needed for image processing.
 */
const checkMissingFields = (config: Config) => {
  const missing: (keyof Config)[] = [];

  if (!config.email && !config.createEmail) missing.push("email");
  if (!config.llmProvider) missing.push("llmProvider");
  if (!config.llmName) missing.push("llmName");
  if (config.processImages) {
    if (!config.vlmProvider) missing.push("vlmProvider");
    if (!config.vlmName) missing.push("vlmName");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing configuration for: ${missing.map(toSnakeCase).join(", ")}. ` +
        "Run without --no-launcher to configure sift, or pass the values as CLI flags.",
    );
  }
};

export const validateConfig = (config: Config) => {
  assertConfigFileComplete();
  checkMissingFields(config);

  //atleast one UI type must be selected
  if (!config.tui && !config.webui) {
    console.error(
      `Warning: Both TUI and WebUI are disabled. Nothing will be displayed.
{tui: ${config.tui}, webui: ${config.webui}}`,
    );
  }
};
