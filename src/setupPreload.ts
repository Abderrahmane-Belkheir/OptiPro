import { contextBridge, ipcRenderer } from "electron";

// The setup page's only link to the app: window.setupAPI.confirm(details) sends the form to the main process, which asks the server to register the
// shop and answers { kind: "activated" | "invalid" | "close", message?, field? } (see ./setup).
contextBridge.exposeInMainWorld("setupAPI", {
  confirm: (details: unknown): Promise<unknown> => ipcRenderer.invoke("setup:confirm", details),
});
