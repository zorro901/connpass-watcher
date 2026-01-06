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
      destination: process.stderr.fd,
    },
  };
}

// In production, write JSON logs to stderr
// In dev, pino-pretty handles destination via transport options
export const logger = isDev ? pino(options) : pino(options, pino.destination(2));

export function createChildLogger(name: string) {
  return logger.child({ module: name });
}
