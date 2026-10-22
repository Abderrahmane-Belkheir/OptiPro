import type { Lens } from "../services/types";

/**
 * Which lenses can be made for a prescription, eye by eye. Pure logic: it takes a prescription object and a list of lenses and answers; it
 * touches no database and no screen. (The service method `localLensService.availableFor` loads the lenses and the prescription for it.)
 *
 * WHAT IT CHECKS, per eye, per lens (every reason found is reported, not only the first):
 *   - sphere        inside the lens's [sphereMin, sphereMax]
 *   - cylinder      inside the lens's [cylinderMin, cylinderMax]   (in the lens's own sign convention, see below)
 *   - combined      the strongest meridian, max(|sphere|, |sphere + cylinder|), not above the lens's combinedLimit
 *   - add           a design that needs an add (bifocal, progressive, any design other than single_vision) needs one, inside [addMin, addMax]
 *   - fitting height  for those designs, the measured height not below the lens's minFittingHeight (unknown: allowed, with a note)
 *   - retired       a retired lens (isActive = false) is not considered, unless asked for
 * A limit that is empty (null) means "no limit known" and never excludes. Limits are inclusive: a sphere of exactly -6.00 fits a lens that goes to -6.00.
 *
 * SIGN OF THE CYLINDER. A prescription can be written with a minus cylinder (the usual) or a plus cylinder; the two describe the same lens:
 *   transposed:  sphere' = sphere + cylinder,  cylinder' = -cylinder,  axis' = axis + 90 (kept in 1..180)
 * A lens's cylinder interval is written in the sign the shop uses. The prescription is compared with each lens in that lens's sign: minus unless the
 * lens's cylinder interval starts at 0 or above and goes up (a plus-cylinder lens). When the prescription had to be converted, the result says so.
 *
 * NUMBERS. Diopters are compared as whole hundredths (-1.1 + -2.2 is -3.30, not -3.3000000000000003), so a value exactly on a limit is on it.
 *
 * NOT CHECKED (they need the frame or the lab, not the prescription): the size of the blank and decentration (from the pupillary distance and the
 * frame), thickness, the material or index, prism, and how old the prescription is.
 */

export type Eye = "right" | "left";
type Raw = number | string | null | undefined;

/** The fields of a prescription the matching reads. A saved Prescription fits; so does a draft with only some of them. Numbers or typed text ("-1,25"). */
export interface PrescriptionInput {
  rightSphere?: Raw;
  rightCylinder?: Raw;
  rightAxis?: Raw;
  rightAdd?: Raw;
  leftSphere?: Raw;
  leftCylinder?: Raw;
  leftAxis?: Raw;
  leftAdd?: Raw;
  fittingHeightRight?: Raw;
  fittingHeightLeft?: Raw;
}

/** What is read of a lens. A saved Lens fits. */
export type LensLike = Pick<
  Lens,
  "id" | "name" | "design" | "material" | "refractiveIndex" | "priceCents" | "isActive" | "sphereMin" | "sphereMax" | "cylinderMin" | "cylinderMax" | "addMin" | "addMax" | "combinedLimit" | "leadTimeDays" | "minFittingHeight" | "brand" | "reference"
>;

export type ReasonCode = "SPHERE_OUT_OF_RANGE" | "CYLINDER_OUT_OF_RANGE" | "COMBINED_LIMIT_EXCEEDED" | "ADD_REQUIRED" | "ADD_OUT_OF_RANGE" | "FITTING_HEIGHT_TOO_LOW";
export type NoteCode = "CYLINDER_TRANSPOSED" | "ADD_NOT_CORRECTED" | "FITTING_HEIGHT_UNKNOWN" | "LIMITS_UNKNOWN" | "RETIRED";
export type EyeWarningCode = "SPHERE_ASSUMED_PLANO" | "AXIS_MISSING";

/** A finding in words, with a stable code (for a screen to translate or style) and the numbers behind the sentence. */
export interface Finding<C extends string> {
  code: C;
  message: string;
  data: Record<string, number | string | null>;
}

export interface LensFit {
  lensId: string;
  lens: LensLike;
  /** Things worth knowing about a lens that does fit (the add is not corrected, the fitting height must be measured...). */
  notes: Finding<NoteCode>[];
  retired: boolean;
}

export interface LensExclusion {
  lensId: string;
  lens: LensLike;
  /** Why it cannot be made for this eye: every limit the prescription is outside of. */
  reasons: Finding<ReasonCode>[];
  retired: boolean;
}

/** A prescription's eye in one sign convention. Diopters; the axis is in degrees (1..180) or null when it was not given. */
export interface CylinderForm {
  sphere: number;
  cylinder: number;
  axis: number | null;
}

export interface EyeMatch {
  eye: Eye;
  /**
   * ok              the eye has a power and the lenses were checked
   * not-prescribed  nothing was prescribed for this eye (no sphere, no cylinder, no add): no lens is checked
   * invalid         a value is not a number or is outside what a prescription can hold (see `problems`): no lens is checked
   */
  status: "ok" | "not-prescribed" | "invalid";
  problems: string[];
  warnings: Finding<EyeWarningCode>[];
  /** The power as given (an empty sphere or cylinder counts as 0), the same prescription in each sign, and the strongest meridian. Null unless status is ok. */
  power: { sphere: number; cylinder: number; axis: number | null; add: number | null; strongestMeridian: number; minusCylinder: CylinderForm; plusCylinder: CylinderForm } | null;
  fittingHeight: number | null;
  /** The lenses that can be made for this eye, the best first (see sortFits). */
  available: LensFit[];
  /** The lenses that cannot, each with its reasons. */
  unavailable: LensExclusion[];
}

export interface BothEyesFit {
  lensId: string;
  lens: LensLike;
  right: LensFit;
  left: LensFit;
}

export interface LensMatch {
  right: EyeMatch;
  left: EyeMatch;
  /** Lenses that can be made for BOTH eyes (the same lens in each), in the right eye's order. */
  bothEyes: BothEyesFit[];
}

export interface MatchOptions {
  /** Also consider retired lenses (they carry a RETIRED note). Default: they are left out. */
  includeRetired?: boolean;
}

// ---- Limits a prescription can hold (the same as prescriptionValidation.ts) ----------------------------------------------------------

const SPHERE_LIMIT = 20;
const CYLINDER_LIMIT = 10;
const ADD_MAX = 4;
const FITTING_HEIGHT_RANGE: [number, number] = [5, 45];

// ---- Numbers --------------------------------------------------------------------------------------------------------------------------

/** Whole hundredths of a diopter (or of a millimetre): -1.1 -> -110. */
const centi = (value: number): number => Math.round(value * 100) + 0; // (+ 0 turns -0 into 0)

const diopters = (centiValue: number): number => centiValue / 100;

/** "+1.25", "-2.00", "0.00": a power as it is written on a prescription. */
export function formatDiopters(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

const mm = (value: number): string => `${Math.round(value * 10) / 10} mm`;

type Parsed = { ok: true; value: number | null } | { ok: false };

/** A value from a number or from typed text ("-1,25", "+2"): null when empty, not ok when it is something else. */
function parse(raw: unknown): Parsed {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw === "number") return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
  if (typeof raw === "string") {
    const text = raw.trim().replace(",", ".").replace(/^\+/, "");
    if (text === "") return { ok: true, value: null };
    return /^-?\d+(\.\d+)?$/.test(text) ? { ok: true, value: Number(text) } : { ok: false };
  }
  return { ok: false };
}

// ---- Transposition ----------------------------------------------------------------------------------------------------------------------

/** The axis of the transposed cylinder: 90 degrees away, kept in 1..180 (0 and 180 are the same axis). */
export function transposeAxis(axis: number): number {
  const a = axis === 0 ? 180 : axis;
  return a > 90 ? a - 90 : a + 90;
}

/** The same prescription written with a minus cylinder. */
export function toMinusCylinder(form: CylinderForm): CylinderForm {
  return form.cylinder > 0 ? transposed(form) : { ...form };
}

/** The same prescription written with a plus cylinder. */
export function toPlusCylinder(form: CylinderForm): CylinderForm {
  return form.cylinder < 0 ? transposed(form) : { ...form };
}

function transposed(form: CylinderForm): CylinderForm {
  return {
    sphere: diopters(centi(form.sphere) + centi(form.cylinder)),
    cylinder: diopters(-centi(form.cylinder)),
    axis: form.axis === null ? null : transposeAxis(form.axis),
  };
}

/** The strongest meridian, the larger of the two principal powers' sizes: the same in both signs. */
export function strongestMeridian(sphere: number, cylinder: number): number {
  return diopters(Math.max(Math.abs(centi(sphere)), Math.abs(centi(sphere) + centi(cylinder))));
}

/** The sign a lens's cylinder interval is written in: plus when it starts at 0 or above and goes up, otherwise minus. */
export function lensCylinderSign(lens: Pick<LensLike, "cylinderMin" | "cylinderMax">): "minus" | "plus" {
  return lens.cylinderMin !== null && lens.cylinderMin >= 0 && lens.cylinderMax !== null && lens.cylinderMax > 0 ? "plus" : "minus";
}

// ---- One eye ------------------------------------------------------------------------------------------------------------------------------

interface ReadEye {
  status: EyeMatch["status"];
  problems: string[];
  warnings: Finding<EyeWarningCode>[];
  sphere: number;
  cylinder: number;
  axis: number | null;
  add: number | null;
  fittingHeight: number | null;
}

function readEye(input: PrescriptionInput, eye: Eye): ReadEye {
  const cap = eye === "right" ? "Right" : "Left";
  const problems: string[] = [];
  const warnings: Finding<EyeWarningCode>[] = [];
  const get = (key: keyof PrescriptionInput, label: string, check?: (v: number) => string | null): number | null => {
    const parsed = parse(input[key]);
    if (!parsed.ok) {
      problems.push(`${cap} ${label} is not a number.`);
      return null;
    }
    if (parsed.value !== null && check) {
      const problem = check(parsed.value);
      if (problem) problems.push(`${cap} ${label} ${problem}`);
    }
    return parsed.value;
  };
  const sphereGiven = get(`${eye}Sphere` as keyof PrescriptionInput, "sphere", (v) => (Math.abs(v) > SPHERE_LIMIT ? `${formatDiopters(v)} is outside -${SPHERE_LIMIT} to +${SPHERE_LIMIT}.` : null));
  const cylinder = get(`${eye}Cylinder` as keyof PrescriptionInput, "cylinder", (v) => (Math.abs(v) > CYLINDER_LIMIT ? `${formatDiopters(v)} is outside -${CYLINDER_LIMIT} to +${CYLINDER_LIMIT}.` : null));
  const axis = get(`${eye}Axis` as keyof PrescriptionInput, "axis", (v) => (!Number.isInteger(v) || v < 0 || v > 180 ? `${v} is not a whole number of degrees from 0 to 180.` : null));
  const add = get(`${eye}Add` as keyof PrescriptionInput, "add", (v) => (v < 0 || v > ADD_MAX ? `${formatDiopters(v)} is outside 0 to +${ADD_MAX}.` : null));
  const fittingHeight = get(eye === "right" ? "fittingHeightRight" : "fittingHeightLeft", "fitting height", (v) =>
    v < FITTING_HEIGHT_RANGE[0] || v > FITTING_HEIGHT_RANGE[1] ? `${mm(v)} is outside ${FITTING_HEIGHT_RANGE[0]} to ${FITTING_HEIGHT_RANGE[1]} mm.` : null,
  );

  const base = { problems, warnings, axis, add, fittingHeight };
  if (problems.length > 0) return { ...base, status: "invalid", sphere: 0, cylinder: 0 };
  if (sphereGiven === null && cylinder === null) {
    if (add !== null && add > 0) problems.push(`${cap} eye has an add but no sphere or cylinder.`);
    return { ...base, status: problems.length > 0 ? "invalid" : "not-prescribed", sphere: 0, cylinder: 0 };
  }
  if (sphereGiven === null) {
    warnings.push({ code: "SPHERE_ASSUMED_PLANO", message: `${cap} sphere is empty: taken as plano (0.00).`, data: {} });
  }
  const cyl = cylinder ?? 0;
  if (cyl !== 0 && axis === null) {
    warnings.push({ code: "AXIS_MISSING", message: `${cap} cylinder ${formatDiopters(cyl)} has no axis: the lens can be chosen, but the axis is needed to make it.`, data: { cylinder: cyl } });
  }
  return { ...base, status: "ok", sphere: sphereGiven ?? 0, cylinder: cyl };
}

const outside = (value: number, min: number | null, max: number | null): boolean => (min !== null && value < centi(min)) || (max !== null && value > centi(max));

function describeRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${formatDiopters(min)} to ${formatDiopters(max)}`;
  if (min !== null) return `${formatDiopters(min)} and above`;
  if (max !== null) return `up to ${formatDiopters(max)}`;
  return "no limit";
}

const needsAdd = (lens: LensLike): boolean => lens.design !== "single_vision";
const hasAnyLimit = (lens: LensLike): boolean =>
  [lens.sphereMin, lens.sphereMax, lens.cylinderMin, lens.cylinderMax, lens.addMin, lens.addMax, lens.combinedLimit, lens.minFittingHeight].some((v) => v !== null);

/** Checks one lens against one eye. Answers the reasons it cannot be made (empty: it can) and the notes about it. */
function checkLens(eyeData: ReadEye, otherEyeAdd: number | null, lens: LensLike): { reasons: Finding<ReasonCode>[]; notes: Finding<NoteCode>[] } {
  const reasons: Finding<ReasonCode>[] = [];
  const notes: Finding<NoteCode>[] = [];

  // The prescription in the sign the lens is written in.
  const given: CylinderForm = { sphere: eyeData.sphere, cylinder: eyeData.cylinder, axis: eyeData.axis };
  const sign = lensCylinderSign(lens);
  const form = sign === "plus" ? toPlusCylinder(given) : toMinusCylinder(given);
  const converted = centi(form.cylinder) !== centi(given.cylinder);
  if (converted) {
    notes.push({
      code: "CYLINDER_TRANSPOSED",
      message: `The prescription was converted to a ${sign} cylinder (${formatDiopters(form.sphere)} / ${formatDiopters(form.cylinder)}${form.axis === null ? "" : ` x ${form.axis}`}) to compare it with this lens.`,
      data: { sign, sphere: form.sphere, cylinder: form.cylinder, axis: form.axis },
    });
  }

  const sphere = centi(form.sphere);
  const cylinder = centi(form.cylinder);
  if (outside(sphere, lens.sphereMin, lens.sphereMax)) {
    reasons.push({
      code: "SPHERE_OUT_OF_RANGE",
      message: `Sphere ${formatDiopters(form.sphere)} is outside this lens's range (${describeRange(lens.sphereMin, lens.sphereMax)}).`,
      data: { sphere: form.sphere, min: lens.sphereMin, max: lens.sphereMax },
    });
  }
  if (outside(cylinder, lens.cylinderMin, lens.cylinderMax)) {
    reasons.push({
      code: "CYLINDER_OUT_OF_RANGE",
      message: `Cylinder ${formatDiopters(form.cylinder)} is outside this lens's range (${describeRange(lens.cylinderMin, lens.cylinderMax)}).`,
      data: { cylinder: form.cylinder, min: lens.cylinderMin, max: lens.cylinderMax },
    });
  }
  const strongest = strongestMeridian(eyeData.sphere, eyeData.cylinder);
  if (lens.combinedLimit !== null && centi(strongest) > centi(lens.combinedLimit)) {
    reasons.push({
      code: "COMBINED_LIMIT_EXCEEDED",
      message: `The strongest meridian (${strongest.toFixed(2)}) is above this lens's limit of ${lens.combinedLimit.toFixed(2)}.`,
      data: { strongestMeridian: strongest, limit: lens.combinedLimit },
    });
  }

  // The add, for the designs that have one.
  const add = eyeData.add !== null && eyeData.add > 0 ? eyeData.add : null;
  if (needsAdd(lens)) {
    if (add === null) {
      const other = otherEyeAdd !== null && otherEyeAdd > 0 ? ` The other eye has an add of ${formatDiopters(otherEyeAdd)}: enter it for this eye too if it applies.` : "";
      reasons.push({ code: "ADD_REQUIRED", message: `This lens needs an add and the prescription has none for this eye.${other}`, data: { otherEyeAdd } });
    } else if (outside(centi(add), lens.addMin, lens.addMax)) {
      reasons.push({
        code: "ADD_OUT_OF_RANGE",
        message: `Add ${formatDiopters(add)} is outside this lens's range (${describeRange(lens.addMin, lens.addMax)}).`,
        data: { add, min: lens.addMin, max: lens.addMax },
      });
    }
    // The fitting height, for the designs that need one.
    if (lens.minFittingHeight !== null) {
      if (eyeData.fittingHeight === null) {
        notes.push({
          code: "FITTING_HEIGHT_UNKNOWN",
          message: `Measure the fitting height: this lens needs at least ${mm(lens.minFittingHeight)}.`,
          data: { min: lens.minFittingHeight },
        });
      } else if (centi(eyeData.fittingHeight) < centi(lens.minFittingHeight)) {
        reasons.push({
          code: "FITTING_HEIGHT_TOO_LOW",
          message: `The fitting height (${mm(eyeData.fittingHeight)}) is below the ${mm(lens.minFittingHeight)} this lens needs.`,
          data: { fittingHeight: eyeData.fittingHeight, min: lens.minFittingHeight },
        });
      }
    }
  } else if (add !== null) {
    notes.push({
      code: "ADD_NOT_CORRECTED",
      message: `Single vision: the add (${formatDiopters(add)}) is not corrected; this lens serves one distance.`,
      data: { add },
    });
  }

  if (!hasAnyLimit(lens)) {
    notes.push({ code: "LIMITS_UNKNOWN", message: "No limits are recorded for this lens, so it is assumed to fit.", data: {} });
  }
  if (!lens.isActive) notes.push({ code: "RETIRED", message: "This lens is retired.", data: {} });
  return { reasons, notes };
}

/**
 * The order a screen should list the lenses that fit, best first: the designs that correct what the prescription asks for (a prescription with an add:
 * the designs with an add first, single vision after; without an add: single vision first), then the cheaper, then by name.
 */
function sortFits(fits: LensFit[], hasAdd: boolean): LensFit[] {
  const rank = (fit: LensFit) => (needsAdd(fit.lens) === hasAdd ? 0 : 1);
  return [...fits].sort((a, b) => rank(a) - rank(b) || a.lens.priceCents - b.lens.priceCents || a.lens.name.localeCompare(b.lens.name) || a.lensId.localeCompare(b.lensId));
}

function matchEye(eye: Eye, input: PrescriptionInput, lenses: readonly LensLike[], options: MatchOptions): EyeMatch {
  const data = readEye(input, eye);
  const otherAddParsed = parse(input[eye === "right" ? "leftAdd" : "rightAdd"]);
  const otherEyeAdd = otherAddParsed.ok ? otherAddParsed.value : null;
  const result: EyeMatch = {
    eye,
    status: data.status,
    problems: data.problems,
    warnings: data.warnings,
    power: null,
    fittingHeight: data.fittingHeight,
    available: [],
    unavailable: [],
  };
  if (data.status !== "ok") return result;

  const given: CylinderForm = { sphere: data.sphere, cylinder: data.cylinder, axis: data.axis };
  result.power = {
    ...given,
    add: data.add !== null && data.add > 0 ? data.add : null,
    strongestMeridian: strongestMeridian(data.sphere, data.cylinder),
    minusCylinder: toMinusCylinder(given),
    plusCylinder: toPlusCylinder(given),
  };

  const fits: LensFit[] = [];
  for (const lens of lenses) {
    if (!lens.isActive && !options.includeRetired) continue;
    const { reasons, notes } = checkLens(data, otherEyeAdd, lens);
    const retired = !lens.isActive;
    if (reasons.length > 0) result.unavailable.push({ lensId: lens.id, lens, reasons, retired });
    else fits.push({ lensId: lens.id, lens, notes, retired });
  }
  result.available = sortFits(fits, result.power.add !== null);
  return result;
}

/**
 * Which of `lenses` can be made for each eye of `prescription`, and for both. Never throws: a value that cannot be read marks that eye "invalid" and
 * says what is wrong. Does not change its arguments.
 */
export function matchLenses(prescription: PrescriptionInput, lenses: readonly LensLike[], options: MatchOptions = {}): LensMatch {
  const input = prescription ?? {};
  const right = matchEye("right", input, lenses, options);
  const left = matchEye("left", input, lenses, options);
  const leftById = new Map(left.available.map((fit) => [fit.lensId, fit]));
  const bothEyes: BothEyesFit[] = [];
  for (const fit of right.available) {
    const other = leftById.get(fit.lensId);
    if (other) bothEyes.push({ lensId: fit.lensId, lens: fit.lens, right: fit, left: other });
  }
  return { right, left, bothEyes };
}
