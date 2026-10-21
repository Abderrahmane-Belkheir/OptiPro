import os from "node:os";
import path from "node:path";

export const APP_FOLDER_NAME = "OptiPro";

/**
 * The app's folder inside the OS's per-user app data directory — %APPDATA%\OptiPro on Windows,
 * ~/Library/Application Support/OptiPro on macOS, ~/.config/OptiPro on Linux. That is where
 * Electron's app.getPath("appData") points too (sqliteClient.ts uses it for the database); it's
 * computed here instead so code that never runs inside Electron — tests, scripts — can find it.
 */
export function appDataDir(): string {
  const home = os.homedir();
  let base: string;
  switch (process.platform) {
    case "win32":
      base = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
      break;
    case "darwin":
      base = path.join(home, "Library", "Application Support");
      break;
    default:
      base = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  }
  return path.join(base, APP_FOLDER_NAME);
}

/**
 * Where the photos picked for products are kept on this computer: <app data>/OptiPro/images, one file per photo,
 * named by the photo's id. OPTIPRO_IMAGES_DIR points somewhere else instead, meant for tests so they don't
 * touch the real folder.
 */
export function imagesDir(): string {
  return process.env.OPTIPRO_IMAGES_DIR?.trim() || path.join(appDataDir(), "images");
}
