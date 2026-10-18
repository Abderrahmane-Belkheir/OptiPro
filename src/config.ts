import fs from "node:fs";
import path from "node:path";
import { appDataDir } from "./lib/appData";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  /** The remote database (Neon), as a connection string: postgresql://user:password@host/dbname. */
  databaseUrl: string;
  /**
   * The shop's tenant key: what the shop presents to the server when it uploads photos
   * (`Authorization: Bearer <key>`). Optional here, so the app runs without it; features that need
   * it call requireTenantKey().
   */
  tenantKey: string | null;
  /**
   * The address of the shop's server (where the website and the photo upload live), for example
   * https://maison-clair.example.com, without a trailing slash. Optional here; features that need it
   * call requireServerUrl().
   */
  serverUrl: string | null;
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
 * value (so URLs with `=`, `:` or `?` are fine). No escapes and no multi-line values.
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
 * restart. The file must exist and `database.url` must be there and not empty (`tenant.key` and `server.url` are optional); otherwise this throws
 * a ConfigError saying exactly what to fix (the app shows it and closes).
 */
export function getConfig(): AppConfig {
  const file = configFilePath();

  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `Settings file not found: ${file}\nCreate it with this line:\n  database.url=postgresql://user:password@host/dbname`,
      );
    }
    throw new ConfigError(`Cannot read the settings file ${file}: ${(err as Error).message}`);
  }

  const parsed = parseProperties(text);
  const databaseUrl = parsed.get("database.url");
  if (!databaseUrl) {
    throw new ConfigError(`${file} must contain a database.url line that is not empty:\n  database.url=postgresql://user:password@host/dbname`);
  }

  return { databaseUrl, tenantKey: parsed.get("tenant.key") || null, serverUrl: parsed.get("server.url")?.replace(/\/+$/, "") || null };
}

/** The tenant key from the settings file; throws a ConfigError saying how to add it when it is missing. */
export function requireTenantKey(): string {
  const { tenantKey } = getConfig();
  if (!tenantKey) {
    throw new ConfigError(`${configFilePath()} must contain a tenant.key line that is not empty (it is what identifies the shop to the server):
  tenant.key=<your tenant key>`);
  }
  return tenantKey;
}

/** The server address from the settings file, checked to be an http(s) address; throws a ConfigError saying how to fix it. */
export function requireServerUrl(): string {
  const { serverUrl } = getConfig();
  const hint = `${configFilePath()} must contain a server.url line with the address of your server (it is where photos are uploaded):
  server.url=https://your-domain.com`;
  if (!serverUrl) throw new ConfigError(hint);
  try {
    if (!/^https?:$/.test(new URL(serverUrl).protocol)) throw new Error("not http");
  } catch {
    throw new ConfigError(`server.url "${serverUrl}" is not a web address.
${hint}`);
  }
  return serverUrl;
}
