import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, configProblem, deleteExpiredSettings, getConfig, readExpiredSettings, restoreExpiredSettings, saveSettings } from "./config";
import { installResilientLookup } from "./lib/resilientDns";
import { electronLabelPrinter } from "./labelPrinter";
import { electronDocumentPrinter, electronExternalOpener, electronPdfMaker, electronPdfSaver } from "./documentPrinter";
import { activate } from "./setup";
import { readSavedShop } from "./savedShop";
import { contextMenuTemplate, editMenuTemplate } from "./editMenu";

// Reaching the server: some of the addresses its name resolves to do not answer on some connections, so the addresses are completed (1.1.1.1) and a connection that
// is not made goes on to the next one (see lib/resilientDns.ts).
installResilientLookup();

// The database, the sync and the IPC handlers are loaded only once the settings are known to be complete (see start below): until then
// nothing of the app runs, not even the local database is opened.

const rendererPage = path.join(__dirname, "../renderer/index.html");
const setupPage = path.join(__dirname, "../renderer/setup.html");
const expiredPage = path.join(__dirname, "../renderer/expired.html");
const windowIcon = path.join(__dirname, "../build/icon.png");

/** The shop's details the server accepted when the shop registered, kept until the local database is open (the database is not opened before the settings are complete). */
let pendingShop: { name: string; phone?: string; email?: string; address?: string; instagramUrl?: string; tiktokUrl?: string } | null = null;

/**
 * The key and the server address kept in the renamed settings file, when the setup page is shown because the app was stopped: the page fills them in. `reason` is what the last
 * check of that key found: the server refused it, or could not be reached.
 */
let setupPrefill: { tenantKey: string; serverUrl: string; reason: "refused" | "unreachable" } | null = null;

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
 * The window shown instead of the app when the server no longer accepts the shop's key (unknown, or its licence ended): it says the licence has expired and offers
 * nothing else; the app ends when it is closed. The settings file has already been removed. It has no preload and no access to anything; the sync, the IPC handlers
 * and the app's own window are never started behind it.
 */
function createExpiredWindow(): void {
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
    enableClipboardMenu(win);
    win.loadFile(expiredPage);
    win.on("closed", () => app.quit()); // (the app ends with this window)
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
    setupWindow = null;
}

/**
 * What the setup page needs to know before it shows its form: whether this computer already has the shop's details (the settings file is gone but the local
 * database is still there). Then the page asks only for the tenant key and the server address.
 */
ipcMain.handle("setup:context", (event) => {
    if (!isTrustedSetupSender(event)) return { savedShop: false, prefill: null };
    return { savedShop: readSavedShop() !== null, prefill: setupPrefill };
});

ipcMain.handle("setup:confirm", async (event, details: unknown) => {
    if (!isTrustedSetupSender(event)) return { kind: "invalid", message: "Not allowed." };
    let input = details;
    // The short form (only the key and the server address were asked for): the shop's details are the ones the local database already holds. The key is
    // not compared with anything here: the server decides, and a wrong key is refused like any other (the form stays as it is, with the server's words).
    if (details !== null && typeof details === "object" && (details as { useSaved?: unknown }).useSaved === true) {
        const { tenantKey, serverUrl } = details as { tenantKey?: unknown; serverUrl?: unknown };
        const saved = readSavedShop();
        // (the details were there when the page opened; if they are gone now, the page is told to ask for them after all)
        if (saved === null) return { kind: "need-details", message: "This computer has no saved details of the shop. Enter the shop's details." };
        input = { ...saved.shop, tenantKey, serverUrl };
    }
    const outcome = await activate(input);
    if (outcome.kind === "activated") {
        try {
            saveSettings({ tenantKey: outcome.tenantKey, serverUrl: outcome.serverUrl });
        } catch (err) {
            return { kind: "invalid", message: err instanceof ConfigError ? err.message : "The settings file could not be written." };
        }
        // A new settings file is written: the renamed old one (from a refused key) is no longer needed.
        deleteExpiredSettings();
        setupPrefill = null;
        // The settings are complete now: start the app (its window replaces the setup window); it stores the shop's details once the database is open.
        pendingShop = outcome.shop; // the details the server accepted: kept in the local shop table
        setTimeout(() => void start(), 600);
        return { kind: "activated" };
    }
    return outcome;
});

async function start(): Promise<void> {
    // First: the settings file (<app data>/OptiPro/config.properties) must exist and hold a tenant.key and a server.url. A new installation has no
    // such file: the app does NOT start, the setup page opens instead (nothing is built into the app, no file is made for the person).
    let problem = configProblem();
    if (problem !== null) {
        // Was the app stopped because the server refused the key? Then the key and the address are in config.properties.expired. The server is asked about that key:
        // if it accepts it the file gets its name back and the app starts; if it refuses it, or cannot be reached (no internet), the setup page opens with the key and the
        // address filled in. (A settings file with its normal name that cannot be checked just lets the app start; this renamed one never does.)
        const expired = readExpiredSettings();
        if (expired !== null) {
            const { checkKeyWithServer } = require("./local/licenseCheck") as typeof import("./local/licenseCheck");
            const answer = await checkKeyWithServer(expired.serverUrl, expired.tenantKey);
            console.info(`[config] the renamed settings file holds a key: the server says ${answer}`);
            if (answer === "valid" && restoreExpiredSettings()) problem = configProblem();
            else setupPrefill = { ...expired, reason: answer === "refused" ? "refused" : "unreachable" };
        }
    }
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
    const { ensureProductCodes, seedCategories, setLabelPrinter, setDocumentPrinter, setPdfMaker, setPdfSaver, setExternalOpener, checkUnsynced, startSyncScheduler, stopSyncScheduler, sweepOrphanPhotoFiles, setUnauthorizedHandler, checkExpiryWithServer } = require("./local") as typeof import("./local/index");
    // When the server turns the shop away (unknown key, licence ended) the settings file has been removed (licenseGuard.ts): the sync stops and the app's windows
    // are replaced by the page that says the licence has expired; the app ends when it is closed, and the next start opens the setup page.
    setUnauthorizedHandler(() => {
        console.warn("[license] the server refused the tenant key: the settings file is removed and the app stops.");
        stopSyncScheduler();
        const open = BrowserWindow.getAllWindows();
        createExpiredWindow();
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
    // A shop that has just registered: the details it registered with (the server accepted them) go into the local database. Any shop: the row that holds them exists.
    try {
        const { localLicenseService } = require("./local") as typeof import("./local/index");
        if (pendingShop !== null) {
            await localLicenseService.saveShop(pendingShop);
            pendingShop = null;
        } else {
            await localLicenseService.ensureRow();
        }
    } catch (err) {
        console.error("Could not store the shop's details:", err);
    }
    // The FIRST request of the run asks the server whether it still accepts the key (the settings are complete). If it refuses (unknown key, licence ended) the settings
    // file is removed and the app stops (the handler above); with no network or no answer the app starts as usual: nothing about the licence is kept on this computer.
    const online = await checkExpiryWithServer();
    console.info(`[startup] server check: ${online}`);
    if (online === "refused") return;
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
    setExternalOpener(electronExternalOpener); // messages to suppliers open in the browser
    setPdfSaver(electronPdfSaver); // and the person can keep that PDF on this computer
    setPdfMaker(electronPdfMaker); // the lab sheets of several orders go into one PDF file
    registerIpcHandlers(isTrustedSender);
    console.info("[startup] ready: opening the main window");
    createWindow();
}

app.whenReady().then(() => {
    // The Edit menu is what makes Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z work in every window (the menu bar itself stays hidden).
    Menu.setApplicationMenu(Menu.buildFromTemplate(editMenuTemplate()));
    return start();
});
