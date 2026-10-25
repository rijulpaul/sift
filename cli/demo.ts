/**
 * Runs the TUI on a mock core, so the screen can be tried without an account.
 *
 *   bun run cli/demo.ts                       summaries on demand
 *   bun run cli/demo.ts --summarize           summarize messages when opened
 *   bun run cli/demo.ts --mark-as-read        mark messages read when opened
 */
import { startTui } from "./index";
import { createMockCore } from "./mock";

const args = new Set(process.argv.slice(2));

const { core } = createMockCore({
  delayMs: 250,
  config: {
    summarize: args.has("--summarize"),
    markAsRead: args.has("--mark-as-read"),
  },
});

await startTui(core, { onExit: () => process.exit(0) });
