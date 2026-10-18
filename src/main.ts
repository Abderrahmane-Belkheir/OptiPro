import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, getConfig } from "./config";
import { remoteDatabase, RemoteUnreachableError } from "./db";
import { checkUnsynced, startSyncScheduler, stopSyncScheduler } from "./local";
import { currentTenantKey } from "./local/context";
import { registerIpcHandlers } from "./ipc/handlers";

const rendererPage = path.join(__dirname, "../renderer/index.html");

/** Only the app's own page, in the top frame, may call the database (not an iframe, not a page it navigated to). */
function isTrustedSender(event: { sender: Electron.WebContents; senderFrame: Electron.WebFrameMain | null }): boolean {
    const frame = event.senderFrame;
    return Boolean(frame) && frame === event.sender.mainFrame && frame!.url.startsWith(pathToFileURL(rendererPage).href);
}

function createWindow(): void {

    const win = new BrowserWindow({
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
    // The database URL must be in config.properties and not empty; without it the app closes here
    // instead of opening a window that can't work.
    try {
        getConfig();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
    }
    // Which shop is this database? Learned from the database on the first run, remembered after, so
    // later starts work offline. Not knowing it is the one thing that stops the app.
    try {
        await currentTenantKey();
    } catch (err) {
        if (!(err instanceof ConfigError) && !(err instanceof RemoteUnreachableError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
    }
    // Push everything that is waiting, parents first: one pass right now, then one every 10 minutes
    // for as long as the app runs. The window doesn't wait for the first pass.
    startSyncScheduler();
    app.on("before-quit", () => {
        stopSyncScheduler();
        void remoteDatabase.close();
    });
    // Is there any local row not marked synced? Sets syncState.synced to false if so.
    try {
        await checkUnsynced();
    } catch (err) {
        console.error("Could not check for unsynced rows:", err);
    }
    registerIpcHandlers(isTrustedSender);
    createWindow();
});
