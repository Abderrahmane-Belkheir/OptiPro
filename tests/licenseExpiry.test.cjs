// The local table that holds the licence's expiry date: it exists in a new database and is added to an existing one, keeps a date, holds one row,
// and stays on this computer (the table API does not know it).
const fs = require("node:fs");
const path = require("node:path");
const { sandbox, runScript, recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-license-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
const run = (source) => JSON.parse(/RESULT (.*)/.exec(runScript(box, source + "\nconsole.log('RESULT ' + JSON.stringify(out));"))?.[1] ?? "null");

R.section("table");
const created = run(`
  const out = {};
  out.columns = (await p.$queryRawUnsafe('PRAGMA table_info("license_expiry")')).map((c) => c.name);
  out.rows = (await p.licenseExpiry.findMany()).length;
  const expires = new Date(Date.UTC(2027, 5, 30));
  const row = await p.licenseExpiry.create({ data: { expiresAt: expires } });
  out.id = row.id;
  out.back = (await p.licenseExpiry.findUnique({ where: { id: 1 } })).expiresAt.toISOString();
  out.duplicate = await p.licenseExpiry.create({ data: { id: 1, expiresAt: expires } }).then(() => false, () => true);
  const later = new Date(Date.UTC(2028, 5, 30));
  await p.licenseExpiry.update({ where: { id: 1 }, data: { expiresAt: later } });
  out.updated = (await p.licenseExpiry.findUnique({ where: { id: 1 } })).expiresAt.toISOString();
  out.count = await p.licenseExpiry.count();
`);
R.ck(created.columns.join() === "id,expires_at,created_at,updated_at", "a new database has the table license_expiry (id, expires_at, created_at, updated_at)", String(created.columns));
R.ck(created.rows === 0, "and it starts empty");
R.ck(created.id === 1 && created.back === "2027-06-30T00:00:00.000Z", "a row keeps the expiry date, and its id is 1");
R.ck(created.duplicate === true && created.count === 1, "there is only one row: a second row with the same id is refused");
R.ck(created.updated === "2028-06-30T00:00:00.000Z", "the date can be changed");

R.section("the service");
const service = run(`
  const out = {};
  const { localLicenseService } = require(ROOT + '/dist/local/index.js');
  await p.licenseExpiry.deleteMany();
  out.empty = await localLicenseService.getExpiry();
  out.set = await localLicenseService.setExpiry('2026-11-04');
  out.get = await localLicenseService.getExpiry();
  out.replaced = await localLicenseService.setExpiry('2027-01-31');
  out.rows = await p.licenseExpiry.count();
  out.bad = [];
  for (const value of ['2026-13-40', '2026-02-30', 'soon', '', null, 5, '2026-1-4']) out.bad.push(await localLicenseService.setExpiry(value).then(() => 'accepted', (e) => e.kind));
  out.after = await localLicenseService.getExpiry();
`);
R.ck(service.empty === null, "getExpiry: null when none was stored");
R.ck(service.set === "2026-11-04" && service.get === "2026-11-04", "setExpiry stores a day, getExpiry gives it back as YYYY-MM-DD");
R.ck(service.replaced === "2027-01-31" && service.rows === 1, "setting it again replaces the day (still one row)");
R.ck(service.bad.every((k) => k === "invalid-input") && service.after === "2027-01-31", "a value that is not a real day is refused and the stored day is kept", JSON.stringify(service.bad));

R.section("an existing database");
run(`
  const out = {};
  await p.$executeRawUnsafe('DROP TABLE "license_expiry"');
  out.dropped = (await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name = 'license_expiry'")).length === 0;
`);
const again = run(`
  const out = {};
  out.exists = (await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name = 'license_expiry'")).length === 1;
  out.rows = (await p.licenseExpiry.findMany()).length;
`);
R.ck(again.exists === true && again.rows === 0, "a database made before the table existed gets it the next time the app starts");

R.section("local only");
const columns = fs.readFileSync(path.join(ROOT, "cloudflare", "src", "tableColumns.js"), "utf8") + fs.readFileSync(path.join(ROOT, "backend", "src", "lib", "tableColumns.js"), "utf8");
R.ck(!/license_expiry|licenseExpiry/.test(columns), "the table API (server and Worker) does not know it: it is never sent");
const schema = fs.readFileSync(path.join(ROOT, "prisma", "sqlite", "schema.prisma"), "utf8");
const model = /model LicenseExpiry \{[\s\S]*?\n\}/.exec(schema)[0];
R.ck(!/tenantKey|synced/.test(model), "and it has no tenant_key or synced column");
process.exit(R.done());
