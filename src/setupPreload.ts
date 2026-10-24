import { contextBridge, ipcRenderer } from "electron";

// The setup page's only link to the app: window.setupAPI.confirm(details) sends the form to the main process, which asks the server to register the
// shop and answers { kind: "activated" | "invalid" | "need-details" | "close", message?, field? } (see ./setup, and main.ts for "need-details").
contextBridge.exposeInMainWorld("setupAPI", {
  /** { savedShop: true } when this computer's database already holds the shop's details: the page then asks only for the key and the server address. */
  context: (): Promise<unknown> => ipcRenderer.invoke("setup:context"),
  confirm: (details: unknown): Promise<unknown> => ipcRenderer.invoke("setup:confirm", details),
});
