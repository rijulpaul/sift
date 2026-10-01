// core/logger.test.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//   logger.ts builds a pino logger ONCE at import time, reading two env vars:
//     - LOG_LEVEL  → controls the minimum log level ("info" by default)
//     - NODE_ENV   → "development"/unset adds a pretty-print transport
//
//   Because configuration happens at module initialization, we cannot just
//   import the module and then mutate process.env — the logger was already
//   built. Instead we use three techniques:
//
//   vi.stubEnv(name, value)
//     Temporarily override an env var for the duration of the test.
//     vi.unstubAllEnvs() restores them all afterwards (in afterEach).
//
//   vi.resetModules()
//     Drop the module system's cache, so the NEXT import re-executes the
//     module body from scratch — i.e. re-reads our stubbed env vars.
//
//   await import("./logger")
//     Dynamic import (inside the test, AFTER resetModules) gives us a fresh
//     module instance configured the way we stubbed it.
//
//   We also stub NODE_ENV="production" so no pino-pretty transport is created:
//   pretty printing spawns a worker thread which would keep the test process
//   alive. Production mode is plain JSON — no threads, clean tests.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, describe, expect, it, vi } from "vitest";

// The path is relative to THIS file (core/logger.test.ts → core/logger.ts).
const LOGGER_PATH = "./logger";

describe("logger", () => {
  // afterEach runs after EVERY test in this suite.
  // It's the cleanup counterpart of beforeEach.
  afterEach(() => {
    // Restore every env var that stubEnv touched.
    vi.unstubAllEnvs();
    // And forget the cached logger module so the next dynamic import
    // re-runs its initialization code.
    vi.resetModules();
  });

  it("defaults to the info level when LOG_LEVEL is not set", async () => {
    // Arrange
    vi.stubEnv("NODE_ENV", "production"); // no pretty transport in tests
    vi.stubEnv("LOG_LEVEL", undefined); // "unset" the var (undefined deletes it)

    // Act — re-import: the module body runs again, reading the stubbed env
    const { logger } = await import(LOGGER_PATH);

    // Assert — the default in logger.ts is ?? "info"
    expect(logger.level).toBe("info");
  });

  it("respects an explicit LOG_LEVEL from the environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "debug");

    const { logger } = await import(LOGGER_PATH);

    expect(logger.level).toBe("debug");
  });
});
