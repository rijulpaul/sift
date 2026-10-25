import { createCliRenderer, type CliRenderer } from "@opentui/core";

import type { SiftCore } from "../core";
import { App } from "./app";
import { theme } from "./theme";
import type { TuiHandle, TuiOptions } from "./types";

export type { MailSummary, TuiHandle, TuiOptions } from "./types";

/**
 * Mount the mailbox TUI on an existing renderer. Use this when you own the
 * renderer yourself (for example in tests).
 */
export async function mountTui(
  renderer: CliRenderer,
  core: SiftCore,
  options: TuiOptions = {},
): Promise<TuiHandle> {
  const app = new App(renderer, core, options);
  app.start();
  return app;
}

/**
 * Start the mailbox TUI in the current terminal, on the given core.
 *
 *   await startTui(core, { onExit: () => process.exit(0) });
 *
 * Resolves as soon as the screen is up. Mail is listed as the core streams it
 * in, and load failures are shown inside the TUI (press `r` to retry).
 */
export async function startTui(
  core: SiftCore,
  options: TuiOptions = {},
): Promise<TuiHandle> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    backgroundColor: theme.bg,
  });
  return mountTui(renderer, core, options);
}
