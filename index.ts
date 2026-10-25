import { ArgumentParser } from "argparse";

import completions from "./config/completions.json" with { type: "json" };
import type { ConfigOverrides } from "./config/loader";
import { resolveConfig, validateConfig } from "./config/loader";
import { SiftCore } from "./core";
import { createConfig, runLauncher } from "./launcher";
import { startTui } from "./cli";
import { fileURLToPath } from "bun";
import { existsSync } from "node:fs";

const parser = new ArgumentParser({
  description: "Sift — AI newsletter manager",
});

const types = {
  string: String,
  number: Number,
} as const;

parser.add_argument("--no-launcher", {
  dest: "launcher",
  action: "store_false",
  default: true,
  help: "Skip the interactive launcher and run with the saved configuration",
});

for (const [key, definition] of Object.entries(completions)) {
  if (definition.type === "boolean") {
    parser.add_argument(definition.flag, {
      dest: key,
      action: "store_true",
      default: undefined,
      help: definition.description,
    });

    parser.add_argument(`--no-${key.replaceAll("_", "-")}`, {
      dest: key,
      action: "store_false",
      default: undefined,
      help: `Disable ${definition.description.toLowerCase()}`,
    });

    continue;
  }

  parser.add_argument(definition.flag, {
    dest: key,
    type: types[definition.type as keyof typeof types],
    default: undefined,
    help: definition.description,
  });
}

const args = parser.parse_args() as ConfigOverrides & { launcher: boolean };

const defaultsPath = fileURLToPath(
  new URL("./config/defaults.json", import.meta.url),
);
if (!existsSync(defaultsPath)) {
  await createConfig();
}

let config;
if (args.launcher) {
  config = await runLauncher(args);
} else {
  config = resolveConfig(args);
}

validateConfig(config);

const core = await SiftCore.init(config);

if (config.tui) {
  await startTui(core, { onExit: () => process.exit(0) });
}
if (config.webui) {
  const vite = Bun.spawn({
    cmd: ["bun", "run", "--cwd", "web", "dev"],
    stdout: "inherit",
    stderr: "inherit",
  });
}
