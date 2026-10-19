// test/logger.test.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS FILE EXISTS
//   core/logger.ts picks its level when it is first imported, based on
//   VITEST / LOG_LEVEL / TEST_LOG_LEVEL. Under vitest the logger must be
//   silent so test output stays readable, and .env's LOG_LEVEL must not leak
//   in. Outside tests, LOG_LEVEL selects the level and defaults to silent.
//   These tests pin that behaviour.
//
// HOW THEY WORK
//   The logger is a module-level singleton, so each case:
//     1. sets the env vars it needs,
//     2. calls vi.resetModules() so the next import re-evaluates logger.ts,
//     3. imports it fresh and inspects the resulting level.
//   The env is restored after every test.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

// Snapshot of the real env, so every test starts from the same place.
const savedEnv = { ...process.env };

// Apply env overrides (undefined removes the variable), then load a fresh logger.
async function loadLogger(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const mod = await import("../core/logger");
  return mod.logger;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe("logger — under vitest (test runs)", () => {
  it("is silent by default", async () => {
    const logger = await loadLogger({
      LOG_LEVEL: undefined,
      TEST_LOG_LEVEL: undefined,
    });

    expect(logger.level).toBe("silent");
  });

  it("disables every level, including fatal", async () => {
    const logger = await loadLogger({
      LOG_LEVEL: undefined,
      TEST_LOG_LEVEL: undefined,
    });

    for (const level of LEVELS) {
      expect(logger.isLevelEnabled(level)).toBe(false);
    }
  });

  it("passes silence on to child loggers used by modules", async () => {
    const logger = await loadLogger({
      LOG_LEVEL: undefined,
      TEST_LOG_LEVEL: undefined,
    });

    const child = logger.child({ module: "mail" });

    expect(child.level).toBe("silent");
    expect(child.isLevelEnabled("error")).toBe(false);
  });

  it("ignores LOG_LEVEL, so a .env value cannot re-enable output", async () => {
    // .env ships LOG_LEVEL=warn. If tests honoured it, warn/error output
    // would come back partway through a run.
    const logger = await loadLogger({
      LOG_LEVEL: "warn",
      TEST_LOG_LEVEL: undefined,
    });

    expect(logger.level).toBe("silent");
  });

  it("can be opted into with TEST_LOG_LEVEL", async () => {
    const logger = await loadLogger({
      LOG_LEVEL: undefined,
      TEST_LOG_LEVEL: "debug",
    });

    expect(logger.level).toBe("debug");
    expect(logger.isLevelEnabled("debug")).toBe(true);
    expect(logger.isLevelEnabled("trace")).toBe(false);
  });

  it("TEST_LOG_LEVEL still wins when LOG_LEVEL is also set", async () => {
    const logger = await loadLogger({
      LOG_LEVEL: "error",
      TEST_LOG_LEVEL: "info",
    });

    expect(logger.level).toBe("info");
  });
});

describe("logger — outside vitest (app runs)", () => {
  // Clearing VITEST makes logger.ts take the application branch. NODE_ENV is
  // set to production to match a real app run.
  const appEnv = { VITEST: undefined, NODE_ENV: "production" };

  it("is silent when LOG_LEVEL is unset", async () => {
    const logger = await loadLogger({ ...appEnv, LOG_LEVEL: undefined });

    expect(logger.level).toBe("silent");
  });

  it("honours LOG_LEVEL", async () => {
    const logger = await loadLogger({ ...appEnv, LOG_LEVEL: "warn" });

    expect(logger.level).toBe("warn");
    expect(logger.isLevelEnabled("info")).toBe(false);
    expect(logger.isLevelEnabled("warn")).toBe(true);
  });

  it("treats an empty LOG_LEVEL as unset instead of crashing", async () => {
    // pino throws on an empty level string. logger.ts uses || so an empty
    // value falls back to the default.
    const logger = await loadLogger({ ...appEnv, LOG_LEVEL: "" });

    expect(logger.level).toBe("silent");
  });

  it("ignores TEST_LOG_LEVEL outside tests", async () => {
    const logger = await loadLogger({
      ...appEnv,
      LOG_LEVEL: undefined,
      TEST_LOG_LEVEL: "debug",
    });

    expect(logger.level).toBe("silent");
  });
});
