// The local table that holds the shop's own details (license_expiry: the name is old, it holds NO date any more: only the server knows when the licence ends).
// It exists in a new database, loses the old expires_at column in an existing one (keeping the details), holds one row, and stays on this computer.
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
  const row = await p.licenseExpiry.create({ data: {} });
  out.id = row.id;
  out.duplicate = await p.licenseExpiry.create({ data: { id: 1 } }).then(() => false, () => true);
  out.count = await p.licenseExpiry.count();
`);
R.ck(created.columns.join() === "id,shop_name,instagram_url,tiktok_url,phone,email,address,synced,created_at,updated_at", "a new database has the table license_expiry with the shop's details and NO expiry date", created.columns.join());
R.ck(created.rows === 0, "and it starts empty");
R.ck(created.id === 1 && created.duplicate === true && created.count === 1, "there is only one row (id 1): a second row with the same id is refused");

R.section("the service");
const shop = run(`
  const out = {};
  const { localLicenseService } = require(ROOT + '/dist/local/index.js');
  await p.licenseExpiry.deleteMany();
  out.none = await localLicenseService.getShop();
  await localLicenseService.ensureRow();
  out.rowAfterEnsure = await p.licenseExpiry.count();
  out.emptyRow = await localLicenseService.getShop();
  await localLicenseService.saveShop({ name: '  Optique   Soleil ', phone: '0550 12 34 56', email: 'contact@soleil.dz', address: '12 Rue Didouche Mourad,\\nAlger', instagramUrl: 'https://instagram.com/soleil', tiktokUrl: '   ' });
  out.saved = await localLicenseService.getShop();
  out.row = await p.licenseExpiry.findUnique({ where: { id: 1 } });
  await localLicenseService.ensureRow();
  out.afterEnsure = await localLicenseService.getShop();
  await localLicenseService.saveShop({ name: 'New Name' });
  out.replaced = await localLicenseService.getShop();
  out.rows = await p.licenseExpiry.count();
  out.hasOldApi = ['setExpiry', 'getExpiry'].filter((k) => k in localLicenseService);
  await p.licenseExpiry.deleteMany();
  await localLicenseService.saveShop({ name: 'Fresh' });
  out.createdBySave = (await p.licenseExpiry.findUnique({ where: { id: 1 } })).shopName;
`);
R.ck(shop.none === null && shop.rowAfterEnsure === 1 && shop.emptyRow === null, "no details until they are saved (getShop is null); ensureRow makes the row without any details");
R.ck(shop.saved?.name === "Optique Soleil" && shop.saved?.phone === "0550 12 34 56" && shop.saved?.email === "contact@soleil.dz" && shop.saved?.instagramUrl === "https://instagram.com/soleil", "saveShop stores the name, phone, email and Instagram, tidied (spaces made one)");
R.ck(shop.saved?.address === "12 Rue Didouche Mourad, Alger" && shop.saved?.tiktokUrl === null, "each is one line, and an empty one is stored as nothing");
R.ck(shop.row?.shopName === "Optique Soleil" && shop.row?.id === 1 && shop.row?.synced === true, "in the one row, marked as known by the server (the activation: the server accepted them)");
R.ck(shop.afterEnsure?.name === "Optique Soleil", "ensureRow on an existing row changes nothing");
R.ck(shop.replaced?.name === "New Name" && shop.replaced?.phone === null && shop.rows === 1, "saving again replaces the details (still one row)");
R.ck(shop.hasOldApi.length === 0, "setExpiry and getExpiry are gone: no date is kept", JSON.stringify(shop.hasOldApi));
R.ck(shop.createdBySave === "Fresh", "saveShop makes the row when there is none");

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
// a database from the version that kept the licence's end day: the old column is dropped, the details stay
run(`
  const out = {};
  await p.$executeRawUnsafe('DROP TABLE "license_expiry"');
  await p.$executeRawUnsafe('CREATE TABLE "license_expiry" ("id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1, "expires_at" DATETIME NOT NULL, "shop_name" TEXT, "instagram_url" TEXT, "tiktok_url" TEXT, "phone" TEXT, "email" TEXT, "address" TEXT, "synced" BOOLEAN NOT NULL DEFAULT true, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME NOT NULL)');
  await p.$executeRawUnsafe("INSERT INTO license_expiry (id, expires_at, shop_name, phone, synced, updated_at) VALUES (1, '2030-05-06 00:00:00', 'Maison Clair', '0550 00 00 00', 0, '2026-01-01 00:00:00')");
`);
const upgraded = run(`
  const out = {};
  out.columns = (await p.$queryRawUnsafe('PRAGMA table_info("license_expiry")')).map((c) => c.name).join();
  const { localLicenseService } = require(ROOT + '/dist/local/index.js');
  out.shop = await localLicenseService.getShop();
  out.row = await p.licenseExpiry.findUnique({ where: { id: 1 } });
  out.rows = await p.licenseExpiry.count();
  // the table works for writing again (the old column was NOT NULL: a row without it would have been refused)
  await localLicenseService.saveShop({ name: 'After', phone: '0551 11 11 11' });
  out.after = await localLicenseService.getShop();
`);
R.ck(!upgraded.columns.includes("expires_at") && upgraded.columns.split(",").length === 10, "an existing database loses the old expires_at column at the next start", upgraded.columns);
R.ck(upgraded.shop?.name === "Maison Clair" && upgraded.shop?.phone === "0550 00 00 00" && upgraded.row?.synced === false && upgraded.rows === 1, "and keeps the shop's details, the unsent mark and its one row");
R.ck(upgraded.after?.name === "After", "and the table accepts rows without a date");

R.section("local only");
const columns = fs.readFileSync(path.join(ROOT, "cloudflare", "src", "tableColumns.js"), "utf8") + fs.readFileSync(path.join(ROOT, "backend", "src", "lib", "tableColumns.js"), "utf8");
R.ck(!/license_expiry|licenseExpiry/.test(columns), "the table API (server and Worker) does not know it: it is never sent");
const schema = fs.readFileSync(path.join(ROOT, "prisma", "sqlite", "schema.prisma"), "utf8");
const model = /model LicenseExpiry \{[\s\S]*?\n\}/.exec(schema)[0];
R.ck(!/tenantKey/.test(model) && !/expiresAt/.test(model), "and it has no tenant_key and no date (it is this computer's one row; its `synced` only says whether the shop's details reached the server, through POST /api/infos)");
process.exit(R.done());
