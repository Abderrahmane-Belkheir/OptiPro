import type { FieldErrors } from "./frameValidation";

/**
 * The rules the shop's information has to follow before it is saved and sent (the same as the server's, see backend/src/lib/infosCore.js, so what is
 * accepted here is accepted there). What is wrong is returned per field, nothing is thrown. A field that is empty or not given is NOT a value: it means
 * "leave it as it is" (the settings form shows the current value as a placeholder, and only what is typed changes).
 *
 *   name          1 to 120 characters
 *   phone         digits, spaces and + ( ) . -   (3 to 40 characters)
 *   email         an e-mail address, at most 254 characters
 *   address       at most 300 characters
 *   instagramUrl  a web address (http or https), at most 300 characters
 *   tiktokUrl     the same
 */

export const SHOP_INFO_FIELDS = ["name", "phone", "email", "address", "instagramUrl", "tiktokUrl"] as const;
export type ShopInfoField = (typeof SHOP_INFO_FIELDS)[number];
export type ShopInfoForm = Partial<Record<ShopInfoField, unknown>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]{3,40}$/;

const webAddress = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const RULES: Record<ShopInfoField, { label: string; max: number; check?: (value: string) => string | null }> = {
  name: { label: "The name", max: 120 },
  phone: { label: "The phone number", max: 40, check: (v) => (PHONE.test(v) ? null : "The phone number can have digits, spaces and + ( ) . - only.") },
  email: { label: "The email", max: 254, check: (v) => (EMAIL.test(v) ? null : "The email must look like name@example.com.") },
  address: { label: "The address", max: 300 },
  instagramUrl: { label: "The Instagram address", max: 300, check: (v) => (webAddress(v) ? null : "The Instagram address must start with http:// or https://.") },
  tiktokUrl: { label: "The TikTok address", max: 300, check: (v) => (webAddress(v) ? null : "The TikTok address must start with http:// or https://.") },
};

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** The fields that have a value (tidied: trimmed, runs of spaces made one), or the mistakes by field. */
export function validateShopInfoForm(form: ShopInfoForm): { values: Partial<Record<ShopInfoField, string>>; errors?: undefined } | { values?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const values: Partial<Record<ShopInfoField, string>> = {};
  const f = (form ?? {}) as ShopInfoForm;
  for (const field of SHOP_INFO_FIELDS) {
    const raw = f[field];
    if (blank(raw)) continue;
    const rule = RULES[field];
    if (typeof raw !== "string") {
      errors[field] = `${rule.label} must be text.`;
      continue;
    }
    const value = raw.trim().replace(/\s+/g, " ");
    if (value.length > rule.max) {
      errors[field] = `${rule.label} is too long: at most ${rule.max} characters.`;
      continue;
    }
    const problem = rule.check?.(value) ?? null;
    if (problem) {
      errors[field] = problem;
      continue;
    }
    values[field] = value;
  }
  return Object.keys(errors).length > 0 ? { errors } : { values };
}
