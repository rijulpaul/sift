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

const MODEL_PROVIDERS: ModelProvider[] = [
  "anthropic",
  "google",
  "openai",
  "openrouter",
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VLM_KEYS = new Set(["vlm_provider", "vlm_name"]);

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

  // Provider settings are a fixed choice
  if (key.endsWith("_provider")) {
    return unwrap(
      await p.select<ModelProvider>({
        message: description,
        options: MODEL_PROVIDERS.map((provider) => ({
          value: provider,
          label: provider,
        })),
        initialValue: MODEL_PROVIDERS.includes(current as ModelProvider)
          ? (current as ModelProvider)
          : undefined,
      }),
    );
  }

  // Everything else is free-form text
  const isEmail = key === "email";
  const value = await p.text({
    message: isEmail
      ? `${description} (leave empty to auto-create an inbox)`
      : description,
    placeholder: current === null ? "not set" : undefined,
    initialValue: typeof current === "string" ? current : undefined,
    validate: (input) => {
      if (isEmail) {
        if (input !== undefined && input !== "" && !EMAIL_REGEX.test(input)) {
          return "Enter a valid email address";
        }
        return;
      }
      if (input === undefined || input.trim() === "") {
        return "This field is required";
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

  for (const key of Object.keys(completions)) {
    if (only && !only.has(key)) continue;

    // Vision settings are only relevant when image processing is enabled.
    if (VLM_KEYS.has(key) && working.process_images === false) continue;

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
