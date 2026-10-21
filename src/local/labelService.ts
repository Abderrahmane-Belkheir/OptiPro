import QRCode from "qrcode";
import { ConfigError, getConfig, requireServerUrl } from "../config";
import { LocalDbError } from "./errors";
import { normalizeCode, type ProductKind } from "./productCodes";

/**
 * What goes on a product's label: a QR code and, below it, the product's code. The QR code carries the product's page on the shop's website,
 * <server.url>/frames/<code> or <server.url>/accessories/<code> (the website opens a product by its code), so scanning it with a phone opens the
 * product. Made here (the settings file with server.url and the QR library are on this side) and sent to the window as an SVG, which stays
 * sharp at any size and prints well. Black on white whatever the app's theme.
 *
 * Printing: the labels are laid out as ONE PAGE PER LABEL, the page being exactly the label's size (the roll's label), and sent to a printer
 * (src/labelPrinter.ts, which needs Electron; it is plugged in at start so this file stays testable without it).
 *
 * Settings (config.properties, all optional):
 *   label.width=40        the label's width in mm   (10 to 200, default 40)
 *   label.height=25       the label's height in mm  (10 to 200, default 25)
 *   label.printer=        the printer's name; when it is empty the system's print dialog opens and the person chooses
 */

const PATH: Record<ProductKind, string> = { frame: "frames", accessory: "accessories" };

export const DEFAULT_LABEL_WIDTH_MM = 40;
export const DEFAULT_LABEL_HEIGHT_MM = 25;
export const MIN_LABEL_MM = 10;
export const MAX_LABEL_MM = 200;
export const MAX_COPIES = 200;
/** Without knowing the address, a QR code smaller than this (mm) may not scan reliably. */
export const MIN_QR_MM = 12;
/**
 * A label printer's dots are 0.125 mm apart (203 dpi). A QR code scans reliably when each of its squares is at least this many dots wide: tested by
 * drawing labels at 203 dpi with dot gain (every black dot bleeding into its neighbours) and decoding them (tests/labels.render.electron.cjs).
 */
export const MIN_DOTS_PER_MODULE = 4;
const PRINTER_DPI = 203;

export interface ProductQr {
  /** What the QR code says: the product's address on the website. */
  url: string;
  /** The QR code as an SVG document (a string). */
  svg: string;
}

export interface LabelSettings {
  widthMm: number;
  heightMm: number;
  /** The printer to print to without asking, or null: the system's print dialog opens and the person chooses. */
  printer: string | null;
  /** How big the QR code comes out on this label size, and the code's text size. */
  qrMm: number;
  fontPt: number;
  /** The QR code's squares across (margin included) for the longest address this shop's products have, or null when server.url is not set. */
  qrModules: number | null;
  /** How many printer dots wide each square of the QR code is on a 203 dpi printer, or null when server.url is not set. */
  dotsPerModule: number | null;
  /** True when the QR code may not scan on this label size (too few dots per square; or, without an address to measure, too small). */
  scanRisk: boolean;
}

/** The squares across a QR code of this text (with the 1-square margin the labels use). */
export function qrModuleCount(text: string): number {
  return QRCode.create(text, { errorCorrectionLevel: "M" }).modules.size + 2;
}

/** The sizes inside a label: the QR code (a square) with the code's text below it, with a 1 mm margin all round. */
export function labelGeometry(widthMm: number, heightMm: number): { qrMm: number; fontPt: number } {
  const inner = widthMm - 2;
  const fontPt = Math.max(5, Math.min(10, 0.55 * inner));
  const textMm = fontPt * 0.3528;
  const qrMm = Math.max(0, Math.min(inner, heightMm - 2 - textMm - 0.6));
  return { qrMm: Math.round(qrMm * 10) / 10, fontPt: Math.round(fontPt * 10) / 10 };
}

function sizeFrom(text: string | null, fallback: number, name: string): number {
  if (text === null || text === "") return fallback;
  const n = Number(text.replace(",", "."));
  if (!Number.isFinite(n) || n < MIN_LABEL_MM || n > MAX_LABEL_MM) {
    throw new ConfigError(`${name}="${text}" in the settings file is not a size in millimetres (${MIN_LABEL_MM} to ${MAX_LABEL_MM}).\n  ${name}=${fallback}`);
  }
  return n;
}

/** The label settings from the settings file (defaults for what is missing); a ConfigError for a size that is not a number of millimetres. */
export function labelSettings(): LabelSettings {
  const config = getConfig();
  const widthMm = sizeFrom(config.labelWidth, DEFAULT_LABEL_WIDTH_MM, "label.width");
  const heightMm = sizeFrom(config.labelHeight, DEFAULT_LABEL_HEIGHT_MM, "label.height");
  const geometry = labelGeometry(widthMm, heightMm);
  let qrModules: number | null = null;
  try {
    const base = requireServerUrl().replace(/\/+$/, "");
    qrModules = Math.max(qrModuleCount(`${base}/frames/abc-123`), qrModuleCount(`${base}/accessories/abc-123`));
  } catch {
    qrModules = null; // no server.url: the address cannot be measured (the QR code cannot be made either)
  }
  const dotsPerModule = qrModules === null ? null : Math.round(((geometry.qrMm / 25.4) * PRINTER_DPI / qrModules) * 10) / 10;
  const scanRisk = dotsPerModule === null ? geometry.qrMm < MIN_QR_MM : dotsPerModule < MIN_DOTS_PER_MODULE;
  return { widthMm, heightMm, printer: config.labelPrinter || null, ...geometry, qrModules, dotsPerModule, scanRisk };
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** The page to print: `copies` labels, one per page, each page the label's size. Pure: the same input gives the same page. */
export function labelsHtml(input: { svg: string; code: string; copies: number; widthMm: number; heightMm: number }): string {
  const { qrMm, fontPt } = labelGeometry(input.widthMm, input.heightMm);
  const label = `<div class="label"><div class="qr">${input.svg}</div><div class="code">${escapeHtml(input.code)}</div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels ${escapeHtml(input.code)}</title><style>
@page { size: ${input.widthMm}mm ${input.heightMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #000000; }
.label { box-sizing: border-box; width: ${input.widthMm}mm; height: ${input.heightMm}mm; padding: 1mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6mm; overflow: hidden; break-after: page; page-break-after: always; }
.label:last-child { break-after: auto; page-break-after: auto; }
.qr { width: ${qrMm}mm; height: ${qrMm}mm; }
.qr svg { display: block; width: 100%; height: 100%; }
.code { font-family: Consolas, "Courier New", monospace; font-weight: 700; font-size: ${fontPt}pt; letter-spacing: 0.08em; line-height: 1; white-space: nowrap; }
</style></head><body>${Array.from({ length: input.copies }, () => label).join("")}</body></html>`;
}

/** What a printer did with the labels. */
export interface PrintResult {
  /** "sent": handed to the printer. "cancelled": the person closed the print dialog. "saved": written to a PDF file instead (tests only). */
  status: "sent" | "cancelled" | "saved";
  /** How many labels (pages) were handed over. */
  labels: number;
  /** For "saved": the file written. */
  file?: string;
}

/** Sends a finished page to a printer. Plugged in by the app at start (Electron's printing); not part of this file so it can be tested without Electron. */
export type LabelPrinter = (html: string, settings: LabelSettings, job: { kind: ProductKind; code: string; copies: number }) => Promise<PrintResult>;

let printer: LabelPrinter | null = null;
export function setLabelPrinter(fn: LabelPrinter | null): void {
  printer = fn;
}

/** A well-formed scan: a product code, or the address a label's QR code carries (the scanner types it like a keyboard, then Enter). */
export interface ScannedCode {
  /** frame or accessory when the scan was an address that says which; null for a bare code. */
  kind: ProductKind | null;
  code: string;
}

export function parseScan(text: unknown): ScannedCode | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  const bare = normalizeCode(t);
  if (bare !== null) return { kind: null, code: bare };
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [section, last] = [parts[parts.length - 2], parts[parts.length - 1]];
  const code = normalizeCode(decodeURIComponent(last));
  if (code === null) return null;
  if (section === "frames") return { kind: "frame", code };
  if (section === "accessories") return { kind: "accessory", code };
  return null;
}

function checkKindAndCode(kind: unknown, code: unknown): { kind: ProductKind; code: string } {
  if (kind !== "frame" && kind !== "accessory") throw new LocalDbError(`qr: kind must be "frame" or "accessory".`, "invalid-input");
  const clean = normalizeCode(code);
  if (clean === null) throw new LocalDbError(`qr: "${String(code)}" is not a product code (3 letters, a dash, 3 digits).`, "invalid-input");
  return { kind, code: clean };
}

export const localLabelService = {
  /**
   * The QR code of a frame or an accessory, from its code. Throws a ConfigError when server.url is missing from the settings file (the address
   * cannot be made without it), and an invalid-input error when the code is not a product code.
   */
  async qr(kind: ProductKind, code: string): Promise<ProductQr> {
    const checked = checkKindAndCode(kind, code);
    const url = `${requireServerUrl().replace(/\/+$/, "")}/${PATH[checked.kind]}/${checked.code}`;
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
    return { url, svg };
  },

  /** The label size, the printer and how big the QR code comes out (from the settings file; see the top of this file). */
  async settings(): Promise<LabelSettings> {
    return labelSettings();
  },

  /**
   * Prints `copies` labels of a product: the QR code with its code below, one label per page, the page the label's size. The window only says
   * WHAT to print (kind, code, copies); the address, the QR code and the layout are made here. Answers what the printer did.
   */
  async print(job: { kind: ProductKind; code: string; copies: number }): Promise<PrintResult> {
    const { kind, code } = checkKindAndCode(job?.kind, job?.code);
    const copies = job?.copies;
    if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) throw new LocalDbError(`print: copies must be a whole number from 1 to ${MAX_COPIES}.`, "invalid-input");
    if (printer === null) throw new LocalDbError("print: no printer is available in this run of the app.", "invalid-input");
    const settings = labelSettings();
    const { svg } = await localLabelService.qr(kind, code);
    return printer(labelsHtml({ svg, code, copies, widthMm: settings.widthMm, heightMm: settings.heightMm }), settings, { kind, code, copies });
  },

  /** Reads what a scanner typed: a product code, or the address on a label's QR code. null when it is neither (then it is just text to search for). */
  async parseScan(text: string): Promise<ScannedCode | null> {
    return parseScan(text);
  },
};
