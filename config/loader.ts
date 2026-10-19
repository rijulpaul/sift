import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ModelProvider } from "../core/agent/model";
import type { Config } from "./config";

/** A single config value as serialized in defaults.json. */
export type ConfigValue = boolean | string | null;

/** The raw (snake_case) shape of defaults.json. */
export type RawConfig = Record<string, ConfigValue>;

/** Per-run overrides, e.g. parsed CLI flags (`undefined` = flag not passed). */
export type ConfigOverrides = Record<string, ConfigValue | undefined>;

const defaultsPath = fileURLToPath(new URL("./defaults.json", import.meta.url));

export const readRawConfig = (): RawConfig =>
  JSON.parse(readFileSync(defaultsPath, "utf8")) as RawConfig;

export const writeRawConfig = (config: RawConfig): void => {
  writeFileSync(defaultsPath, `${JSON.stringify(config, null, 2)}\n`);
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
    autoMarkAsRead: Boolean(raw.auto_mark_as_read),
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
const checkMissingFields = (config: Config)  => {
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
  checkMissingFields(config)

  //atleast one UI type must be selected
  if (!config.tui && !config.webui) {
    console.error(
      `Warning: Both TUI and WebUI are disabled. Nothing will be displayed.
{tui: ${config.tui}, webui: ${config.webui}}`
    )
  }
}
