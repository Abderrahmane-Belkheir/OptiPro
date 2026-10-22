// Which lenses can be made for a prescription, eye by eye (src/local/lensMatching.ts): the optics, the limits, the add, the fitting height, the sign of the
// cylinder, the numbers, the bad input. Pure logic: no database, no window.
const path = require("node:path");
const { recorder, ROOT } = require("./helpers/app.cjs");
const M = require(path.join(ROOT, "dist", "local", "lensMatching.js"));

const R = recorder();

// ---- a small catalogue ----------------------------------------------------------------------------------------------------------------
const lens = (id, name, over = {}) => ({
  id, name, design: "single_vision", material: "organic", refractiveIndex: null, priceCents: 0, isActive: true,
  sphereMin: null, sphereMax: null, cylinderMin: null, cylinderMax: null, addMin: null, addMax: null, combinedLimit: null,
  leadTimeDays: null, minFittingHeight: null, brand: null, reference: null, ...over,
});
const L = {
  sv: lens("sv", "SV 1.5", { sphereMin: -6, sphereMax: 4, cylinderMin: -2, cylinderMax: 0, combinedLimit: 6, priceCents: 5000, leadTimeDays: 3 }),
  wide: lens("wide", "SV wide", { sphereMin: -10, sphereMax: 8, cylinderMin: -4, cylinderMax: 0, combinedLimit: 10, priceCents: 9000 }),
  free: lens("free", "No limits recorded", { priceCents: 1000 }),
  prog: lens("prog", "Progressive", { design: "progressive", sphereMin: -8, sphereMax: 6, cylinderMin: -4, cylinderMax: 0, addMin: 0.75, addMax: 3.5, minFittingHeight: 18, priceCents: 20000 }),
  bif: lens("bif", "Bifocal", { design: "bifocal", sphereMin: -6, sphereMax: 6, cylinderMin: -2, cylinderMax: 0, addMin: 1, addMax: 3, priceCents: 8000 }),
  plus: lens("plus", "Plus-cylinder SV", { sphereMin: -6, sphereMax: 6, cylinderMin: 0, cylinderMax: 3, priceCents: 4000 }),
  sph: lens("sph", "Spherical only", { sphereMin: -6, sphereMax: 6, cylinderMin: 0, cylinderMax: 0, priceCents: 3000 }),
  old: lens("old", "Retired SV", { isActive: false, sphereMin: -6, sphereMax: 4, priceCents: 2000 }),
};
const ALL = [L.sv, L.wide, L.free, L.prog, L.bif, L.plus, L.sph, L.old];

const ids = (list) => list.map((x) => x.lensId).join();
const codes = (findings) => findings.map((f) => f.code).join();
const reasonsOf = (eye, id) => codes(eye.unavailable.find((x) => x.lensId === id)?.reasons ?? []);
const notesOf = (eye, id) => codes(eye.available.find((x) => x.lensId === id)?.notes ?? []);
const rx = (right = {}, left = {}, extra = {}) => ({
  rightSphere: right.s ?? null, rightCylinder: right.c ?? null, rightAxis: right.a ?? null, rightAdd: right.add ?? null,
  leftSphere: left.s ?? null, leftCylinder: left.c ?? null, leftAxis: left.a ?? null, leftAdd: left.add ?? null, ...extra,
});

// ================================================================================================================================================
R.section("a simple prescription: -2.00 / -0.50 x 90, no add");
{
  const m = M.matchLenses(rx({ s: -2, c: -0.5, a: 90 }, { s: -2, c: -0.5, a: 90 }), ALL);
  const e = m.right;
  R.ck(e.status === "ok" && e.problems.length === 0, "the eye is read");
  R.ck(ids(e.available) === "free,plus,sv,wide", "the lenses that fit, cheapest first (single vision first, as there is no add)", ids(e.available));
  R.ck(ids(e.unavailable) === "prog,bif,sph", "the ones that do not", ids(e.unavailable));
  R.ck(reasonsOf(e, "prog") === "ADD_REQUIRED" && reasonsOf(e, "bif") === "ADD_REQUIRED", "a progressive and a bifocal need an add, and say so");
  R.ck(reasonsOf(e, "sph") === "CYLINDER_OUT_OF_RANGE", "a spherical-only lens cannot take a cylinder");
  R.ck(!ids(e.available).includes("old") && !ids(e.unavailable).includes("old"), "the retired lens is not considered at all");
  R.ck(notesOf(e, "free") === "LIMITS_UNKNOWN", "a lens with no limits recorded is allowed but flagged as unverified");
  R.ck(notesOf(e, "sv") === "" && notesOf(e, "wide") === "", "a lens that clearly fits has no notes");
  R.ck(e.power.sphere === -2 && e.power.cylinder === -0.5 && e.power.axis === 90 && e.power.add === null && e.power.strongestMeridian === 2.5, "the power is echoed, with its strongest meridian (2.50)");
  R.ck(JSON.stringify(e.power.plusCylinder) === JSON.stringify({ sphere: -2.5, cylinder: 0.5, axis: 180 }), "and the same prescription written with a plus cylinder (-2.50 / +0.50 x 180)");
  const plusNote = e.available.find((x) => x.lensId === "plus").notes.find((n) => n.code === "CYLINDER_TRANSPOSED");
  R.ck(plusNote && plusNote.data.sign === "plus" && plusNote.data.sphere === -2.5 && plusNote.data.cylinder === 0.5 && plusNote.data.axis === 180, "a plus-cylinder lens is compared in plus cylinder, and the result says the prescription was converted");
  R.ck(ids(m.bothEyes) === "free,plus,sv,wide" && m.bothEyes[0].right.lensId === "free" && m.bothEyes[0].left.lensId === "free", "both eyes: the lenses that fit each eye");
}

R.section("the limits are inclusive, and exact on the number");
{
  const at = (s, c = 0) => M.matchLenses(rx({ s, c, a: c ? 90 : null }), [L.sv]).right;
  R.ck(ids(at(-6).available) === "sv" && ids(at(4).available) === "sv", "a sphere exactly on the lowest and the highest limit fits (-6.00, +4.00)");
  R.ck(reasonsOf(at(-6.25), "sv") === "SPHERE_OUT_OF_RANGE,COMBINED_LIMIT_EXCEEDED" && reasonsOf(at(4.25), "sv") === "SPHERE_OUT_OF_RANGE", "a quarter diopter beyond does not (-6.25: sphere, and its strongest meridian 6.25 is past the combined limit of 6.00 too; +4.25: sphere)");
  R.ck(ids(at(-4, -2).available) === "sv", "a cylinder exactly on the limit fits (-2.00)");
  R.ck(reasonsOf(at(-3, -2.25), "sv") === "CYLINDER_OUT_OF_RANGE", "a cylinder of -2.25 does not");
  R.ck(reasonsOf(at(-5, -2), "sv") === "COMBINED_LIMIT_EXCEEDED", "the strongest meridian is checked on its own: -5.00 / -2.00 is 7.00, above the limit of 6.00 (the sphere and the cylinder are each fine)");
  R.ck(ids(at(-4, -2).available) === "sv", "-4.00 / -2.00 is exactly 6.00: it fits");
  const free = M.matchLenses(rx({ s: -1.1, c: -2.2, a: 10 }), [lens("f", "F", { combinedLimit: 3.3, sphereMin: -1.1 })]).right;
  R.ck(ids(free.available) === "f", "floating point does not decide: -1.1 + -2.2 is -3.3000000000000003 in code, and still fits a limit of 3.30 (and a sphere of -1.10 fits a lowest limit of -1.10)");
  R.ck(M.strongestMeridian(-1.1, -2.2) === 3.3, "strongestMeridian(-1.1, -2.2) is exactly 3.3");
  const open = M.matchLenses(rx({ s: 9 }), [lens("a", "only a top", { sphereMax: 10 }), lens("b", "only a bottom", { sphereMin: 10 })]).right;
  R.ck(ids(open.available) === "a" && reasonsOf(open, "b") === "SPHERE_OUT_OF_RANGE", "a limit on one side only works (up to +10.00; from +10.00 up)");
}

R.section("a high prescription");
{
  const e = M.matchLenses(rx({ s: -7, c: -1, a: 180 }), ALL).right;
  R.ck(reasonsOf(e, "sv") === "SPHERE_OUT_OF_RANGE,COMBINED_LIMIT_EXCEEDED", "every reason is given, not only the first (sphere and strongest meridian)");
  R.ck(ids(e.available) === "free,wide", "the wide-range lens fits -7.00 / -1.00 (strongest meridian 8.00 within its 10.00)", ids(e.available));
  R.ck(reasonsOf(e, "plus") === "SPHERE_OUT_OF_RANGE", "the plus-cylinder lens sees it as -8.00 / +1.00 x 90 and its sphere is out");
  R.ck(reasonsOf(e, "sph") === "SPHERE_OUT_OF_RANGE,CYLINDER_OUT_OF_RANGE", "the spherical-only lens: both");
  const two = M.matchLenses(rx({ s: -9, c: -3, a: 10 }), [L.prog]).right;
  R.ck(reasonsOf(two, "prog") === "SPHERE_OUT_OF_RANGE,ADD_REQUIRED", "reasons of different kinds add up (sphere too low, and no add)");
}

R.section("the add and the design");
{
  const withAdd = M.matchLenses(rx({ s: 1, add: 2 }, { s: 1, add: 2 }, { fittingHeightRight: 20, fittingHeightLeft: 20 }), ALL);
  const e = withAdd.right;
  R.ck(ids(e.available) === "bif,prog,free,sph,plus,sv,wide", "with an add, the designs that correct it come first, then single vision", ids(e.available));
  R.ck(notesOf(e, "sv") === "ADD_NOT_CORRECTED" && notesOf(e, "bif") === "" && notesOf(e, "prog") === "", "single vision is allowed with an add but flagged: the add is not corrected");
  R.ck(e.power.add === 2, "the add is echoed");
  const adds = (value) => M.matchLenses(rx({ s: 0, add: value }, {}, { fittingHeightRight: 20 }), [L.prog, L.bif]).right;
  R.ck(ids(adds(0.75).available) === "prog", "an add exactly on the lowest limit of the progressive (0.75) fits; the bifocal (from 1.00) does not");
  R.ck(reasonsOf(adds(0.75), "bif") === "ADD_OUT_OF_RANGE", "the bifocal's reason is the add out of range");
  R.ck(ids(adds(3.5).available) === "prog" && reasonsOf(adds(3.5), "bif") === "ADD_OUT_OF_RANGE", "3.50 fits the progressive (up to 3.50), not the bifocal (up to 3.00)");
  R.ck(reasonsOf(adds(4), "prog") === "ADD_OUT_OF_RANGE", "4.00 is above the progressive's 3.50");
  R.ck(reasonsOf(adds(0.5), "prog") === "ADD_OUT_OF_RANGE", "0.50 is below the progressive's 0.75");
  const zero = M.matchLenses(rx({ s: 0, add: 0 }), [L.prog, L.sv]).right;
  R.ck(reasonsOf(zero, "prog") === "ADD_REQUIRED" && notesOf(zero, "sv") === "" && zero.power.add === null, "an add of 0 counts as no add");
  const custom = M.matchLenses(rx({ s: 0 }), [lens("deg", "Degressive", { design: "degressive" })]).right;
  R.ck(reasonsOf(custom, "deg") === "ADD_REQUIRED", "any design other than single vision needs an add (a degressive lens too)");
  const hint = M.matchLenses(rx({ s: 0 }, { s: 0, add: 2 }), [L.prog]).right;
  R.ck(/The other eye has an add of \+2\.00/.test(hint.unavailable[0].reasons[0].message), "when only the other eye has an add, the message says so (the add is not copied across)");
  R.ck(M.matchLenses(rx({ s: 0, add: 2 }, { s: 0 }), [L.prog]).left.unavailable[0].reasons[0].code === "ADD_REQUIRED", "and the eye without an add is refused by the progressive");
}

R.section("the fitting height");
{
  const prog = (h, extra) => M.matchLenses(rx({ s: 0, add: 2 }, { s: 0, add: 2 }, { fittingHeightRight: h, ...extra }), [L.prog]);
  R.ck(reasonsOf(prog(16).right, "prog") === "FITTING_HEIGHT_TOO_LOW", "a fitting height below the lens's minimum (16 mm, minimum 18) excludes it");
  R.ck(ids(prog(18).right.available) === "prog", "exactly the minimum fits (18 mm)");
  R.ck(ids(prog(17.5).right.available) === "" && ids(prog(18.5).right.available) === "prog", "half millimetres count (17.5 no, 18.5 yes)");
  R.ck(notesOf(prog(undefined).right, "prog") === "FITTING_HEIGHT_UNKNOWN", "an unknown height does not exclude: it asks for the height to be measured");
  const both = prog(16, { fittingHeightLeft: 22 });
  R.ck(reasonsOf(both.right, "prog") === "FITTING_HEIGHT_TOO_LOW" && ids(both.left.available) === "prog", "each eye has its own height");
  R.ck(ids(both.bothEyes) === "", "so the lens is not available for both");
  const sv = M.matchLenses(rx({ s: 0 }, {}, { fittingHeightRight: 5 }), [lens("v", "SV with a stray minimum", { minFittingHeight: 30 })]).right;
  R.ck(ids(sv.available) === "v", "a single vision lens has no fitting height to meet");
}

R.section("the sign of the cylinder");
{
  R.ck(M.transposeAxis(90) === 180 && M.transposeAxis(180) === 90 && M.transposeAxis(0) === 90 && M.transposeAxis(45) === 135 && M.transposeAxis(135) === 45 && M.transposeAxis(1) === 91 && M.transposeAxis(91) === 1, "the axis moves 90 degrees and stays in 1..180 (0 is 180)");
  const t = M.toMinusCylinder({ sphere: 1, cylinder: 1, axis: 30 });
  R.ck(t.sphere === 2 && t.cylinder === -1 && t.axis === 120, "+1.00 / +1.00 x 30 is +2.00 / -1.00 x 120");
  R.ck(JSON.stringify(M.toPlusCylinder(t)) === JSON.stringify({ sphere: 1, cylinder: 1, axis: 30 }), "and back again, exactly");
  R.ck(JSON.stringify(M.toMinusCylinder({ sphere: -1, cylinder: -1, axis: 10 })) === JSON.stringify({ sphere: -1, cylinder: -1, axis: 10 }), "a minus cylinder is already a minus cylinder");
  R.ck(M.toMinusCylinder({ sphere: 1, cylinder: 1, axis: null }).axis === null, "an unknown axis stays unknown");
  R.ck(Object.is(M.toMinusCylinder({ sphere: 1, cylinder: 0, axis: null }).cylinder, 0), "no cylinder stays 0 (never -0)");
  const e = M.matchLenses(rx({ s: 1, c: 1, a: 30 }), [L.sv, L.plus]).right;
  R.ck(ids(e.available) === "plus,sv", "a plus-cylinder prescription fits a minus-cylinder lens once converted");
  const note = e.available.find((x) => x.lensId === "sv").notes[0];
  R.ck(note.code === "CYLINDER_TRANSPOSED" && note.data.sign === "minus" && note.data.sphere === 2 && note.data.cylinder === -1 && note.data.axis === 120, "and the note gives the converted prescription (+2.00 / -1.00 x 120)");
  R.ck(notesOf(e, "plus") === "", "the plus-cylinder lens needs no conversion: no note");
  R.ck(M.lensCylinderSign({ cylinderMin: 0, cylinderMax: 3 }) === "plus" && M.lensCylinderSign({ cylinderMin: 1, cylinderMax: 3 }) === "plus", "a lens whose cylinder starts at 0 or above and goes up is a plus-cylinder lens");
  R.ck(["-4,0", "null,null", "0,0", "null,3", "-2,2"].every((p) => M.lensCylinderSign({ cylinderMin: p.split(",")[0] === "null" ? null : Number(p.split(",")[0]), cylinderMax: p.split(",")[1] === "null" ? null : Number(p.split(",")[1]) }) === "minus"), "every other lens is read as minus (the usual)");
}

R.section("what is missing or wrong in the prescription");
{
  const m = M.matchLenses(rx({ s: -2, c: -0.5, a: 90 }), ALL);
  R.ck(m.left.status === "not-prescribed" && m.left.available.length === 0 && m.left.unavailable.length === 0 && m.left.power === null, "an eye with nothing prescribed is not checked");
  R.ck(m.bothEyes.length === 0 && m.right.available.length > 0, "the other eye still is, and nothing is available for both");
  const none = M.matchLenses(null, ALL);
  R.ck(none.right.status === "not-prescribed" && none.left.status === "not-prescribed", "no prescription at all: both eyes not prescribed (nothing throws)");
  const planoCyl = M.matchLenses(rx({ c: -1, a: 180 }), [L.sv]).right;
  R.ck(planoCyl.status === "ok" && planoCyl.power.sphere === 0 && codes(planoCyl.warnings) === "SPHERE_ASSUMED_PLANO" && ids(planoCyl.available) === "sv", "an empty sphere with a cylinder is taken as plano, with a warning");
  const noAxis = M.matchLenses(rx({ s: -1, c: -1 }), [L.sv]).right;
  R.ck(codes(noAxis.warnings) === "AXIS_MISSING" && ids(noAxis.available) === "sv", "a cylinder without an axis still lists the lenses, with a warning that the axis is needed to make it");
  R.ck(codes(M.matchLenses(rx({ s: -1, c: 0, a: 90 }), [L.sv]).right.warnings) === "", "an axis with no cylinder is harmless");
  const strings = M.matchLenses(rx({ s: "-1,25", c: " -0,50 ", a: "90", add: "+2" }), [L.prog, L.sv]).right;
  R.ck(strings.status === "ok" && strings.power.sphere === -1.25 && strings.power.cylinder === -0.5 && strings.power.axis === 90 && strings.power.add === 2, "typed text is read (-1,25  +2  with spaces)");
  const empty = M.matchLenses(rx({ s: "", c: "  " }), [L.sv]).right;
  R.ck(empty.status === "not-prescribed", "empty text is the same as nothing");
  const bad = [
    ["a sphere above +20", { s: 25 }],
    ["a sphere that is not a number", { s: "abc" }],
    ["NaN", { s: NaN }],
    ["Infinity", { s: Infinity }],
    ["a cylinder above 10", { s: 1, c: 11 }],
    ["an axis above 180", { s: 1, c: -1, a: 200 }],
    ["an axis that is not whole", { s: 1, c: -1, a: 90.5 }],
    ["a negative add", { s: 1, add: -1 }],
    ["an add above 4", { s: 1, add: 5 }],
    ["an object where a number is expected", { s: {} }],
    ["a boolean", { s: true }],
    ["an add with no sphere or cylinder", { add: 2 }],
  ];
  for (const [label, eye] of bad) {
    const r = M.matchLenses(rx(eye, { s: -1 }), ALL);
    R.ck(r.right.status === "invalid" && r.right.problems.length > 0 && r.right.available.length === 0 && r.right.unavailable.length === 0 && r.left.status === "ok", `${label}: that eye is invalid with a message, and no lens is offered; the other eye is unaffected`);
  }
  R.ck(M.matchLenses(rx({ s: 1 }, {}, { fittingHeightRight: 3 }), ALL).right.status === "invalid", "a fitting height of 3 mm is invalid (5 to 45)");
}

R.section("retired lenses");
{
  const m = M.matchLenses(rx({ s: -2 }), ALL, { includeRetired: true }).right;
  const old = m.available.find((x) => x.lensId === "old");
  R.ck(old && old.retired === true && codes(old.notes).includes("RETIRED"), "asked for, a retired lens is considered, marked retired, with a note");
  const far = M.matchLenses(rx({ s: -9 }), ALL, { includeRetired: true }).right;
  R.ck(far.unavailable.find((x) => x.lensId === "old")?.retired === true, "and a retired lens that does not fit says it is retired too");
  R.ck(!ids(M.matchLenses(rx({ s: -2 }), ALL, { includeRetired: false }).right.available).includes("old"), "by default it is left out");
}

R.section("both eyes");
{
  const m = M.matchLenses(rx({ s: -2, c: -0.5, a: 90 }, { s: 5, c: -0.5, a: 90 }), ALL);
  R.ck(ids(m.right.available) === "free,plus,sv,wide" && ids(m.left.available) === "free,plus,wide", "a +5.00 left eye is too much for the SV 1.5 (up to +4.00)", `${ids(m.right.available)} | ${ids(m.left.available)}`);
  R.ck(ids(m.bothEyes) === "free,plus,wide", "only the lenses that fit both eyes are offered for both, in the right eye's order");
  R.ck(m.bothEyes.every((b) => b.right.lens === b.left.lens && b.lens === b.right.lens), "each carries the lens and its result for each eye");
}

R.section("order, purity");
{
  const tie = M.matchLenses(rx({ s: 0 }), [lens("b", "Bravo", { priceCents: 100 }), lens("a", "Alpha", { priceCents: 100 }), lens("c", "Charlie", { priceCents: 50 })]).right;
  R.ck(ids(tie.available) === "c,a,b", "cheaper first; the same price by name");
  R.ck(ids(M.matchLenses(rx({ s: 0 }), []).right.available) === "", "no lenses: nothing available, nothing thrown");
  const frozenRx = Object.freeze(rx({ s: -2, c: -0.5, a: 90 }, { s: -2 }));
  const frozenLenses = Object.freeze(ALL.map((l) => Object.freeze({ ...l })));
  let threw = false;
  let result;
  try {
    result = M.matchLenses(frozenRx, frozenLenses);
  } catch {
    threw = true;
  }
  R.ck(!threw && result.right.available[0].lens === frozenLenses.find((l) => l.id === result.right.available[0].lensId), "frozen arguments work: nothing is changed, and a result points at the very lens it was given");
  R.ck(JSON.stringify(M.matchLenses(frozenRx, frozenLenses)) === JSON.stringify(M.matchLenses(frozenRx, frozenLenses)), "the same input gives the same answer");
  R.ck(M.formatDiopters(1.25) === "+1.25" && M.formatDiopters(-2) === "-2.00" && M.formatDiopters(0) === "0.00" && M.formatDiopters(-0) === "0.00" && M.formatDiopters(0.005) === "+0.01", "powers are written as on a prescription (+1.25, -2.00, 0.00)");
}
process.exit(R.done());
