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
  /**
   * The shop's tenant key: what identifies the shop to the server (`Authorization: Bearer <key>`) and which shop
   * the local data belongs to. Optional here; features that need it call requireTenantKey().
   */
  tenantKey: string | null;
  /**
   * The address of the shop's server (where the website and the API live), for example
   * https://maison-clair.example.com, without a trailing slash. Optional here; features that need it
   * call requireServerUrl().
   */
  serverUrl: string | null;
  /** Label printing (all optional, read as typed; checked where they are used): the label's size in mm and the printer's name. */
  labelWidth: string | null;
  labelHeight: string | null;
  labelPrinter: string | null;
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
 * Reads the settings file on every call — it's tiny, and it means an edit takes effect without a restart. Nothing in the file is required here
 * (`tenant.key` and `server.url` are checked by requireTenantKey / requireServerUrl where they are needed, and by configProblem at start-up);
 * a file that cannot be found or read throws a ConfigError.
 */
export function getConfig(): AppConfig {
  const file = configFilePath();

  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
          `Settings file not found: ${file}\nCreate it with these lines:\n  tenant.key=<your tenant key>\n  server.url=https://your-domain.com`,
      );
    } else {
      throw new ConfigError(`Cannot read the settings file ${file}: ${(err as Error).message}`);
    }
  }

  const parsed = parseProperties(text);
  return {
    tenantKey: parsed.get("tenant.key") || null,
    serverUrl: parsed.get("server.url")?.replace(/\/+$/, "") || null,
    labelWidth: parsed.get("label.width") || null,
    labelHeight: parsed.get("label.height") || null,
    labelPrinter: parsed.get("label.printer") || null,
  };
}

/** The tenant key from the settings file; throws a ConfigError saying how to add it when it is missing. */
export function requireTenantKey(): string {
  const { tenantKey } = getConfig();
  if (!tenantKey) {
    throw new ConfigError(`${configFilePath()} must contain a tenant.key line that is not empty (it is what identifies the shop to the server and to this computer's data):
  tenant.key=<your tenant key>`);
  }
  return tenantKey;
}

/** The server address from the settings file, checked to be an http(s) address; throws a ConfigError saying how to fix it. */
export function requireServerUrl(): string {
  const { serverUrl } = getConfig();
  const hint = `${configFilePath()} must contain a server.url line with the address of your server (it is where the app sends its data and photos):
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

/** What is wrong with the settings file that stops the app from starting: it is missing, cannot be read, or lacks tenant.key or server.url. */
export type ConfigProblem = "missing" | "unreadable" | "no-tenant-key" | "no-server-url";

/**
 * Looks at the settings file without creating or changing anything: null when it exists and holds both a tenant.key and a server.url,
 * otherwise the first thing that is wrong. The app does not start while there is a problem: it shows the setup page instead.
 */
export function configProblem(): ConfigProblem | null {
  const file = configFilePath();
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
  const parsed = parseProperties(text);
  if (!parsed.get("tenant.key")) return "no-tenant-key";
  if (!parsed.get("server.url")) return "no-server-url";
  return null;
}

/**
 * Writes tenant.key and server.url into the settings file (creating the folder and the file when they are missing). Other lines of an
 * existing file (label size, printer, comments) are kept; the two settings are replaced when present and added when not. The file is made
 * readable by its owner only, since the tenant key is a secret. Throws a ConfigError when it cannot be written.
 */
export function saveSettings(settings: { tenantKey: string; serverUrl: string }): void {
  const file = configFilePath();
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/);
    if (lines[lines.length - 1] === "") lines.pop();
  } catch {
    lines = ["# OptiPro settings. Written by the setup on the first run; the app reads this file on every start."];
  }
  const put = (key: string, value: string) => {
    const at = lines.findIndex((line) => line.split("=")[0].trim() === key && !line.trim().startsWith("#"));
    if (at >= 0) lines[at] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  };
  put("tenant.key", settings.tenantKey);
  put("server.url", settings.serverUrl.replace(/\/+$/, ""));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    throw new ConfigError(`The settings file ${file} could not be written: ${(err as Error).message}`);
  }
}
