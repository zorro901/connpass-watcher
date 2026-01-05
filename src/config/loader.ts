import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { type Config, configSchema, defaultConfig } from "./schema.js";

const CONFIG_FILENAME = "config.yaml";
const APP_DIR = ".connpass-watcher";

function getConfigPaths(): string[] {
  return [join(process.cwd(), CONFIG_FILENAME), join(homedir(), APP_DIR, CONFIG_FILENAME)];
}

export function findConfigPath(): string | null {
  for (const path of getConfigPaths()) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export function loadConfig(customPath?: string): Config {
  const configPath = customPath ?? findConfigPath();

  if (!configPath) {
    return defaultConfig;
  }

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(content);

  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid config:\n${errors}`);
  }

  return result.data;
}

export function getAppDataDir(): string {
  const dir = join(homedir(), APP_DIR);
  return dir;
}
