import pino from "pino";

const transport = [undefined,"development"].includes(process.env.NODE_ENV)
  ? { target: "pino-pretty" }
  : undefined;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: transport,
})
