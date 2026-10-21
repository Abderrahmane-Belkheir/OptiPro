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

/** Only the app's real settings location is filled in from the defaults; a file named by OPTIPRO_CONFIG_FILE (tests) never is. */
function usesStandardLocation(): boolean {
  return !process.env.OPTIPRO_CONFIG_FILE?.trim();
}

/** The name of the settings built into the app: a resource file shipped with it (resources/default-config.properties). */
export const DEFAULTS_FILE_NAME = "default-config.properties";

/**
 * Where the built-in settings are looked for, first match wins:
 *   1. OPTIPRO_DEFAULTS_FILE, when set (tests): only that file;
 *   2. <resources folder of the installed app>/default-config.properties  (electron-builder: extraResources, next to app.asar);
 *   3. <app folder>/resources/default-config.properties  (running from the project with `electron .`, or inside the app.asar).
 */
function defaultsFileCandidates(): string[] {
  const override = process.env.OPTIPRO_DEFAULTS_FILE?.trim();
  if (override) return [override];
  const installed = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return [...(installed ? [path.join(installed, DEFAULTS_FILE_NAME)] : []), path.join(__dirname, "..", "resources", DEFAULTS_FILE_NAME)];
}

interface BuiltInSettings {
  tenantKey: string;
  serverUrl: string;
}

/** The built-in settings, or null when there is no such file or it holds no tenant.key (the fallback is then off). */
function loadBuiltInSettings(): BuiltInSettings | null {
  for (const file of defaultsFileCandidates()) {
    try {
      const parsed = parseProperties(fs.readFileSync(file, "utf8"));
      const tenantKey = parsed.get("tenant.key")?.trim();
      if (tenantKey) return { tenantKey, serverUrl: parsed.get("server.url")?.trim() ?? "" };
    } catch {
      // not there or not readable: try the next place
    }
  }
  return null;
}

/** The text of a settings file made from the settings built into the app, or null when there are none (see loadBuiltInSettings). */
function defaultConfigText(): string | null {
  const builtIn = loadBuiltInSettings();
  if (!builtIn) return null;
  return [
    "# OptiPro settings.",
    "# This file was created automatically the first time the app started without one, from the settings built into the app.",
    "# The app reads it on every start: edit it to change a setting.",
    "",
    "# What identifies the shop to the server.",
    `tenant.key=${builtIn.tenantKey}`,
    "",
    "# The address of the shop's server (where the website and the API live), https://..., no trailing slash.",
    `server.url=${builtIn.serverUrl}`,
    "",
  ].join("\n");
}

/**
 * Makes the settings file from the built-in defaults when it does not exist, and says what it is. Returns the text the
 * file now holds (the defaults', or another process's if it created the file a moment earlier), or null when nothing
 * can be done: the file is somewhere other than the standard location, or the built-in settings hold no tenant.key.
 * It never throws: when the file cannot be written (a read-only folder, say) the defaults are still returned, so the
 * app runs on them and tries to write the file again on its next start.
 */
function createConfigFromDefaults(file: string): string | null {
  if (!usesStandardLocation()) return null;
  const text = defaultConfigText();
  if (text === null) return null;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { encoding: "utf8", flag: "wx", mode: 0o600 }); // "wx": never overwrites a file that appeared meanwhile
    console.info(`[config] ${file} was not found: created it from the settings built into the app.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      try {
        return fs.readFileSync(file, "utf8"); // someone else just created it: use theirs
      } catch {
        return text;
      }
    }
    console.warn(`[config] ${file} was not found and could not be created (${(err as Error).message}); running on the settings built into the app.`);
  }
  return text;
}

/**
 * Called first thing at start-up (main.ts): looks for the settings file in its place (<app data>/OptiPro/config.properties)
 * and, when it is not there, creates it from the settings built into the app (resources/default-config.properties), so the next start finds
 * the file directly. A file that exists is never touched. Never throws and never needs the network.
 */
export function ensureConfigFile(): { file: string; existed: boolean; created: boolean } {
  const file = configFilePath();
  if (fs.existsSync(file)) return { file, existed: true, created: false };
  createConfigFromDefaults(file);
  return { file, existed: false, created: fs.existsSync(file) };
}

/**
 * Reads the settings file on every call — it's tiny, and it means an edit takes effect without a
 * restart. If the file does not exist it is created from the settings built into the app (see createConfigFromDefaults),
 * which are used for this call. Nothing in the file is required here (`tenant.key` and `server.url` are checked by
 * requireTenantKey / requireServerUrl where they are needed); a file that cannot be found or read throws a ConfigError.
 */
export function getConfig(): AppConfig {
  const file = configFilePath();

  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const created = createConfigFromDefaults(file);
      if (created === null) {
        throw new ConfigError(
          `Settings file not found: ${file}\nCreate it with these lines:\n  tenant.key=<your tenant key>\n  server.url=https://your-domain.com`,
        );
      }
      text = created;
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
