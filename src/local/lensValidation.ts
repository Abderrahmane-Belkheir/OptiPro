import type { FieldErrors } from "./frameValidation";

/**
 * The rules a lens has to follow before it is saved. The values come from a form, so each may be a number or the text the person typed
 * (a comma as the decimal mark is fine). What is wrong is returned per field, nothing is thrown. Nothing here is specific to one shop:
 * every limit is optional, and the design and material are free text (the page suggests the usual ones).
 *
 *   name           required, up to 120 characters
 *   design         free text up to 40 characters, kept as a lowercase code ("single_vision"); empty means single_vision
 *   material       the same; empty means organic
 *   index          1.30 to 2.10 (two decimals), or empty
 *   price, cost    0 or more, up to two decimals, in the shop's currency; stored in cents. Not tied to a pair or to one lens.
 *   sphere         -30 to +30      cylinder  -15 to +15      add  0 to +6      (steps of 0.25), each with a minimum and a maximum
 *   combined limit 0 to 40 (the largest allowed |sphere + cylinder|)
 *   lead time      a whole number of days, 0 to 365
 *   min fitting height   5 to 45 mm, in steps of 0.5 (the smallest height a progressive can be made for)
 *   a minimum may not be above its maximum; an add interval does not apply to a single vision lens
 */

type Value = string | number | boolean | null | undefined;

export interface LensForm {
  name?: Value;
  design?: Value;
  material?: Value;
  refractiveIndex?: Value;
  antiReflective?: Value;
  blueLightFilter?: Value;
  photochromic?: Value;
  polarized?: Value;
  tint?: Value;
  price?: Value;
  cost?: Value;
  isActive?: Value;
  sphereMin?: Value;
  sphereMax?: Value;
  cylinderMin?: Value;
  cylinderMax?: Value;
  addMin?: Value;
  addMax?: Value;
  combinedLimit?: Value;
  leadTimeDays?: Value;
  minFittingHeight?: Value;
  brand?: Value;
  reference?: Value;
  notes?: Value;
}

export interface CleanLens {
  name: string;
  design: string;
  material: string;
  refractiveIndex: number | null;
  antiReflective: boolean;
  blueLightFilter: boolean;
  photochromic: boolean;
  polarized: boolean;
  tint: string | null;
  priceCents: number;
  costCents: number;
  isActive: boolean;
  sphereMin: number | null;
  sphereMax: number | null;
  cylinderMin: number | null;
  cylinderMax: number | null;
  addMin: number | null;
  addMax: number | null;
  combinedLimit: number | null;
  leadTimeDays: number | null;
  minFittingHeight: number | null;
  brand: string | null;
  reference: string | null;
  notes: string | null;
}

export const NAME_MAX = 120;
export const CODE_MAX = 40;
export const TINT_MAX = 60;
export const BRAND_MAX = 80;
export const NOTES_MAX = 2000;
export const MAX_MONEY = 100_000_000; // in the shop's currency, not cents

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** A number from a number or from typed text ("-1,25"); null when left empty; NaN when it is not a number. */
function parseNumber(v: unknown): number | null {
  if (blank(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v !== "string") return NaN;
  const text = v.trim().replace(",", ".").replace(/^\+/, "");
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
}

const onStep = (value: number, step: number) => Math.abs(value / step - Math.round(value / step)) < 1e-9;

function parseBoolean(v: unknown, fallback: boolean): boolean | null {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (["true", "on", "yes", "1"].includes(t)) return true;
    if (["false", "off", "no", "0"].includes(t)) return false;
  }
  return null;
}

/** "Single vision", "single-vision" and "single_vision" are the same code. */
export function toCode(text: string): string {
  return text.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export function validateLensForm(form: LensForm): { lens: CleanLens; errors?: undefined } | { lens?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const f = (form ?? {}) as LensForm;

  const text = (key: keyof LensForm, label: string, max: number): string | null => {
    const v = f[key];
    if (blank(v)) return null;
    if (typeof v !== "string" && typeof v !== "number") {
      errors[key] = `${label} must be text.`;
      return null;
    }
    const t = String(v).trim();
    if (t.length > max) {
      errors[key] = `${label} can have at most ${max} characters.`;
      return null;
    }
    return t;
  };

  const name = text("name", "The name", NAME_MAX);
  if (name === null && !errors.name) errors.name = "Give the lens a name.";

  const code = (key: "design" | "material", label: string, fallback: string): string => {
    const t = text(key, label, CODE_MAX);
    if (t === null) return fallback;
    const c = toCode(t);
    if (!c) {
      errors[key] = `${label} must have letters or digits.`;
      return fallback;
    }
    return c;
  };
  const design = code("design", "The design", "single_vision");
  const material = code("material", "The material", "organic");

  const number = (key: keyof LensForm, label: string, min: number, max: number, step: number | null): number | null => {
    const value = parseNumber(f[key]);
    if (value === null) return null;
    if (Number.isNaN(value)) {
      errors[key] = `${label} must be a number.`;
      return null;
    }
    if (value < min || value > max) {
      errors[key] = `${label} must be between ${min} and ${max}.`;
      return null;
    }
    if (step !== null && !onStep(value, step)) {
      errors[key] = `${label} goes in steps of ${step}.`;
      return null;
    }
    return value;
  };

  const refractiveIndex = number("refractiveIndex", "The index", 1.3, 2.1, 0.01);

  const money = (key: "price" | "cost", label: string): number => {
    const value = parseNumber(f[key]);
    if (value === null) return 0;
    if (Number.isNaN(value) || value < 0 || value > MAX_MONEY) {
      errors[key] = `${label} must be an amount from 0 to ${MAX_MONEY.toLocaleString("en-US")}.`;
      return 0;
    }
    if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
      errors[key] = `${label} can have two decimals at most.`;
      return 0;
    }
    return Math.round(value * 100);
  };
  const priceCents = money("price", "The price");
  const costCents = money("cost", "The cost");

  const flag = (key: keyof LensForm, label: string, fallback: boolean): boolean => {
    const b = parseBoolean(f[key], fallback);
    if (b === null) {
      errors[key] = `${label} must be yes or no.`;
      return fallback;
    }
    return b;
  };
  const antiReflective = flag("antiReflective", "Anti-reflective", false);
  const blueLightFilter = flag("blueLightFilter", "Blue-light filter", false);
  const photochromic = flag("photochromic", "Photochromic", false);
  const polarized = flag("polarized", "Polarized", false);
  const isActive = flag("isActive", "Active", true);

  // the power interval
  const sphereMin = number("sphereMin", "The smallest sphere", -30, 30, 0.25);
  const sphereMax = number("sphereMax", "The largest sphere", -30, 30, 0.25);
  const cylinderMin = number("cylinderMin", "The smallest cylinder", -15, 15, 0.25);
  const cylinderMax = number("cylinderMax", "The largest cylinder", -15, 15, 0.25);
  const addMin = number("addMin", "The smallest add", 0, 6, 0.25);
  const addMax = number("addMax", "The largest add", 0, 6, 0.25);
  const combinedLimit = number("combinedLimit", "The combined limit", 0, 40, 0.25);
  const ordered = (lo: number | null, hi: number | null, loKey: keyof LensForm, label: string) => {
    if (lo !== null && hi !== null && lo > hi && !errors[loKey]) errors[loKey] = `The smallest ${label} cannot be above the largest.`;
  };
  ordered(sphereMin, sphereMax, "sphereMin", "sphere");
  ordered(cylinderMin, cylinderMax, "cylinderMin", "cylinder");
  ordered(addMin, addMax, "addMin", "add");
  if (design === "single_vision" && (addMin !== null || addMax !== null) && !errors.addMin && !errors.addMax) {
    errors[addMin !== null ? "addMin" : "addMax"] = "An add interval only applies to bifocal and progressive lenses.";
  }

  // the lab's lead time (whole days) and the smallest fitting height
  let leadTimeDays: number | null = null;
  const rawLead = parseNumber(f.leadTimeDays);
  if (rawLead !== null) {
    if (Number.isNaN(rawLead) || !Number.isInteger(rawLead)) errors.leadTimeDays = "The lead time is a whole number of days.";
    else if (rawLead < 0 || rawLead > 365) errors.leadTimeDays = "The lead time must be between 0 and 365 days.";
    else leadTimeDays = rawLead;
  }
  const minFittingHeight = number("minFittingHeight", "The minimum fitting height", 5, 45, 0.5);

  const tint = text("tint", "The tint", TINT_MAX);
  const brand = text("brand", "The maker", BRAND_MAX);
  const reference = text("reference", "The reference", BRAND_MAX);
  const notes = text("notes", "The notes", NOTES_MAX);

  if (Object.keys(errors).length > 0) return { errors };
  return {
    lens: {
      name: name!, design, material, refractiveIndex, antiReflective, blueLightFilter, photochromic, polarized, tint,
      priceCents, costCents, isActive, sphereMin, sphereMax, cylinderMin, cylinderMax, addMin, addMax, combinedLimit, leadTimeDays, minFittingHeight, brand, reference, notes,
    },
  };
}
