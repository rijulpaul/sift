import * as p from "@clack/prompts";

import completions from "./config/completions.json" with { type: "json" };
import type { Config } from "./config/config";
import {
  readRawConfig,
  resolveConfig,
  validateConfig,
  writeRawConfig,
  type ConfigOverrides,
  type ConfigValue,
  type RawConfig,
} from "./config/loader";
import type { ModelProvider } from "./core/agent/model";
import { logger } from "./core/logger";

// Debug-only logging: info logs would corrupt the interactive TUI,
// set LOG_LEVEL=debug to see these alongside the prompts.
const log = logger.child({ module: "launcher" });

/**
 * What the provider menu offers. A custom endpoint speaks the OpenAI protocol
 * but is not OpenAI: it is identified by its base URL, not by a model name, so
 * picking it asks a different question.
 */
interface ProviderChoice {
  provider: ModelProvider;
  /** True for the OpenAI-compatible endpoint the reader hosts themselves. */
  customEndpoint?: boolean;
}

const MODEL_PROVIDERS: Record<string, ProviderChoice> = {
  anthropic: { provider: "anthropic" },
  google: { provider: "google" },
  openai: { provider: "openai" },
  openrouter: { provider: "openrouter" },
  "custom endpoint (OpenAI compatible)": {
    provider: "openai",
    customEndpoint: true,
  },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE_URL_REGEX = /^https?:\/\/\S+$/i;

/** Settings saved as a base URL rather than a model name. */
const BASE_URL_KEYS = new Set(["llm_base_url", "vlm_base_url"]);

const VLM_KEYS = new Set(["vlm_provider", "vlm_name"]);

/** `llm_name` and `vlm_name` are the key that follows the provider, so they
 * decide whether that provider needs a name or a URL. */
const prefixOf = (key: string): string => key.split("_")[0]!;

/** Settings written to defaults.json; see also `assertConfigFileComplete`. */
const CONFIG_KEYS = Object.keys(completions);

type PromptValue = string | boolean;

function abort(message = "Goodbye"): never {
  p.cancel(message);
  process.exit(0);
}

/** Throw on Ctrl+C / Esc so the remaining code sees a plain value. */
function unwrap<T>(value: T | typeof p.CANCEL_SYMBOL): T {
  if (p.isCancel(value)) abort();
  return value as T;
}

/** The provider menu: the label reads well, the value is what config stores. */
const promptForProvider = async (
  key: string,
  current: ConfigValue,
): Promise<ProviderChoice> => {
  const { description } = completions[key as keyof typeof completions];
  const labels = Object.keys(MODEL_PROVIDERS);
  const currentLabel = labels.find(
    (label) => MODEL_PROVIDERS[label]!.provider === current,
  );

  const label = unwrap(
    await p.select<string>({
      message: description,
      options: labels.map((value) => ({ value, label: value })),
      initialValue: currentLabel,
    }),
  );

  return MODEL_PROVIDERS[label]!;
};

const promptFor = async (
  key: string,
  current: ConfigValue,
): Promise<PromptValue> => {
  const { description, type } = completions[key as keyof typeof completions];

  // Boolean settings
  if (type === "boolean") {
    return await p
      .confirm({
        message: `${description}?`,
        initialValue: Boolean(current),
      })
      .then(unwrap);
  }

  // Everything else is free-form text
  const isEmail = key === "email";
  const isBaseUrl = BASE_URL_KEYS.has(key);
  // The reader's own instructions are the one optional text setting.
  const isOptional = key === "user_prompt";
  const value = await p.text({
    message: description,
    placeholder: current === null ? "not set" : undefined,
    initialValue: typeof current === "string" ? current : undefined,
    validate: (input) => {
      const value = (input ?? "").trim();

      if (isOptional) {
        return;
      }
      if (value === "") {
        return "This field is required";
      }
      if (isEmail && !EMAIL_REGEX.test(value)) {
        return "Enter a valid email address";
      }
      if (isBaseUrl && !BASE_URL_REGEX.test(value)) {
        return "Enter a full URL, e.g. http://localhost:11434/v1";
      }
    },
  });
  return unwrap(value);
};

const configure = async (
  base: RawConfig,
  only?: Set<string>,
): Promise<void> => {
  log.debug({ scope: only ? [...only] : "all" }, "starting configuration");

  const working: RawConfig = { ...base };

  p.log.step(only ? "Setting up missing configuration" : "Configure sift");
  p.log.message("Values are saved to config/defaults.json");

  /** Provider keys whose answer was the custom endpoint. */
  const customEndpoints = new Set<string>();

  for (const key of Object.keys(completions)) {
    if (only && !only.has(key)) continue;

    // A base URL is asked with the model name, never on its own.
    if (BASE_URL_KEYS.has(key)) continue;

    // Vision settings are only relevant when image processing is enabled.
    if (VLM_KEYS.has(key) && working.process_images === false) continue;

    if (key.endsWith("_provider")) {
      const choice = await promptForProvider(key, working[key] ?? null);
      working[key] = choice.provider;
      // Drop the value that the new choice does not use, so a model name and
      // a base URL never linger side by side after switching providers.
      if (choice.customEndpoint) {
        customEndpoints.add(prefixOf(key));
        working[`${prefixOf(key)}_name`] = null;
      } else {
        customEndpoints.delete(prefixOf(key));
        working[`${prefixOf(key)}_base_url`] = null;
      }
      continue;
    }

    // A custom endpoint has no model name to give: its base URL is what says
    // where the model lives, so that is the question asked in its place.
    if (key.endsWith("_name") && customEndpoints.has(prefixOf(key))) {
      const baseUrlKey = `${prefixOf(key)}_base_url`;
      const value = await promptFor(baseUrlKey, working[baseUrlKey] ?? null);
      working[baseUrlKey] = value === "" ? null : value;
      continue;
    }

    const value = await promptFor(key, working[key] ?? null);
    working[key] = value === "" ? null : value;
  }

  // The loop above skips settings that don't apply (the vision keys when image
  // processing is off). Write them out as null anyway: assertConfigFileComplete
  // requires every known key to be present.
  for (const key of CONFIG_KEYS) working[key] ??= null;

  writeRawConfig(working);
  log.debug(
    { keys: Object.keys(working) },
    "configuration written to defaults.json",
  );
  p.log.success("Configuration saved to config/defaults.json");
};

export const createConfig = () => configure(readRawConfig());

const start = async (overrides: ConfigOverrides): Promise<Config> => {
  const config = resolveConfig(overrides);
  validateConfig(config);

  log.debug(
    {
      llm: config.llmProvider
        ? `${config.llmProvider}/${config.llmName}`
        : "(unset)",
    },
    "starting sift",
  );
  p.outro("Starting sift");
  return config;
};

export const runLauncher = async (
  overrides: ConfigOverrides,
): Promise<Config> => {
  log.debug("launcher started");
  p.intro(`
                               ┌─────────────────────────┐
███████╗██╗███████╗████████╗   │ ------ THE DAILY ------ │
██╔════╝██║██╔════╝╚══██╔══╝   │ ───────────── ┌───────┐ │
███████╗██║█████╗     ██║      │ ░░░░░░░░░░░░░ │       │ │
╚════██║██║██╔══╝     ██║      │ ░░░░░░░░░░░░░ │       │ │
███████║██║██║        ██║      │ ░░░░░░░░░░░░░ └───────┘ │
                               └─────────────────────────┘`);

  for (;;) {
    const action = unwrap(
      await p.select<"start" | "configure" | "exit">({
        message: "What would you like to do?",
        initialValue: "start",
        options: [
          {
            value: "start",
            label: "Start",
            hint: "run sift with the saved configuration",
          },
          {
            value: "configure",
            label: "Configure",
            hint: "edit config/defaults.json",
          },
          { value: "exit", label: "Exit" },
        ],
      }),
    );

    if (action === "configure") {
      log.debug("configure selected");
      await configure(readRawConfig());
      p.log.message("Back to the main menu");
      continue;
    }

    if (action === "exit") {
      log.debug("exit selected");
      abort();
    }

    log.debug("start selected");
    return await start(overrides);
  }
};
