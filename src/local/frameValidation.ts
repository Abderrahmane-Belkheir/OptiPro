import { sniffContentType, MAX_IMAGE_BYTES } from "./imageService";
import { STATIC_CATEGORIES } from "./staticCategories";

/**
 * What the creation card sends: the form as the person filled it in. Numbers may arrive as text (an input's
 * value), empty text means "not given". `colors` is the comma-separated text of the Colors field.
 */
export interface FrameForm {
  name?: unknown;
  reference?: unknown;
  shape?: unknown;
  colors?: unknown;
  price?: unknown;
  currency?: unknown;
  costPrice?: unknown;
  stock?: unknown;
  eyeSize?: unknown;
  bridge?: unknown;
  templeLength?: unknown;
  brandId?: unknown;
  categoryId?: unknown;
}

/** A photo as the window hands it over: its file name (only for messages) and its bytes. */
export interface PhotoInput {
  name?: unknown;
  bytes?: unknown;
}

/** The frame, cleaned and typed, ready to be stored (the id is made up later). */
export interface CleanFrame {
  name: string;
  reference: string | null;
  shape: string | null;
  colors: string[];
  price: number | null;
  currency: string | null;
  costPrice: number | null;
  stock: number;
  eyeSize: number | null;
  bridge: number | null;
  templeLength: number | null;
  brandId: string;
  categoryId: number;
}

/** A photo that passed: its bytes and what it really is. */
export interface CleanPhoto {
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

/** Field name -> the message to show next to it. Empty when everything is fine. */
export type FieldErrors = Record<string, string>;

export const CURRENCIES = ["DZD", "EUR", "USD"] as const;
export const MAX_PHOTOS = 10;
const LIMITS = {
  name: 120,
  reference: 60,
  shape: 40,
  color: 30,
  colors: 12,
  money: 100_000_000,
  stock: 1_000_000,
  eye: [10, 100],
  bridge: [1, 50],
  temple: [50, 250],
} as const;

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Text with the spaces around and inside tidied. */
const tidy = (v: string) => v.trim().split(/\s+/).join(" ");

/** A number from a number or from an input's text (a decimal comma is accepted); null when not given, NaN when it is not a number. */
function parseNumber(v: unknown): number | null {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const text = v.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

function text(v: unknown, label: string, max: number, errors: FieldErrors, key: string, required = false): string | null {
  if (blank(v)) {
    if (required) errors[key] = `${label} is required.`;
    return null;
  }
  if (typeof v !== "string") {
    errors[key] = `${label} must be text.`;
    return null;
  }
  const clean = tidy(v);
  if (clean.length > max) {
    errors[key] = `${label} is too long (${clean.length} characters; the most is ${max}).`;
    return null;
  }
  return clean;
}

function amount(v: unknown, label: string, errors: FieldErrors, key: string, opts: { integer?: boolean; min?: number; max: number }): number | null {
  const n = parseNumber(v);
  if (n === null) return null;
  const min = opts.min ?? 0;
  if (Number.isNaN(n)) errors[key] = `${label} must be a number.`;
  else if (opts.integer && !Number.isInteger(n)) errors[key] = `${label} must be a whole number.`;
  else if (n < min || n > opts.max) errors[key] = `${label} must be between ${min} and ${opts.max}.`;
  else return n;
  return null;
}

/**
 * Checks the form. Returns the cleaned frame, or the errors by field (never both): nothing is read from the
 * database here; whether the brand exists is checked by the caller.
 */
export function validateFrameForm(form: FrameForm): { frame: CleanFrame; errors?: undefined } | { frame?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!form || typeof form !== "object") return { errors: { form: "There is nothing to save." } };

  const name = text(form.name, "The name", LIMITS.name, errors, "name", true);
  const reference = text(form.reference, "The reference", LIMITS.reference, errors, "reference");
  const shapeText = text(form.shape, "The shape", LIMITS.shape, errors, "shape");

  // Colors: "Gold, Black ,gold" -> ["Gold", "Black"] (no empty ones, no repeats whatever the letter case).
  let colors: string[] = [];
  if (!blank(form.colors)) {
    if (typeof form.colors !== "string") errors.colors = "The colors must be text separated by commas.";
    else {
      const seen = new Set<string>();
      for (const part of form.colors.split(",")) {
        const color = tidy(part);
        if (color && !seen.has(color.toLowerCase())) {
          seen.add(color.toLowerCase());
          colors.push(color);
        }
      }
      const tooLong = colors.find((c) => c.length > LIMITS.color);
      if (tooLong) errors.colors = `A color name is too long: “${tooLong.slice(0, 20)}…” (the most is ${LIMITS.color} characters).`;
      else if (colors.length > LIMITS.colors) errors.colors = `Too many colors (${colors.length}; the most is ${LIMITS.colors}).`;
      if (errors.colors) colors = [];
    }
  }

  const price = amount(form.price, "The price", errors, "price", { max: LIMITS.money });
  const costPrice = amount(form.costPrice, "The cost price", errors, "costPrice", { max: LIMITS.money });
  let currency: string | null = null;
  if (price !== null) {
    const c = typeof form.currency === "string" ? form.currency.trim().toUpperCase() : "";
    if (!(CURRENCIES as readonly string[]).includes(c)) errors.currency = `Choose a currency (${CURRENCIES.join(", ")}).`;
    else currency = c;
  }
  const stock = amount(form.stock, "The stock", errors, "stock", { integer: true, max: LIMITS.stock }) ?? 0;

  // The size is printed on the frame as eye-bridge-temple: all three or none.
  const eyeSize = amount(form.eyeSize, "The eye size", errors, "eyeSize", { integer: true, min: LIMITS.eye[0], max: LIMITS.eye[1] });
  const bridge = amount(form.bridge, "The bridge", errors, "bridge", { integer: true, min: LIMITS.bridge[0], max: LIMITS.bridge[1] });
  const templeLength = amount(form.templeLength, "The temple length", errors, "templeLength", { integer: true, min: LIMITS.temple[0], max: LIMITS.temple[1] });
  const given = [form.eyeSize, form.bridge, form.templeLength].filter((v) => !blank(v)).length;
  if (given > 0 && given < 3 && !errors.eyeSize && !errors.bridge && !errors.templeLength) errors.size = "Give the eye size, the bridge and the temple length together, or none of them.";

  const brandId = typeof form.brandId === "string" ? form.brandId.trim() : "";
  if (brandId === "" || brandId.length > 64) errors.brandId = "Choose a brand first.";
  const categoryId = parseNumber(form.categoryId);
  if (categoryId === null || Number.isNaN(categoryId) || !STATIC_CATEGORIES.some((c) => c.id === categoryId)) errors.categoryId = "Choose a category first.";

  if (Object.keys(errors).length > 0) return { errors };
  return {
    frame: {
      name: name!,
      reference,
      shape: shapeText ? shapeText.toLowerCase() : null,
      colors,
      price,
      currency,
      costPrice,
      stock,
      eyeSize,
      bridge,
      templeLength,
      brandId,
      categoryId: categoryId!,
    },
  };
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

/** Checks the photos by what they really are (their first bytes), their size and their number. Errors, if any, are under the key "photos". */
export function validatePhotos(photos: unknown): { photos: CleanPhoto[]; errors?: undefined } | { photos?: undefined; errors: FieldErrors } {
  if (photos === undefined || photos === null) return { photos: [] };
  if (!Array.isArray(photos)) return { errors: { photos: "The photos must be a list." } };
  if (photos.length > MAX_PHOTOS) return { errors: { photos: `Too many photos (${photos.length}; the most is ${MAX_PHOTOS}).` } };

  const problems: string[] = [];
  const clean: CleanPhoto[] = [];
  photos.forEach((photo: PhotoInput, index) => {
    const name = typeof photo?.name === "string" && photo.name ? photo.name.slice(0, 60) : `photo ${index + 1}`;
    const bytes = toBytes(photo?.bytes);
    if (!bytes) problems.push(`${name} could not be read`);
    else if (bytes.length === 0) problems.push(`${name} is empty`);
    else if (bytes.length > MAX_IMAGE_BYTES) problems.push(`${name} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
    else {
      const contentType = sniffContentType(bytes);
      if (!contentType) problems.push(`${name} is not a PNG, JPEG, WebP or GIF image`);
      else clean.push({ name, bytes, contentType });
    }
  });
  return problems.length > 0 ? { errors: { photos: `${problems.join("; ")}.` } } : { photos: clean };
}

// ---- accessories ------------------------------------------------------------------------------

/** What the accessory card sends: the form as the person filled it in (numbers may arrive as text). */
export interface AccessoryForm {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  currency?: unknown;
  costPrice?: unknown;
  stock?: unknown;
}

/** The accessory, cleaned and typed, ready to be stored. */
export interface CleanAccessory {
  name: string;
  description: string;
  price: number | null;
  currency: string | null;
  costPrice: number | null;
  stock: number;
}

const ACCESSORY_DESCRIPTION_MAX = 1000;

/** Checks an accessory's form the way validateFrameForm checks a frame's: the cleaned accessory, or the errors by field (never both). */
export function validateAccessoryForm(form: AccessoryForm): { accessory: CleanAccessory; errors?: undefined } | { accessory?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!form || typeof form !== "object") return { errors: { form: "There is nothing to save." } };

  const name = text(form.name, "The name", LIMITS.name, errors, "name", true);
  const description = text(form.description, "The description", ACCESSORY_DESCRIPTION_MAX, errors, "description", true);
  const price = amount(form.price, "The price", errors, "price", { max: LIMITS.money });
  const costPrice = amount(form.costPrice, "The cost price", errors, "costPrice", { max: LIMITS.money });
  let currency: string | null = null;
  if (price !== null) {
    const c = typeof form.currency === "string" ? form.currency.trim().toUpperCase() : "";
    if (!(CURRENCIES as readonly string[]).includes(c)) errors.currency = `Choose a currency (${CURRENCIES.join(", ")}).`;
    else currency = c;
  }
  const stock = amount(form.stock, "The stock", errors, "stock", { integer: true, max: LIMITS.stock }) ?? 0;

  if (Object.keys(errors).length > 0) return { errors };
  return { accessory: { name: name!, description: description!, price, currency, costPrice, stock } };
}
