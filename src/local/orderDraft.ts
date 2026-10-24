import type { FieldErrors } from "./frameValidation";

/** The pure half of placing an order: what the New order form sends, checked with no database (see orderPlacement.ts for the rest). */

type Value = string | number | null | undefined;

export interface OrderDraft {
  customerId?: Value;
  prescriptionId?: Value;
  frameId?: Value;
  accessoryId?: Value;
  /** A lens picked from the shop's lenses. */
  lensId?: Value;
  /** A lens described in words instead (up to LENS_DESCRIPTION_MAX characters). Not together with lensId. */
  lensDescription?: Value;
  /** The price of the lens pair, typed. Optional with lensId (the catalogue price is used), required with lensDescription. */
  lensPrice?: Value;
  /**
   * What the customer pays for the WHOLE order, typed. Optional: empty means the total of the items. It can only be lower (a discount): the difference is
   * saved as the order's discount, and the lines keep the prices they were sold at.
   */
  finalPrice?: Value;
  /** What the lens pair costs the shop, typed. Optional: empty means the cost saved with the lens in the catalogue, if it has one. */
  lensCost?: Value;
  /** Paid now, typed. Optional. */
  deposit?: Value;
  pdRight?: Value;
  pdLeft?: Value;
  fittingHeightRight?: Value;
  fittingHeightLeft?: Value;
  /** The day the glasses are promised for (YYYY-MM-DD). Optional. */
  promisedAt?: Value;
  notes?: Value;
}

export const LENS_DESCRIPTION_MAX = 200;
export const ORDER_NOTES_MAX = 2000;
/** The most one price or payment can be: 1,000,000 in the shop's currency (keeps every total inside a 32-bit whole number). */
export const MAX_AMOUNT_CENTS = 100_000_000;

export interface CleanDraft {
  customerId: string;
  prescriptionId: string | null;
  frameId: string | null;
  accessoryId: string | null;
  lensId: string | null;
  lensDescription: string | null;
  /** In centimes; null when none was typed. */
  lensPriceCents: number | null;
  /** The final price of the whole order in centimes; null = the total of the items. */
  finalPriceCents: number | null;
  /** The lens pair's cost in centimes; null = none typed (the catalogue's, if any). */
  lensCostCents: number | null;
  depositCents: number;
  pdRight: number | null;
  pdLeft: number | null;
  fittingHeightRight: number | null;
  fittingHeightLeft: number | null;
  promisedAt: string | null;
  notes: string | null;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

function parseNumber(v: unknown): number | null {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const text = v.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

const onStep = (value: number, step: number) => Math.abs(value / step - Math.round(value / step)) < 1e-9;

/** Centimes from an amount typed in the shop's currency: null when empty, NaN when it is not an amount (or has more than 2 decimals). */
function parseMoney(v: unknown): number | null {
  const amount = parseNumber(v);
  if (amount === null || Number.isNaN(amount)) return amount;
  const cents = amount * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6 ? Math.round(cents) : NaN;
}

const cleanId = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Checks what the form sent (no database): the clean draft, or the mistakes by field. */
export function validateOrderDraft(draft: OrderDraft, today: Date = new Date()): { draft: CleanDraft; errors?: undefined } | { draft?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const d = (draft ?? {}) as OrderDraft;

  const customerId = cleanId(d.customerId);
  if (!customerId) errors.customerId = "Choose the customer.";
  const prescriptionId = cleanId(d.prescriptionId);
  const frameId = cleanId(d.frameId);
  const accessoryId = cleanId(d.accessoryId);
  const lensId = cleanId(d.lensId);

  let lensDescription: string | null = null;
  if (!blank(d.lensDescription)) {
    if (typeof d.lensDescription !== "string") errors.lensDescription = "The lens description must be text.";
    else {
      lensDescription = d.lensDescription.trim().replace(/\s+/g, " ");
      if (lensDescription.length > LENS_DESCRIPTION_MAX) errors.lensDescription = `The lens description is too long: at most ${LENS_DESCRIPTION_MAX} characters.`;
    }
  }
  if (lensId && lensDescription) errors.lensDescription = "Pick a lens from the list or describe one, not both.";
  if (lensId && !prescriptionId) errors.prescriptionId = "A lens from the list is chosen for a prescription: choose the prescription, or describe the lens in words.";

  const money = (key: keyof OrderDraft, label: string): number | null => {
    const cents = parseMoney(d[key]);
    if (cents === null) return null;
    if (Number.isNaN(cents) || cents < 0) {
      errors[key] = `${label} must be an amount, like 5000 or 5000.50.`;
      return null;
    }
    if (cents > MAX_AMOUNT_CENTS) {
      errors[key] = `${label} cannot be more than ${MAX_AMOUNT_CENTS / 100}.`;
      return null;
    }
    return cents;
  };
  const lensPriceCents = money("lensPrice", "The lens price");
  if (lensDescription && !lensId && lensPriceCents === null && !errors.lensPrice) errors.lensPrice = "Give the price of the described lens.";
  const depositCents = money("deposit", "The deposit") ?? 0;
  const finalPriceCents = money("finalPrice", "The final price");
  const lensCostCents = money("lensCost", "The lens cost");

  if (!frameId && !accessoryId && !lensId && !lensDescription && !errors.lensDescription) errors.items = "Choose something to sell: a frame, an accessory or a lens.";

  const measure = (key: keyof OrderDraft, label: string, min: number, max: number): number | null => {
    const value = parseNumber(d[key]);
    if (value === null) return null;
    if (Number.isNaN(value)) errors[key] = `${label} must be a number.`;
    else if (value < min || value > max) errors[key] = `${label} must be between ${min} and ${max} mm.`;
    else if (!onStep(value, 0.5)) errors[key] = `${label} goes in steps of 0.5 mm.`;
    else return value;
    return null;
  };
  const pdRight = measure("pdRight", "Right PD", 15, 45);
  const pdLeft = measure("pdLeft", "Left PD", 15, 45);
  if ((pdRight === null) !== (pdLeft === null) && !errors.pdRight && !errors.pdLeft) errors[pdRight === null ? "pdRight" : "pdLeft"] = "Give the PD of both eyes, or of neither.";
  const fittingHeightRight = measure("fittingHeightRight", "Right fitting height", 5, 45);
  const fittingHeightLeft = measure("fittingHeightLeft", "Left fitting height", 5, 45);

  let promisedAt: string | null = null;
  if (!blank(d.promisedAt)) {
    const text = typeof d.promisedAt === "string" ? d.promisedAt.trim() : "";
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const date = day ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : null;
    const valid = date !== null && date.getUTCFullYear() === Number(day![1]) && date.getUTCMonth() === Number(day![2]) - 1 && date.getUTCDate() === Number(day![3]);
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    if (!valid) errors.promisedAt = "The promised day must be a date, like 2026-11-05.";
    else if (date!.getTime() < todayUtc) errors.promisedAt = "The promised day cannot be before today.";
    else promisedAt = text;
  }

  let notes: string | null = null;
  if (!blank(d.notes)) {
    if (typeof d.notes !== "string") errors.notes = "The notes must be text.";
    else if (d.notes.trim().length > ORDER_NOTES_MAX) errors.notes = `The notes are too long: at most ${ORDER_NOTES_MAX} characters.`;
    else notes = d.notes.trim();
  }

  if (Object.keys(errors).length > 0) return { errors };
  return {
    draft: { customerId: customerId!, prescriptionId, frameId, accessoryId, lensId, lensDescription, lensPriceCents, finalPriceCents, lensCostCents, depositCents, pdRight, pdLeft, fittingHeightRight, fittingHeightLeft, promisedAt, notes },
  };
}

