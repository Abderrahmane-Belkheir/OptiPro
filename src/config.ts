import fs from "node:fs";
import path from "node:path";
import { appDataDir } from "./lib/appData";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface ApiConfig {
  /** Origin of the backend, without a trailing slash. */
  apiUrl: string;
  /** The tenant's key — the credential the backend checks on every /api/tables request. */
  tenantKey: string;
}

export const CONFIG_FILE_NAME = "config.properties";

/**
 * <app data>/OptiPro/config.properties. OPTIPRO_CONFIG_FILE points somewhere else instead — meant
 * for tests, so they don't touch the real file.
 */
export function configFilePath(): string {
  return process.env.OPTIPRO_CONFIG_FILE?.trim() || path.join(appDataDir(), CONFIG_FILE_NAME);
}

/**
 * A small subset of Java's .properties format: `key=value` lines, `#` or `!` for comments, blank
 * lines ignored, whitespace around the key and value trimmed, anything after the first `=` is the
 * value (so URLs with `=` or `:` are fine). No escapes and no multi-line values.
 */
function parseProperties(text: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    properties.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return properties;
}

/**
 * Reads the settings file on every call — it's tiny, and it means an edit takes effect without a
 * restart. A missing or incomplete file fails the request that needs it (with a message saying
 * exactly what to create) rather than the whole app at startup.
 */
export function getApiConfig(): ApiConfig {
  const file = configFilePath();

  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `Settings file not found: ${file}\nCreate it with these two lines:\n  server.url=http://localhost:4000\n  tenant.key=<your tenant key>`,
      );
    }
    throw new ConfigError(`Cannot read the settings file ${file}: ${(err as Error).message}`);
  }

  const properties = parseProperties(text);
  const missing = ["server.url", "tenant.key"].filter((key) => !properties.get(key));
  if (missing.length) throw new ConfigError(`${file} is missing: ${missing.join(", ")}.`);

  const apiUrl = properties.get("server.url")!.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(apiUrl)) {
    throw new ConfigError(`server.url in ${file} must start with http:// or https:// (got "${apiUrl}").`);
  }

  return { apiUrl, tenantKey: properties.get("tenant.key")! };
}
