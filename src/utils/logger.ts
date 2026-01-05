import pino, { type LoggerOptions } from "pino";

const isDev = process.env["NODE_ENV"] !== "production";

const options: LoggerOptions = {
  level: process.env["LOG_LEVEL"] ?? (isDev ? "debug" : "info"),
};

if (isDev) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss",
      ignore: "pid,hostname",
    },
  };
}

export const logger = pino(options);

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
