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
R.ck(created.columns.join() === "id,expires_at,shop_name,instagram_url,tiktok_url,phone,email,address,synced,created_at,updated_at", "a new database has the table license_expiry (id, expires_at, the shop's name, instagram, tiktok, phone, email, address, synced, created_at, updated_at)", String(created.columns));
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

R.section("the shop's details");
const shop = run(`
  const out = {};
  const { localLicenseService } = require(ROOT + '/dist/local/index.js');
  await p.licenseExpiry.deleteMany();
  out.none = await localLicenseService.getShop();
  await localLicenseService.setExpiry('2026-11-04');
  out.dayOnly = await localLicenseService.getShop();
  await localLicenseService.setExpiry('2026-11-04', { name: '  Optique   Soleil ', phone: '0550 12 34 56', email: 'contact@soleil.dz', address: '12 Rue Didouche Mourad,\\nAlger', instagramUrl: 'https://instagram.com/soleil', tiktokUrl: '', unknown: 'x' });
  out.saved = await localLicenseService.getShop();
  out.row = await p.licenseExpiry.findUnique({ where: { id: 1 } });
  await localLicenseService.setExpiry('2027-02-01');
  out.afterDayOnly = await localLicenseService.getShop();
  out.day = await localLicenseService.getExpiry();
  await localLicenseService.setExpiry('2027-02-01', { name: 'New Name' });
  out.replaced = await localLicenseService.getShop();
  out.rows = await p.licenseExpiry.count();
`);
R.ck(shop.none === null && shop.dayOnly === null, "no details until they are saved (getShop is null)");
R.ck(shop.saved?.name === "Optique Soleil" && shop.saved?.phone === "0550 12 34 56" && shop.saved?.email === "contact@soleil.dz" && shop.saved?.instagramUrl === "https://instagram.com/soleil", "setExpiry with the shop's details stores them (name tidied)", JSON.stringify(shop.saved));
R.ck(shop.saved?.address === "12 Rue Didouche Mourad, Alger" && shop.saved?.tiktokUrl === null, "each is one line, and an empty one is stored as nothing");
R.ck(shop.row?.shopName === "Optique Soleil" && shop.row?.instagramUrl === "https://instagram.com/soleil" && shop.row?.id === 1, "in the columns of the licence row");
R.ck(shop.afterDayOnly?.name === "Optique Soleil" && shop.day === "2027-02-01", "a later check that only moves the day leaves the details alone");
R.ck(shop.replaced?.name === "New Name" && shop.replaced?.phone === null && shop.rows === 1, "registering again replaces the details (still one row)");

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
// a database that has the table from before the shop's details: it gets the columns, and keeps its day
run(`
  const out = {};
  await p.$executeRawUnsafe('DROP TABLE "license_expiry"');
  await p.$executeRawUnsafe('CREATE TABLE "license_expiry" ("id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1, "expires_at" DATETIME NOT NULL, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME NOT NULL)');
  await p.$executeRawUnsafe("INSERT INTO license_expiry (id, expires_at, updated_at) VALUES (1, '2030-05-06 00:00:00', '2026-01-01 00:00:00')");
`);
const upgraded = run(`
  const out = {};
  out.columns = (await p.$queryRawUnsafe('PRAGMA table_info("license_expiry")')).map((c) => c.name).sort().join();
  const { localLicenseService } = require(ROOT + '/dist/local/index.js');
  out.day = await localLicenseService.getExpiry();
  out.shop = await localLicenseService.getShop();
`);
R.ck(upgraded.columns.includes("shop_name") && upgraded.columns.includes("instagram_url") && upgraded.columns.includes("tiktok_url") && upgraded.columns.includes("phone") && upgraded.columns.includes("email") && upgraded.columns.includes("address"), "a table made before the shop's details gets their columns the next time the app starts", upgraded.columns);
R.ck(upgraded.day === "2030-05-06" && upgraded.shop === null, "and keeps its day (no details yet)");

R.section("local only");
const columns = fs.readFileSync(path.join(ROOT, "cloudflare", "src", "tableColumns.js"), "utf8") + fs.readFileSync(path.join(ROOT, "backend", "src", "lib", "tableColumns.js"), "utf8");
R.ck(!/license_expiry|licenseExpiry/.test(columns), "the table API (server and Worker) does not know it: it is never sent");
const schema = fs.readFileSync(path.join(ROOT, "prisma", "sqlite", "schema.prisma"), "utf8");
const model = /model LicenseExpiry \{[\s\S]*?\n\}/.exec(schema)[0];
R.ck(!/tenantKey/.test(model), "and it has no tenant_key (it is this computer's one row; its `synced` only says whether the shop's details reached the server, through POST /api/infos)");
process.exit(R.done());
