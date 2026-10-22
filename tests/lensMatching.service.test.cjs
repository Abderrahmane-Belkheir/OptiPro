// localLensService.availableFor against the real local database: a saved prescription (by id) or a draft object, the shop's own lenses only, retired ones
// left out unless asked for, bad arguments refused, and nothing written.
const path = require("node:path");
const { sandbox, runScript, recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-lensmatch-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = (key) => ({ tenantKey: key, synced: true });
  await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S('t1') } });
  await p.customer.create({ data: { id: 'c2', name: 'Other shop customer', ...S('t2') } });
  const rx = (id, customerId, key, over) => p.prescription.create({ data: { id, customerId, prescribedAt: new Date('2026-01-10T00:00:00Z'), ...over, ...S(key) } });
  await rx('rx1', 'c1', 't1', { rightSphere: -2, rightCylinder: -0.5, rightAxis: 90, leftSphere: 1, leftAdd: 2, rightAdd: 2, fittingHeightRight: 20, fittingHeightLeft: 20 });
  await rx('rx2', 'c2', 't2', { rightSphere: -1 });
  const lens = (id, name, key, over) => p.lens.create({ data: { id, name, ...over, ...S(key) } });
  await lens('sv', 'SV 1.5', 't1', { sphereMin: -6, sphereMax: 4, cylinderMin: -2, cylinderMax: 0, priceCents: 5000 });
  await lens('prog', 'Progressive', 't1', { design: 'progressive', sphereMin: -8, sphereMax: 6, cylinderMin: -4, cylinderMax: 0, addMin: 0.75, addMax: 3.5, minFittingHeight: 18, priceCents: 20000 });
  await lens('old', 'Retired SV', 't1', { isActive: false, sphereMin: -6, sphereMax: 4, priceCents: 2000 });
  await lens('other', 'Other shop lens', 't2', { priceCents: 100 });

  const L = require(ROOT + '/dist/local/index.js');
  const ids = (list) => list.map((x) => x.lensId).join();
  const before = { lenses: await p.lens.count(), prescriptions: await p.prescription.count() };
  const out = {};
  const saved = await L.localLensService.availableFor('rx1');
  out.saved = { right: ids(saved.right.available), left: ids(saved.left.available), both: ids(saved.bothEyes), rightStatus: saved.right.status, rightNote: saved.right.available.map((a) => a.notes.map((n) => n.code).join('+')).join('|') };
  const draft = await L.localLensService.availableFor({ rightSphere: -2, rightCylinder: '-0,50', rightAxis: 90 });
  out.draft = { right: ids(draft.right.available), leftStatus: draft.left.status };
  const withRetired = await L.localLensService.availableFor('rx1', { includeRetired: true });
  out.retired = { right: ids(withRetired.right.available), flag: withRetired.right.available.find((a) => a.lensId === 'old')?.retired };
  out.noOptions = ids((await L.localLensService.availableFor('rx1', undefined)).right.available);
  out.errors = {};
  for (const [name, arg] of Object.entries({ unknownId: 'nope', otherShopsPrescription: 'rx2', number: 42, nothing: null, list: [] })) {
    out.errors[name] = await L.localLensService.availableFor(arg).then(() => 'accepted', (e) => e.kind);
  }
  out.nothingWritten = (await p.lens.count()) === before.lenses && (await p.prescription.count()) === before.prescriptions;
  out.sameAsPure = JSON.stringify(saved) === JSON.stringify(L.matchLenses(await p.prescription.findFirst({ where: { id: 'rx1' } }), await L.localLensService.list()));
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("a saved prescription, by id");
R.ck(r.saved.rightStatus === "ok", "the prescription is found and read");
R.ck(r.saved.right === "prog,sv" && r.saved.rightNote === "|ADD_NOT_CORRECTED", "right eye (-2.00 / -0.50 x 90, add +2.00, height 20): the progressive first, then the single vision lens (flagged: the add is not corrected)", `${r.saved.right} ${r.saved.rightNote}`);
R.ck(r.saved.left === "prog,sv" && r.saved.both === "prog,sv", "left eye (+1.00, add +2.00): both lenses; and both are available for both eyes");
R.ck(!r.saved.right.includes("other"), "only the shop's own lenses are looked at (the other shop's lens never appears)");
R.ck(!r.saved.right.includes("old"), "the retired lens is left out");
R.ck(r.retired.right === "prog,old,sv" || r.retired.right.split(",").sort().join() === "old,prog,sv", "includeRetired brings it back", r.retired.right);
R.ck(r.retired.flag === true, "marked as retired");
R.ck(r.noOptions === r.saved.right, "no options at all is the same as the defaults");
R.ck(r.sameAsPure === true, "the service gives exactly what the pure function gives for the same prescription and lenses");

R.section("a draft object");
R.ck(r.draft.right === "sv" && r.draft.leftStatus === "not-prescribed", "an unsaved object works (typed text like '-0,50' too); the left eye has nothing prescribed");

R.section("bad arguments, and nothing written");
R.ck(r.errors.unknownId === "not-found", "an unknown id is a not-found error");
R.ck(r.errors.otherShopsPrescription === "not-found", "another shop's prescription is not found either");
R.ck(r.errors.number === "invalid-input" && r.errors.nothing === "invalid-input" && r.errors.list === "invalid-input", "a number, nothing, or a list is refused (invalid-input)");
R.ck(r.nothingWritten === true, "no lens and no prescription was created or changed");

R.section("it is on the list of what the window may call");
const { API_METHODS } = require(path.join(ROOT, "dist", "ipc", "channels.js"));
R.ck(API_METHODS.lenses.includes("availableFor"), "lenses.availableFor is exposed to the window (no screen uses it yet)");
process.exit(R.done());
