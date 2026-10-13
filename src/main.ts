import { app, BrowserWindow } from "electron";
import path from "node:path";

function createWindow(): void {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "preload.js")
        }
    });

    win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(createWindow);
