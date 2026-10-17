import { contextBridge, ipcRenderer } from "electron";
import type { IpcResult } from "./ipc/channels";

// Builds window.electronAPI: electronAPI.customers.list(), electronAPI.orders.insert({...}), …
// Each call goes to the main process, which owns the database and the backend connection.
//
// This file runs in Electron's sandbox, which can load nothing but `electron` — so it can't import
// the method list. It asks the main process for it once instead (the list lives in ./ipc/channels).
//
// A failed call rejects with an Error. Electron's context bridge keeps only an error's message (the
// name always arrives as plain "Error"), so a database error carries its kind at the start of the
// message, where a page can read it:  "[not-found] Update order: no order …",
// "[duplicate] …", "[invalid-reference] …"  — i.e. /^\[([\w-]+)\]/.exec(error.message)?.[1].

function call(api: string, method: string) {
  return async (...args: unknown[]): Promise<unknown> => {
    const result = (await ipcRenderer.invoke(`api:${api}:${method}`, ...args)) as IpcResult;
    if (result.ok) return result.value;
    const { message, kind } = result.error;
    throw new Error(kind ? `[${kind}] ${message}` : message);
  };
}

const methods = ipcRenderer.sendSync("api:describe") as Record<string, readonly string[]>;

const api = Object.fromEntries(
  Object.entries(methods).map(([name, list]) => [name, Object.fromEntries(list.map((method) => [method, call(name, method)]))]),
);

contextBridge.exposeInMainWorld("electronAPI", { platform: process.platform, ...api });
