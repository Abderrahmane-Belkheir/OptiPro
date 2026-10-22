import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow } from "electron";
import type { DocumentPrinter } from "./local/documentService";

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
