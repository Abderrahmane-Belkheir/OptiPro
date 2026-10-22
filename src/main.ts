import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, configProblem, getConfig, saveSettings } from "./config";
import { electronLabelPrinter } from "./labelPrinter";
import { electronDocumentPrinter } from "./documentPrinter";
import { activate } from "./setup";
import { contextMenuTemplate, editMenuTemplate } from "./editMenu";

// The database, the sync and the IPC handlers are loaded only once the settings are known to be complete (see start below): until then
// nothing of the app runs, not even the local database is opened.

const rendererPage = path.join(__dirname, "../renderer/index.html");
const setupPage = path.join(__dirname, "../renderer/setup.html");
const expiredPage = path.join(__dirname, "../renderer/expired.html");
const windowIcon = path.join(__dirname, "../build/icon.png");

/** The expiry day the server answered when the shop registered, kept until the local database is open (the database is not opened before the settings are complete). */
let pendingExpiry: string | null = null;
let pendingShop: { name: string; phone?: string; email?: string; address?: string; instagramUrl?: string; tiktokUrl?: string } | null = null;

/** The setup window while it is open: it is closed once the app's own window is there (so the app never has "no window" in between and quits). */
let setupWindow: BrowserWindow | null = null;

/** Right-click in a field or on selected text shows Cut / Copy / Paste / Select all (Electron has no context menu of its own). */
function enableClipboardMenu(win: BrowserWindow): void {
    win.webContents.on("context-menu", (_event, params) => {
        const template = contextMenuTemplate(params);
        if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: win });
    });
}

/** Only the app's own page, in the top frame, may call the database (not an iframe, not a page it navigated to). */
function isTrustedSender(event: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null }): boolean {
    const frame = event.senderFrame;
    return Boolean(frame) && frame === event.sender.mainFrame && frame!.url.startsWith(pathToFileURL(rendererPage).href);
}

function createWindow(): void {

    const win = new BrowserWindow({
        // build/icon.png is the demo icon (replace the file to change it, see build/README.md); a missing file just means the default icon.
        ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
        width: 1280,
        height: 800,
        // Below this the shell has no room to work (see the sidebar and top bar in renderer/styles).
        minWidth: 900,
        minHeight: 560,
        backgroundColor: "#f4f5f6", // --color-canvas, so the window never flashes white while the page loads
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            // Stated explicitly (they are also the defaults): the page gets no Node, only window.electronAPI.
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    enableClipboardMenu(win);
    win.loadFile(rendererPage);
    // The setup window (when the app was started from it) is no longer needed.
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
    setupWindow = null;
}

/** Only the setup page, in its top frame, may send the form. */
function isTrustedSetupSender(event: Electron.IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame;
    return Boolean(frame) && frame === event.sender.mainFrame && frame!.url.startsWith(pathToFileURL(setupPage).href);
}

/**
 * The window shown when the settings file is missing or lacks tenant.key or server.url: a form for the shop's key, its server address and its
 * details. Confirm sends them to the server (see ./setup): when it accepts them the settings file is written and the app starts, when the server
 * refuses the key, cannot be reached or finds the details wrong the form stays open with a message (the app never closes because of it). The app does not start behind it.
 */
function createSetupWindow(): void {
    setupWindow = new BrowserWindow({
        ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
        width: 760,
        height: 900,
        minWidth: 520,
        minHeight: 560,
        backgroundColor: "#f4f5f6",
        autoHideMenuBar: true,
        // Its only link to the app is window.setupAPI.confirm (src/setupPreload.ts); there is no electronAPI and no database behind it.
        webPreferences: { preload: path.join(__dirname, "setupPreload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    enableClipboardMenu(setupWindow);
    setupWindow.loadFile(setupPage);
}

/**
 * The window shown instead of the app when the expiry day saved on this computer is before today: it says the licence ended and offers nothing else.
 * It has no preload and no access to anything; the sync, the IPC handlers and the app's own window are never started behind it.
 */
function createExpiredWindow(refused: boolean): void {
    const win = new BrowserWindow({
        ...(fs.existsSync(windowIcon) ? { icon: windowIcon } : {}),
        width: 640,
        height: 360,
        minWidth: 420,
        minHeight: 280,
        backgroundColor: "#f4f5f6",
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    // (no day: the server refused the key, the page says so instead of naming a day)
    enableClipboardMenu(win);
    win.loadFile(expiredPage, refused ? { query: { refused: "1" } } : undefined);
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
    setupWindow = null;
}

ipcMain.handle("setup:confirm", async (event, details: unknown) => {
    if (!isTrustedSetupSender(event)) return { kind: "invalid", message: "Not allowed." };
    const outcome = await activate(details);
    if (outcome.kind === "activated") {
        try {
            saveSettings({ tenantKey: outcome.tenantKey, serverUrl: outcome.serverUrl });
        } catch (err) {
            return { kind: "invalid", message: err instanceof ConfigError ? err.message : "The settings file could not be written." };
        }
        // The settings are complete now: start the app (its window replaces the setup window); it stores the expiry once the database is open.
        pendingExpiry = outcome.expiry;
        pendingShop = outcome.shop; // the details the server accepted: kept next to the expiry day in the local licence table
        setTimeout(() => void start(), 600);
        return { kind: "activated" };
    }
    return outcome;
});

async function start(): Promise<void> {
    // First: the settings file (<app data>/OptiPro/config.properties) must exist and hold a tenant.key and a server.url. A new installation has no
    // such file: the app does NOT start, the setup page opens instead (nothing is built into the app, no file is made for the person).
    const problem = configProblem();
    if (problem !== null) {
        console.warn(`[config] the settings are not complete (${problem}): showing the setup page, the app does not start.`);
        if (!setupWindow) createSetupWindow();
        return;
    }
    // The settings file must be readable; without it the app closes here instead of opening a window that can't work.
    try {
        getConfig();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
    }

    console.info(`[startup] settings are complete (server: ${getConfig().serverUrl}): loading the app`);
    // Only now is the rest of the app loaded (this opens the local database).
    // (require, not import: this file's imports are resolved when it loads, and these must wait until here)
    const { ensureProductCodes, seedCategories, setLabelPrinter, setDocumentPrinter, checkUnsynced, startSyncScheduler, stopSyncScheduler, sweepOrphanPhotoFiles, setUnauthorizedHandler, checkExpiryWithServer } = require("./local") as typeof import("./local/index");
    // When the server turns the shop away (unknown key, licence ended), an old expiry day has been saved: the sync stops, the app's windows are replaced by
    // the page that says so (the customer knows to call), and the next start is blocked by the saved day.
    setUnauthorizedHandler(() => {
        console.warn("[license] the server refused the tenant key: the app stops.");
        stopSyncScheduler();
        const open = BrowserWindow.getAllWindows();
        createExpiredWindow(true);
        for (const win of open) if (!win.isDestroyed()) win.close();
    });
    const { currentTenantKey } = require("./local/context") as typeof import("./local/context");
    const { registerIpcHandlers } = require("./ipc/handlers") as typeof import("./ipc/handlers");

    // Which shop is this? The tenant.key of the settings file, remembered in the local database. Not knowing it is the one thing that stops the app.
    try {
        await currentTenantKey();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
    }
    // A shop that has just registered: its licence's expiry day (today + 14 days, from the server) and the details it registered with go into the local database.
    if (pendingExpiry !== null) {
        try {
            const { localLicenseService } = require("./local") as typeof import("./local/index");
            await localLicenseService.setExpiry(pendingExpiry, pendingShop ?? undefined);
            pendingExpiry = null;
            pendingShop = null;
        } catch (err) {
            console.error("Could not store the licence's expiry date:", err);
        }
    }
    // Ask the server for the expiry day (the settings are complete). A day it sends is saved locally; if it refuses the key, an old day is saved and the app
    // closes (the handler above); with no network or no answer nothing changes and the day saved locally decides, just below.
    const online = await checkExpiryWithServer();
    console.info(`[startup] server check: ${online}`);
    if (online === "refused") return;
    // Is the licence still valid? The expiry day saved on this computer (the last valid day) must not be before today (UTC, like the server's).
    // Nothing saved (a copy that registered before expiry dates existed) is not blocked. A copy that is past its day gets the expired page and nothing else:
    // no sync, no IPC, no app window.
    try {
        const { localLicenseService } = require("./local") as typeof import("./local/index");
        const expiry = await localLicenseService.getExpiry();
        const today = new Date().toISOString().slice(0, 10);
        console.info(`[license] day saved locally: ${expiry ?? "none"}, today (UTC): ${today} -> ${expiry === null ? "not blocked (no day saved)" : expiry < today ? "expired" : "valid"}`);
        if (expiry !== null && expiry < new Date().toISOString().slice(0, 10)) {
            console.warn(`[license] expired on ${expiry}: the app does not start.`);
            createExpiredWindow(false);
            return;
        }
    } catch (err) {
        console.error("Could not read the licence's expiry date:", err);
    }
    // The categories are fixed in the code: at every start the table is made to hold them (the frames refer to it).
    try {
        await seedCategories();
    } catch (err) {
        console.error("Could not store the categories:", err);
    }
    // Products made before codes existed get one (and are marked to be sent, so the server learns it).
    try {
      const coded = await ensureProductCodes();
      if (coded > 0) console.info(`Gave a code to ${coded} product(s) that had none.`);
    } catch (err) {
      console.error("Could not give codes to the products that have none:", err);
    }
    // Photo files that no photo row points at (left by a crash between writing a file and saving its row) are removed.
    await sweepOrphanPhotoFiles();
    // Push everything that is waiting, parents first: one pass right now, then one every 10 minutes
    // for as long as the app runs. The window doesn't wait for the first pass.
    startSyncScheduler();
    app.on("before-quit", () => {
        stopSyncScheduler();
    });
    // Is there any local row not marked synced? Sets syncState.synced to false if so.
    try {
        await checkUnsynced();
    } catch (err) {
        console.error("Could not check for unsynced rows:", err);
    }
    setLabelPrinter(electronLabelPrinter); // labels are printed with Electron's printing
    setDocumentPrinter(electronDocumentPrinter); // and so are the invoice and the lab sheet
    registerIpcHandlers(isTrustedSender);
    console.info("[startup] ready: opening the main window");
    createWindow();
}

app.whenReady().then(() => {
    // The Edit menu is what makes Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z work in every window (the menu bar itself stays hidden).
    Menu.setApplicationMenu(Menu.buildFromTemplate(editMenuTemplate()));
    return start();
});
