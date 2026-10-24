import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, shell } from "electron";
import type { DocumentPrinter, PdfMaker, PdfSaver } from "./local/documentService";
import type { ExternalOpener } from "./local/contactService";

/**
 * Prints an invoice or a lab sheet (an A4 page, see src/local/documents.ts) with Electron: the page is loaded in a hidden window and the system's
 * print dialog opens, where the person chooses a printer or "save as PDF". For tests (and to look at a document without a printer),
 * OPTIPRO_DOCUMENT_PDF_DIR makes it write a PDF into that folder instead of printing.
 */
export const electronDocumentPrinter: DocumentPrinter = async (html, job) => {
  const page = path.join(os.tmpdir(), `optipro-document-${randomUUID()}.html`);
  await fs.writeFile(page, html, "utf8");
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(pathToFileURL(page).href);

    const pdfDir = process.env.OPTIPRO_DOCUMENT_PDF_DIR?.trim();
    if (pdfDir) {
      const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
      await fs.mkdir(pdfDir, { recursive: true });
      const file = path.join(pdfDir, `${job.kind}-${job.number}.pdf`);
      await fs.writeFile(file, pdf);
      return { status: "saved", file };
    }

    return await new Promise((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true, pageSize: "A4" }, (success, reason) => {
        if (success) resolve({ status: "sent" });
        else if (/cancel/i.test(reason)) resolve({ status: "cancelled" });
        else reject(new Error(reason ? `The printer did not take the document: ${reason}` : "The printer did not take the document."));
      });
    });
  } finally {
    win.destroy();
    await fs.rm(page, { force: true });
  }
};

/**
 * Makes a PDF file of a finished page in the app's data folder (lab-pdfs), named after what it is and the time. OPTIPRO_DOCUMENT_PDF_DIR
 * (the tests) puts it in that folder instead.
 */
export const electronPdfMaker: PdfMaker = async (html, name) => {
  const page = path.join(os.tmpdir(), `optipro-document-${randomUUID()}.html`);
  await fs.writeFile(page, html, "utf8");
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(pathToFileURL(page).href);
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
    const dir = process.env.OPTIPRO_DOCUMENT_PDF_DIR?.trim() || path.join(app.getPath("userData"), "lab-pdfs");
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(dir, `${name}-${stamp}.pdf`);
    await fs.writeFile(file, pdf);
    return { file };
  } finally {
    win.destroy();
    await fs.rm(page, { force: true });
  }
};

/**
 * Saves a PDF the app made where the person chooses (the "save as" window, first offering their Downloads folder). OPTIPRO_PDF_SAVE_TO (the tests)
 * copies it into that folder without asking.
 */
export const electronPdfSaver: PdfSaver = async (file) => {
  const fixed = process.env.OPTIPRO_PDF_SAVE_TO?.trim();
  let target: string | undefined;
  if (fixed) {
    await fs.mkdir(fixed, { recursive: true });
    target = path.join(fixed, path.basename(file));
  } else {
    const chosen = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath("downloads"), path.basename(file)), filters: [{ name: "PDF", extensions: ["pdf"] }] });
    target = chosen.canceled ? undefined : chosen.filePath;
  }
  if (!target) return { status: "cancelled" };
  await fs.copyFile(file, target);
  return { status: "saved", file: target };
};

/** The folder where the PDFs sent to suppliers are kept: "optician" in the person's user folder. OPTIPRO_PDF_FOLDER (the tests) names another one. */
export function opticianFolder(): string {
  return process.env.OPTIPRO_PDF_FOLDER?.trim() || path.join(os.homedir(), "optician");
}

/**
 * Opens an address in the person's browser and keeps a copy of a file in the optician folder (the file explorer is not opened). OPTIPRO_EXTERNAL_LOG (the tests)
 * writes the addresses that would have been opened, one line each, to that file instead of opening anything.
 */
export const electronExternalOpener: ExternalOpener = {
  async openUrl(url) {
    const log = process.env.OPTIPRO_EXTERNAL_LOG?.trim();
    if (!/^https:\/\//.test(url)) throw new Error("Only https addresses are opened.");
    if (log) return fs.appendFile(log, JSON.stringify({ open: url }) + "\n");
    await shell.openExternal(url);
  },
  async place(name) {
    const folder = opticianFolder();
    await fs.mkdir(folder, { recursive: true });
    const target = path.join(folder, path.basename(name));
    return { path: target, exists: await fs.access(target).then(() => true, () => false) };
  },
  async moveIn(file, name) {
    const target = path.join(opticianFolder(), path.basename(name));
    await fs.copyFile(file, target);
    await fs.rm(file, { force: true }); // (the file was a temporary one made for this)
    const log = process.env.OPTIPRO_EXTERNAL_LOG?.trim();
    if (log) appendFileSync(log, JSON.stringify({ saved: target }) + "\n");
    return target;
  },
};
