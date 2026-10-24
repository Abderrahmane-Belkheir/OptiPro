import { LocalDbError } from "./errors";
import { isMadePdf, madePdfInfo, makeSheetPdf } from "./documentService";

/**
 * Opening a message to a supplier in the person's browser: an EMAIL (Gmail's compose page, with the address, the subject and the text filled in) or a WHATSAPP chat
 * (wa.me, with the text filled in). Nothing is sent: the person reads it and presses Send there.
 *
 * A FILE CANNOT BE ATTACHED THROUGH A LINK (not by Gmail's, not by WhatsApp's, not by mailto:). So the lab sheet of EACH order of the PDF is saved in the person's
 * "optician" folder (in their user folder), as a file of its own named by the order number (CMD-2026-0001.pdf), and the answer says where, to be attached from there. A sheet
 * that is already in the folder is NOT made or copied again. The file explorer is not opened. Only a PDF this app made can be used (the window can not name any other file).
 *
 * The browser and the file explorer are plugged in by the app at start (Electron's shell), like the printer, so this file can be tested without them.
 */

export interface ExternalOpener {
  /** Opens a web address in the person's browser. Only https addresses made here are given. */
  openUrl(url: string): Promise<void>;
  /** The path a file of this name has in the person's "optician" folder (the folder is made when needed), and whether a file of that name is already there. */
  place(name: string): Promise<{ path: string; exists: boolean }>;
  /** Moves a file into the optician folder under this name and answers its path. */
  moveIn(file: string, name: string): Promise<string>;
}

let opener: ExternalOpener | null = null;
export function setExternalOpener(value: ExternalOpener | null): void {
  opener = value;
}

/** The country code put in front of a national phone number (0555 11 22 33 -> 213 555 11 22 33). The shops are in Algeria. */
export const DEFAULT_COUNTRY_CODE = "213";
const MAX_TEXT = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The subject of a message about lens orders, in the language of the app (the supplier is written to in it). */
const LENS_ORDERS: Record<string, string> = { en: "Lens orders", fr: "Commandes de verres", ar: "طلبات العدسات" };

/** What became of the lab sheet of one order. */
export interface SheetResult {
  number: string;
  /** Where its file is in the optician folder; null when it could not be saved. */
  path: string | null;
  /** True when the file was made and put there now; false when it was already there (not made again) or could not be saved. */
  saved: boolean;
}

export interface OpenResult {
  /** The address that was opened in the browser. */
  url: string;
  /** The lab sheet of each order of the PDF, in the optician folder. */
  sheets: SheetResult[];
}

/** A file name made of an order number: letters, digits, dot, dash and underscore. */
const sheetName = (number: string) => `${number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

/**
 * A phone number as WhatsApp wants it: the country code and the number, digits only, no + and no leading 0s ("0555 11 22 33" -> "213555112233",
 * "+213 555 11 22 33" and "00213555112233" -> "213555112233"). null when it can not be one.
 */
export function whatsappNumber(phone: string): string | null {
  const text = String(phone ?? "").trim();
  if (!/^[0-9+\-\s().\/]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("+")) digits = digits.replace(/^0+/, "");
  else if (digits.startsWith("00")) digits = digits.slice(2).replace(/^0+/, "");
  else if (digits.startsWith("0")) digits = DEFAULT_COUNTRY_CODE + digits.slice(1); // a national number
  else if (digits.length <= 9) digits = DEFAULT_COUNTRY_CODE + digits; // a national number typed without its 0
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

function cleanText(value: unknown, what: string, required = false): string {
  if (value === undefined || value === null || value === "") {
    if (required) throw new LocalDbError(`${what} is required.`, "invalid-input");
    return "";
  }
  if (typeof value !== "string") throw new LocalDbError(`${what} must be text.`, "invalid-input");
  if (value.length > MAX_TEXT) throw new LocalDbError(`${what} is too long (at most ${MAX_TEXT} characters).`, "invalid-input");
  return value;
}

function checkedFile(file: unknown): string {
  if (typeof file !== "string" || !isMadePdf(file)) throw new LocalDbError("Contact: that is not a PDF this app made.", "invalid-input");
  return file;
}

function theOpener(): ExternalOpener {
  if (opener === null) throw new LocalDbError("Contact: opening the browser is not available in this run of the app.", "invalid-input");
  return opener;
}

async function open(url: string, file: string): Promise<OpenResult> {
  const o = theOpener();
  // the sheets first (so they are there when the message opens), then the message; a sheet that fails does not stop the message
  const info = madePdfInfo(file)!;
  const sheets: SheetResult[] = [];
  for (const [index, number] of info.numbers.entries()) {
    try {
      const target = await o.place(sheetName(number));
      if (target.exists) {
        sheets.push({ number, path: target.path, saved: false }); // already there: not made or copied again
        continue;
      }
      const made = await makeSheetPdf(info.orderIds[index], info.lang);
      sheets.push({ number, path: await o.moveIn(made, sheetName(number)), saved: true });
    } catch {
      sheets.push({ number, path: null, saved: false });
    }
  }
  await o.openUrl(url);
  return { url, sheets };
}

export const localContactService = {
  /**
   * Opens Gmail's compose page in the browser: to the address, with the subject and the text. { to, subject?, lang?, numbers?, message?, file } where file is the PDF the
   * app made. Without a subject, one is made from the order numbers ("Lens orders: CMD-2026-0001, CMD-2026-0002") in the language given.
   */
  async openEmail(args: { to?: unknown; subject?: unknown; lang?: unknown; numbers?: unknown; message?: unknown; file?: unknown }): Promise<OpenResult> {
    const to = cleanText(args?.to, "The address", true).trim();
    if (!EMAIL.test(to)) throw new LocalDbError(`"${to}" is not an email address.`, "invalid-input");
    let subject = cleanText(args?.subject, "The subject").replace(/[\r\n]+/g, " ").trim();
    if (subject === "" && Array.isArray(args?.numbers)) {
      const numbers = (args.numbers as unknown[]).filter((n): n is string => typeof n === "string").slice(0, 50).join(", ");
      subject = `${LENS_ORDERS[typeof args.lang === "string" ? args.lang : "en"] ?? LENS_ORDERS.en}: ${numbers}`.slice(0, 300);
    }
    const message = cleanText(args?.message, "The message");
    const file = checkedFile(args?.file);
    const url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    return open(url, file);
  },

  /** Opens a WhatsApp chat in the browser: with the number, and the text filled in. { phone, message?, file } */
  async openWhatsApp(args: { phone?: unknown; message?: unknown; file?: unknown }): Promise<OpenResult> {
    const phone = cleanText(args?.phone, "The phone number", true);
    const number = whatsappNumber(phone);
    if (!number) throw new LocalDbError(`"${phone}" can't be used for WhatsApp: write it with its country code, like +213 555 11 22 33.`, "invalid-input");
    const message = cleanText(args?.message, "The message");
    const file = checkedFile(args?.file);
    const url = `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
    return open(url, file);
  },
};
