import pino from "pino";

const isTest = process.env.VITEST === "true";

const transport =
  !isTest && process.env.PRETTY_LOG === "true"
    ? { target: "pino-pretty" }
    : undefined;

export const logger = pino({
  level: isTest
    ? process.env.TEST_LOG_LEVEL || "silent"
    : process.env.LOG_LEVEL || "silent",
  transport: transport,
});
