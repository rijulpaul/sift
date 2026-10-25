import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // OpenTUI's native renderer only loads under Bun, so the end-to-end TUI
    // tests (*.bun.test.ts) run with `bun test` instead (see `test:tui`).
    exclude: [...configDefaults.exclude, "**/*.bun.test.ts"],
  },
});
