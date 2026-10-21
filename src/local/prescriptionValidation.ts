import type { FieldErrors } from "./frameValidation";

/**
 * The rules a prescription (glasses) has to follow before it is saved. The values come from a form, so each may be a number or the text the
 * person typed (a comma as the decimal mark is fine). What is wrong is returned per field, nothing is thrown.
 *
 *   sphere     -20 to +20, in steps of 0.25            cylinder   -10 to +10, in steps of 0.25
 *   axis       a whole number, 0 to 180                (given exactly when there is a cylinder)
 *   add        0 to +4, in steps of 0.25
 *   PD         40 to 80 mm (both eyes together), or 15 to 45 mm for each eye, in steps of 0.5; with each eye's PD the total is filled in
 *   fitting height   5 to 45 mm, in steps of 0.5
 *   date       the day written on the prescription: not in the future, not before 1900
 * At least one eye must have a sphere or a cylinder.
 */

type Value = string | number | null | undefined;

export interface PrescriptionForm {
  customerId?: Value;
  prescribedAt?: Value;
  prescriberName?: Value;
  rightSphere?: Value;
  rightCylinder?: Value;
  rightAxis?: Value;
  rightAdd?: Value;
  leftSphere?: Value;
  leftCylinder?: Value;
  leftAxis?: Value;
  leftAdd?: Value;
  pd?: Value;
  pdRight?: Value;
  pdLeft?: Value;
  fittingHeightRight?: Value;
  fittingHeightLeft?: Value;
  notes?: Value;
}

export interface CleanPrescription {
  customerId: string;
  /** The day, as an ISO date at midnight UTC. */
  prescribedAt: string;
  prescriberName: string | null;
  rightSphere: number | null;
  rightCylinder: number | null;
  rightAxis: number | null;
  rightAdd: number | null;
  leftSphere: number | null;
  leftCylinder: number | null;
  leftAxis: number | null;
  leftAdd: number | null;
  pd: number | null;
  pdRight: number | null;
  pdLeft: number | null;
  fittingHeightRight: number | null;
  fittingHeightLeft: number | null;
  notes: string | null;
}

export const PRESCRIBER_MAX = 120;
export const NOTES_MAX = 2000;

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

export function validatePrescriptionForm(form: PrescriptionForm, now: Date = new Date()): { prescription: CleanPrescription; errors?: undefined } | { prescription?: undefined; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const f = (form ?? {}) as PrescriptionForm;

  const measure = (key: keyof PrescriptionForm, label: string, min: number, max: number, step: number, unit = ""): number | null => {
    const value = parseNumber(f[key]);
    if (value === null) return null;
    if (Number.isNaN(value)) {
      errors[key] = `${label} must be a number.`;
      return null;
    }
    if (value < min || value > max) {
      errors[key] = `${label} must be between ${min} and ${max}${unit}.`;
      return null;
    }
    if (!onStep(value, step)) {
      errors[key] = `${label} goes in steps of ${step}${unit}.`;
      return null;
    }
    return value;
  };

  const eye = (side: "right" | "left") => {
    const L = side === "right" ? "Right" : "Left";
    const sphere = measure(`${side}Sphere` as keyof PrescriptionForm, `${L} sphere`, -20, 20, 0.25);
    const cylinder = measure(`${side}Cylinder` as keyof PrescriptionForm, `${L} cylinder`, -10, 10, 0.25);
    const add = measure(`${side}Add` as keyof PrescriptionForm, `${L} add`, 0, 4, 0.25);
    const axisKey = `${side}Axis` as keyof PrescriptionForm;
    let axis: number | null = null;
    const rawAxis = parseNumber(f[axisKey]);
    if (rawAxis !== null) {
      if (Number.isNaN(rawAxis) || !Number.isInteger(rawAxis)) errors[axisKey] = `${L} axis must be a whole number.`;
      else if (rawAxis < 0 || rawAxis > 180) errors[axisKey] = `${L} axis must be between 0 and 180.`;
      else axis = rawAxis;
    }
    // The axis belongs to the cylinder: with one, the other is needed; without one, an axis means nothing.
    const hasCylinder = cylinder !== null && cylinder !== 0;
    if (!errors[axisKey]) {
      if (hasCylinder && axis === null) errors[axisKey] = `Give the ${side} axis that goes with the cylinder.`;
      else if (!hasCylinder && axis !== null && !errors[`${side}Cylinder`]) errors[axisKey] = `The ${side} axis needs a ${side} cylinder.`;
    }
    return { sphere, cylinder, axis, add };
  };
  const right = eye("right");
  const left = eye("left");
  if (right.sphere === null && right.cylinder === null && left.sphere === null && left.cylinder === null && !errors.rightSphere && !errors.rightCylinder && !errors.leftSphere && !errors.leftCylinder) {
    errors.rightSphere = "Enter the prescription of at least one eye (a sphere or a cylinder).";
  }

  // PD: the two eyes together, or each eye; with both eyes given the total is checked against them (or filled in).
  let pd = measure("pd", "PD", 40, 80, 0.5, " mm");
  const pdRight = measure("pdRight", "Right PD", 15, 45, 0.5, " mm");
  const pdLeft = measure("pdLeft", "Left PD", 15, 45, 0.5, " mm");
  if ((pdRight === null) !== (pdLeft === null) && !errors.pdRight && !errors.pdLeft) {
    errors[pdRight === null ? "pdRight" : "pdLeft"] = "Give the PD of both eyes, or of neither.";
  } else if (pdRight !== null && pdLeft !== null) {
    if (pd === null && !errors.pd) pd = pdRight + pdLeft;
    else if (pd !== null && Math.abs(pd - (pdRight + pdLeft)) > 1) errors.pd = `The PD (${pd}) should be the two eyes' PDs added (${pdRight + pdLeft}).`;
  }
  const fittingHeightRight = measure("fittingHeightRight", "Right fitting height", 5, 45, 0.5, " mm");
  const fittingHeightLeft = measure("fittingHeightLeft", "Left fitting height", 5, 45, 0.5, " mm");

  // the day written on the prescription
  let prescribedAt = "";
  if (blank(f.prescribedAt)) errors.prescribedAt = "Enter the date of the prescription.";
  else if (typeof f.prescribedAt !== "string" || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(f.prescribedAt.trim())) errors.prescribedAt = "The date must look like 2026-10-19.";
  else {
    const day = f.prescribedAt.trim().slice(0, 10);
    const date = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) errors.prescribedAt = "This is not a real date.";
    else if (date.getUTCFullYear() < 1900) errors.prescribedAt = "The date cannot be before 1900.";
    else if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) errors.prescribedAt = "The date cannot be in the future.";
    else prescribedAt = date.toISOString();
  }

  const text = (key: "prescriberName" | "notes", label: string, max: number): string | null => {
    const v = f[key];
    if (blank(v)) return null;
    if (typeof v !== "string") {
      errors[key] = `${label} must be text.`;
      return null;
    }
    const tidy = key === "notes" ? v.trim() : v.trim().split(/\s+/).join(" ");
    if (tidy.length > max) {
      errors[key] = `${label} must be at most ${max} characters.`;
      return null;
    }
    return tidy;
  };
  const prescriberName = text("prescriberName", "The prescriber's name", PRESCRIBER_MAX);
  const notes = text("notes", "The notes", NOTES_MAX);

  const customerId = typeof f.customerId === "string" ? f.customerId.trim() : "";
  if (!customerId) errors.customerId = "Choose the customer.";

  if (Object.keys(errors).length > 0) return { errors };
  return {
    prescription: {
      customerId,
      prescribedAt,
      prescriberName,
      rightSphere: right.sphere, rightCylinder: right.cylinder, rightAxis: right.axis, rightAdd: right.add,
      leftSphere: left.sphere, leftCylinder: left.cylinder, leftAxis: left.axis, leftAdd: left.add,
      pd, pdRight, pdLeft, fittingHeightRight, fittingHeightLeft, notes,
    },
  };
}
