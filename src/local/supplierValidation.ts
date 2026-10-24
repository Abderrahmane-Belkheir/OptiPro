import type { FieldErrors } from "./frameValidation";

/**
 * The rules a supplier has to follow before it is saved. The values come from a form (text, or a list of kinds). What is wrong is returned per
 * field, nothing is thrown. Only the name is required: a shop may know a supplier by a phone number and nothing else.
 *
 *   name          required, up to 120 characters (runs of spaces become one)
 *   kinds         what they supply: any of lenses, frames, accessories, other (a list, or a comma-separated text); may be empty. A lab is a supplier of
 *                 lenses, so there is no separate "lab" kind; the word "lab" is still understood (it was one) and means lenses
 *   contactName   up to 120 characters
 *   phone         6 to 30 characters: digits, spaces and + - ( ) . /   with at least 6 digits
 *   email         a plain address (name@domain.tld), up to 254 characters
 *   address       up to 300 characters
 *   notes         up to 2000 characters
 */

type Value = string | number | boolean | string[] | null | undefined;

export const SUPPLIER_KINDS = ["lenses", "frames", "accessories", "other"] as const;
/** Kinds that were renamed: what an older record or an older caller says -> what it means now. */
const RENAMED: Record<string, string> = { lab: "lenses" };
export type SupplierKind = (typeof SUPPLIER_KINDS)[number];

export const SUPPLIER_NAME_MAX = 120;
export const SUPPLIER_ADDRESS_MAX = 300;
export const SUPPLIER_NOTES_MAX = 2000;

export interface SupplierForm {
  name?: Value;
  kinds?: Value;
  contactName?: Value;
  phone?: Value;
  email?: Value;
  address?: Value;
  notes?: Value;
  isActive?: Value;
}

export interface CleanSupplier {
  name: string;
  /** In the order of SUPPLIER_KINDS, comma-separated, no repeats ("" when none). */
  kinds: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_CHARS = /^[0-9+\-\s().\/]+$/;

/** The kinds in a stored text: "lenses,frames" -> ["lenses", "frames"] (what is not a known kind is left out; an old "lab" counts as lenses). */
export function kindsOf(text: string | null | undefined): SupplierKind[] {
  const wanted = new Set(String(text ?? "").split(",").map((k) => k.trim()).map((k) => RENAMED[k] ?? k));
  return SUPPLIER_KINDS.filter((k) => wanted.has(k));
}

export function validateSupplierForm(form: SupplierForm): { supplier: CleanSupplier; errors?: undefined } | { supplier?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const f = (form ?? {}) as SupplierForm;

  /** A single-line text: trimmed, runs of spaces made one; null when empty. */
  const line = (key: keyof SupplierForm, label: string, max: number): string | null => {
    const v = f[key];
    if (blank(v)) return null;
    if (typeof v !== "string") {
      errors[key] = `${label} must be text.`;
      return null;
    }
    const text = v.trim().replace(/\s+/g, " ");
    if (text.length > max) {
      errors[key] = `${label} is too long: at most ${max} characters.`;
      return null;
    }
    return text;
  };

  const name = line("name", "The name", SUPPLIER_NAME_MAX);
  if (name === null && !errors.name) errors.name = "Give the supplier's name.";
  const contactName = line("contactName", "The contact name", SUPPLIER_NAME_MAX);
  const address = line("address", "The address", SUPPLIER_ADDRESS_MAX);

  let phone = line("phone", "The phone number", 30);
  if (phone !== null && !errors.phone) {
    if (!PHONE_CHARS.test(phone) || phone.replace(/\D/g, "").length < 6) {
      errors.phone = "The phone number can have digits, spaces and + - ( ) . / only, and at least 6 digits.";
      phone = null;
    }
  }

  let email = line("email", "The email", 254);
  if (email !== null && !errors.email && !EMAIL.test(email)) {
    errors.email = "The email must look like name@example.com.";
    email = null;
  }

  let notes: string | null = null;
  if (!blank(f.notes)) {
    if (typeof f.notes !== "string") errors.notes = "The notes must be text.";
    else if (f.notes.trim().length > SUPPLIER_NOTES_MAX) errors.notes = `The notes are too long: at most ${SUPPLIER_NOTES_MAX} characters.`;
    else notes = f.notes.trim();
  }

  let kinds = "";
  if (!blank(f.kinds)) {
    const given = Array.isArray(f.kinds) ? f.kinds : typeof f.kinds === "string" ? f.kinds.split(",") : null;
    if (given === null) errors.kinds = "Choose what the supplier supplies from the list.";
    else {
      const names = given.map((k) => (typeof k === "string" ? k.trim().toLowerCase() : "")).filter((k) => k !== "").map((k) => RENAMED[k] ?? k);
      const unknown = names.find((k) => !(SUPPLIER_KINDS as readonly string[]).includes(k));
      if (unknown !== undefined) errors.kinds = `“${unknown}” is not something a supplier can supply: choose from ${SUPPLIER_KINDS.join(", ")}.`;
      else kinds = SUPPLIER_KINDS.filter((k) => names.includes(k)).join(",");
    }
  }

  let isActive = true;
  if (f.isActive !== undefined && f.isActive !== null) {
    if (typeof f.isActive !== "boolean") errors.isActive = "Active must be yes or no.";
    else isActive = f.isActive;
  }

  if (Object.keys(errors).length > 0) return { errors };
  return { supplier: { name: name!, kinds, contactName, phone, email, address, notes, isActive } };
}
