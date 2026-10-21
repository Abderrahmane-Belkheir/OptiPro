import { app, BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, ensureConfigFile, getConfig } from "./config";
import { electronLabelPrinter } from "./labelPrinter";
import { ensureProductCodes, seedCategories, setLabelPrinter, checkUnsynced, startSyncScheduler, stopSyncScheduler, sweepOrphanPhotoFiles } from "./local";
import { currentTenantKey } from "./local/context";
import { registerIpcHandlers } from "./ipc/handlers";

const rendererPage = path.join(__dirname, "../renderer/index.html");
const windowIcon = path.join(__dirname, "../build/icon.png");

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

    win.loadFile(rendererPage);
}

app.whenReady().then(async () => {
    // First: is the settings file where it should be? If not, it is created from the settings built into the app
    // (resources/default-config.properties), so this start and every later one find it. Never fails and never needs the network.
    ensureConfigFile();
    // The settings file must be readable; without it the app closes here instead of opening a window that can't work.
    try {
        getConfig();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
    }
    // Which shop is this? The tenant.key of the settings file, remembered in the local database. Not knowing it is the one thing that stops the app.
    try {
        await currentTenantKey();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
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
    registerIpcHandlers(isTrustedSender);
    createWindow();
});
