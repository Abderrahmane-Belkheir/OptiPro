import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, getApiConfig } from "./config";
import { onInvalidTenantKey } from "./services";
import { checkUnsynced, startSyncScheduler, stopSyncScheduler } from "./local";
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
    // The app can't do anything useful without the server URL and tenant key, so a missing or
    // incomplete config.properties stops it here instead of opening a window that fails later.
    try {
        getApiConfig();
    } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        dialog.showErrorBox("OptiPro can't start", err.message);
        app.exit(1);
        return;
    }
    // The backend rejected our tenant key (404 INVALID_TENANT_KEY): nothing works without a valid
    // one, so shut down. Being offline is expected and does not trigger this.
    let shuttingDown = false;
    onInvalidTenantKey(() => {
        if (shuttingDown) return;
        shuttingDown = true;
        dialog.showErrorBox("OptiPro can't continue", "The server does not recognise the tenant key in config.properties. The app will close.");
        app.exit(1);
    });
    // Push everything that is waiting, parents first: one pass right now, then one every 10 minutes
    // for as long as the app runs. The window doesn't wait for the first pass.
    startSyncScheduler();
    app.on("before-quit", stopSyncScheduler);
    // Is there any local row the backend doesn't have yet? Sets syncState.synced to false if so.
    try {
        await checkUnsynced();
    } catch (err) {
        console.error("Could not check for unsynced rows:", err);
    }
    registerIpcHandlers(isTrustedSender);
    createWindow();
});
