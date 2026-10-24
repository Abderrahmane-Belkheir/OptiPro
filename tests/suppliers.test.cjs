// The suppliers directory: the rules for a supplier (src/local/supplierValidation.ts), then the service against a real local database (create, edit,
// retire, delete, the shop's own rows only, a duplicate name refused, and the row syncing like the others).
const path = require("node:path");
const { sandbox, runScript, recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const { validateSupplierForm, kindsOf, SUPPLIER_KINDS } = require(path.join(ROOT, "dist", "local", "supplierValidation.js"));
const bad = (form) => validateSupplierForm(form).errors ?? null;
const good = (form) => validateSupplierForm(form).supplier ?? null;

R.section("the rules");
R.ck(bad({})?.name === "Give the supplier's name." && bad({ name: "   " })?.name && bad({ name: 42 })?.name, "a name is required (and must be text)");
R.ck(good({ name: "  Essilor   Algérie " })?.name === "Essilor Algérie", "spaces are tidied");
R.ck(bad({ name: "x".repeat(121) })?.name && good({ name: "x".repeat(120) }) !== null, "a name is at most 120 characters");
const only = good({ name: "Lab" });
R.ck(only.kinds === "" && only.isActive === true && only.phone === null && only.email === null && only.notes === null && only.contactName === null && only.address === null, "everything else is optional: a name alone is a supplier (active, supplying nothing in particular)");
R.ck(good({ name: "A", kinds: ["accessories", "lenses", "lenses"] })?.kinds === "lenses,accessories" && good({ name: "A", kinds: "frames, accessories" })?.kinds === "frames,accessories", "kinds: a list or a comma-separated text, in a fixed order, no repeats");
R.ck(good({ name: "A", kinds: ["lab"] })?.kinds === "lenses" && good({ name: "A", kinds: ["lab", "lenses"] })?.kinds === "lenses", "a lab is a supplier of lenses: the old kind \"lab\" means lenses, and ticking both is one");
R.ck(bad({ name: "A", kinds: ["lenses", "tools"] })?.kinds && bad({ name: "A", kinds: 5 })?.kinds, "an unknown kind is refused");
R.ck(kindsOf("lenses,lab,nonsense,frames").join() === "lenses,frames" && kindsOf("lab").join() === "lenses" && kindsOf(null).length === 0 && SUPPLIER_KINDS.length === 4, "kindsOf reads a stored list (an old \"lab\" counts as lenses)");
R.ck(good({ name: "A", phone: "+213 (0) 550-12.34/56" })?.phone === "+213 (0) 550-12.34/56", "a phone number can have digits, spaces and + - ( ) . /");
R.ck(bad({ name: "A", phone: "call me" })?.phone && bad({ name: "A", phone: "12345" })?.phone && bad({ name: "A", phone: "0".repeat(31) })?.phone, "letters, fewer than 6 digits, or more than 30 characters are refused");
R.ck(good({ name: "A", email: "contact@essilor.dz" })?.email === "contact@essilor.dz" && bad({ name: "A", email: "contact@" })?.email && bad({ name: "A", email: "a b@c.dz" })?.email, "an email must look like one");
R.ck(bad({ name: "A", address: "x".repeat(301) })?.address && bad({ name: "A", notes: "x".repeat(2001) })?.notes && good({ name: "A", notes: "x".repeat(2000) }) !== null, "address up to 300 characters, notes up to 2000");
R.ck(bad({ name: "A", isActive: "yes" })?.isActive && good({ name: "A", isActive: false })?.isActive === false, "active is yes or no");
R.ck(Object.keys(bad({ name: "", phone: "x", email: "y", kinds: "z" })).length === 4, "every mistake is reported at once, by field");

const box = sandbox("op-suppliers-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  await p.supplier.create({ data: { id: 'other', name: 'Other shop supplier', tenantKey: 't2', synced: true } });
  const L = require(ROOT + '/dist/local/index.js');
  const S = L.localSupplierService;
  const out = {};

  const a = await S.create({ name: 'Essilor Algérie', kinds: ['lenses', 'lab'], contactName: 'M. Haddad', phone: '0550 12 34 56', email: 'h@essilor.dz', address: 'Zone industrielle, Alger', notes: 'Delivers on Sundays' });
  out.created = { status: a.status, name: a.supplier.name, kinds: a.supplier.kinds, active: a.supplier.isActive, tenant: a.supplier.tenantKey, sent: a.sentToServer, synced: a.supplier.synced };
  out.bare = (await S.create({ name: 'Bare' })).status;
  out.dup = [(await S.create({ name: ' essilor   algérie ' })).errors?.name, (await S.create({ name: 'ESSILOR ALGÉRIE' })).status];
  out.invalid = (await S.create({ name: '', phone: 'x' })).errors;
  out.countAfterRefusals = await p.supplier.count({ where: { tenantKey: 't1' } });

  const e = await S.edit(a.supplier.id, { name: 'Essilor DZ', kinds: 'lenses', phone: '0550 99 99 99' });
  out.edited = { status: e.status, name: e.supplier.name, kinds: e.supplier.kinds, phone: e.supplier.phone, contact: e.supplier.contactName, notes: e.supplier.notes, synced: e.supplier.synced };
  out.editSameName = (await S.edit(a.supplier.id, { name: 'ESSILOR DZ' })).status;
  out.editToTaken = (await S.edit(a.supplier.id, { name: 'bare' })).errors?.name;
  out.editGhost = await S.edit('ghost', { name: 'x' }).then(() => 'ok', (x) => x.kind);
  out.editOther = await S.edit('other', { name: 'x' }).then(() => 'ok', (x) => x.kind);

  const off = await S.setActive(a.supplier.id, false);
  out.retired = { active: off.isActive, stillListed: (await S.list()).some((s) => s.id === a.supplier.id) };
  out.restored = (await S.setActive(a.supplier.id, true)).isActive;
  out.setActiveBad = [await S.setActive(a.supplier.id, 'yes').then(() => 'ok', (x) => x.kind), await S.setActive('ghost', true).then(() => 'ok', (x) => x.kind)];

  out.list = (await S.list()).map((s) => s.name).join('|');
  out.get = [(await S.get(a.supplier.id))?.name, await S.get('other')];

  const del = await S.delete((await S.list()).find((s) => s.name === 'Bare').id);
  out.deleted = { status: del.status, name: del.name, sent: del.sentToServer, left: (await S.list()).map((s) => s.name).join('|'), queued: await p.pendingDeletion.count({ where: { kind: 'supplier' } }) };
  out.deleteOther = await S.delete('other').then(() => 'ok', (x) => x.kind);
  out.otherIntact = await p.supplier.count({ where: { id: 'other' } });

  const unsynced = await L.localDashboardService.syncStatus();
  out.unsynced = unsynced.unsyncedCount > 0;
  out.api = require(ROOT + '/dist/ipc/channels.js').API_METHODS.suppliers;
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("the service");
R.ck(r.created?.status === "created" && r.created?.name === "Essilor Algérie" && r.created?.kinds === "lenses" && r.created?.active === true && r.created?.tenant === "t1", "a supplier is created in this shop", JSON.stringify(r.created));
R.ck(r.created?.synced === false && r.created?.sent === false, "and waits for the server like any row (not reachable here)");
R.ck(r.bare === "created", "a name alone is enough");
R.ck(/already have a supplier/.test(r.dup?.[0] ?? "") && r.dup?.[1] === "invalid", "the same name again (other capitals, extra spaces) is refused", JSON.stringify(r.dup));
R.ck(r.invalid?.name && r.invalid?.phone && r.countAfterRefusals === 2, "a refusal saves nothing", `${JSON.stringify(r.invalid)} ${r.countAfterRefusals}`);
R.ck(r.edited?.status === "updated" && r.edited?.name === "Essilor DZ" && r.edited?.kinds === "lenses" && r.edited?.phone === "0550 99 99 99", "an edit changes the details");
R.ck(r.edited?.contact === null && r.edited?.notes === null, "(the form is the whole supplier: what it leaves empty is emptied)");
R.ck(r.edited?.synced === false, "and the row goes back to waiting for the server");
R.ck(r.editSameName === "updated" && /already have a supplier/.test(r.editToTaken ?? ""), "keeping its own name is fine; taking another supplier's is refused");
R.ck(r.editGhost === "not-found" && r.editOther === "not-found", "editing an unknown supplier, or another shop's, is not-found");
R.ck(r.retired?.active === false && r.retired?.stillListed === true && r.restored === true, "retiring keeps the supplier in the records; bringing it back works");
R.ck(r.setActiveBad?.join() === "invalid-input,not-found", "set active needs true or false and a real supplier");
R.ck(r.list === "Bare|ESSILOR DZ", "the list is by name, this shop's only", r.list);
R.ck(r.get?.[0] === "ESSILOR DZ" && r.get?.[1] === null, "get finds this shop's supplier and nothing of another's");
R.ck(r.deleted?.status === "deleted" && r.deleted?.name === "Bare" && r.deleted?.left === "ESSILOR DZ", "delete removes it", JSON.stringify(r.deleted));
R.ck(r.deleted?.sent === false && r.deleted?.queued === 1, "and queues the deletion for the server, which is not reachable here");
R.ck(r.deleteOther === "not-found" && r.otherIntact === 1, "another shop's supplier cannot be deleted");
R.ck(r.unsynced === true, "unsent suppliers count as unsynced on the dashboard");
R.ck(r.api?.join() === "list,get,create,edit,setActive,delete", "suppliers is on the list of what the window may call");
process.exit(R.done());
