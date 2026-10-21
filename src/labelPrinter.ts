import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow } from "electron";
import type { LabelPrinter, LabelSettings } from "./local/labelService";

/**
 * What is asked of the printer (Electron's print options): the paper is the label itself, with no margins; a printer named in the settings is
 * used without asking, otherwise the system's print dialog opens. Sizes go to Electron in microns.
 */
export function printOptions(settings: Pick<LabelSettings, "widthMm" | "heightMm" | "printer">) {
  return {
    silent: settings.printer !== null,
    deviceName: settings.printer ?? undefined,
    printBackground: true,
    margins: { marginType: "none" as const },
    pageSize: { width: Math.round(settings.widthMm * 1000), height: Math.round(settings.heightMm * 1000) },
  };
}

/**
 * Prints the label page (one label per page, the page the label's size) with Electron. The page is loaded in a hidden window and printed with the
 * label's size as the paper size, no margins:
 *   - with a printer named in the settings (label.printer) it prints straight to it, without asking;
 *   - otherwise the system's print dialog opens and the person chooses (and can set the paper there).
 * For tests (and to look at a label without a printer), OPTIPRO_LABEL_PDF_DIR makes it write a PDF into that folder instead of printing.
 */
export const electronLabelPrinter: LabelPrinter = async (html, settings, job) => {
  // The page goes through a temporary file (a data: address has a size limit and 200 labels is a big page).
  const page = path.join(os.tmpdir(), `optipro-labels-${randomUUID()}.html`);
  await fs.writeFile(page, html, "utf8");
  const win = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { sandbox: true, javascript: false } });
  try {
    await win.loadURL(pathToFileURL(page).href);

    const pdfDir = process.env.OPTIPRO_LABEL_PDF_DIR?.trim();
    if (pdfDir) {
      const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
      await fs.mkdir(pdfDir, { recursive: true });
      const file = path.join(pdfDir, `labels-${job.code}-${job.copies}.pdf`);
      await fs.writeFile(file, pdf);
      return { status: "saved", labels: job.copies, file };
    }

    return await new Promise((resolve, reject) => {
      win.webContents.print(
        printOptions(settings),
        (success, reason) => {
          if (success) resolve({ status: "sent", labels: job.copies });
          else if (/cancel/i.test(reason)) resolve({ status: "cancelled", labels: 0 });
          else reject(new Error(reason ? `The printer did not take the labels: ${reason}` : "The printer did not take the labels."));
        },
      );
    });
  } finally {
    win.destroy();
    await fs.rm(page, { force: true });
  }
};
