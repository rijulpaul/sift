import pino from "pino";

const isTest = process.env.VITEST === "true";
const isPrettyLog = !isTest && process.env.PRETTY_LOG === "true";

const date = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
const logFile = `./logs/${date}.log`;

const options = {
  destination: logFile,
  mkdir: true,
};

export const logger = pino({
  level: isTest
    ? process.env.TEST_LOG_LEVEL || "silent"
    : process.env.LOG_LEVEL || "silent",

  transport: {
    target: isPrettyLog ? "pino-pretty" : "pino/file",
    options:
      !process.env.LOG_LEVEL || process.env.LOG_LEVEL === "silent"
        ? undefined
        : options,
  },
});

if (!isTest && process.env.LOG_LEVEL && process.env.LOG_LEVEL !== "silent")
  console.log(`Logs being written to ${logFile}`);
