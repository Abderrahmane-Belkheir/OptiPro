// The tracking code of an order THAT HAS A PRESCRIPTION: a random 6-digit number (100000 to 999999), different for every order of the shop, made when the order is placed, kept on this computer only
// and sent to the server with the order (the server's column lists know it: GET /api/orders/<code> finds the order with it). An older database gets the column; older orders have none.
const fs = require("node:fs");
const path = require("node:path");
const { sandbox, runScript, recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-tracking-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = (key = 't1') => ({ tenantKey: key, synced: true });
  await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S() } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, leftSphere: -1.5, ...S() } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S() } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator', brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: 1000, ...S() } });
  const L = require(ROOT + '/dist/local/index.js');
  const out = {};

  // the maker, with stand-ins for the random numbers and for "taken"
  const taken = new Set([123456, 654321]);
  const seq = [123456, 654321, 123456, 777777];
  out.maker = await L.newTrackingCode(async (c) => taken.has(c), () => seq.shift());
  out.makerSkipped = 3 - seq.length; // 123456, 654321 and 123456 again were skipped; 777777 was taken from the list
  out.exhausted = await L.newTrackingCode(async () => true, () => 100000).then(() => 'made', (e) => e.kind);
  const bounds = [];
  await L.newTrackingCode(async () => false, (min, max) => { bounds.push([min, max]); return min; });
  out.bounds = bounds[0];

  // a real server note of what an order push carries
  const bodies = [];
  const server = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => { const m = /table\\/([a-z_]+)/.exec(req.url); bodies.push({ table: m && m[1], rows: raw ? JSON.parse(raw).rows : null }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'tenant.key=t1\\nserver.url=http://127.0.0.1:' + server.address().port + '\\n');

  // many orders: every one has its own 6-digit code
  const codes = [];
  const first = await L.localOrderPlacementService.place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1' });
  out.first = { status: first.status, code: first.order.trackingCode, type: typeof first.order.trackingCode, stored: (await p.order.findFirst({ where: { id: first.order.id } })).trackingCode };
  codes.push(first.order.trackingCode);
  for (let i = 0; i < 199; i++) {
    const placed = await L.localOrderPlacementService.place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1' });
    codes.push(placed.order.trackingCode);
  }
  // orders with NO prescription (a frame sold over the counter, an accessory): no code at all
  const without = [];
  for (let i = 0; i < 5; i++) {
    const placed = await L.localOrderPlacementService.place({ customerId: 'c1', frameId: 'f1' });
    without.push({ status: placed.status, code: placed.order.trackingCode, stored: (await p.order.findFirst({ where: { id: placed.order.id } })).trackingCode });
  }
  out.without = { count: without.length, allNone: without.every((w) => w.status === 'placed' && w.code === null && w.stored === null) };
  out.withoutBlank = (await L.localOrderPlacementService.place({ customerId: 'c1', prescriptionId: '', frameId: 'f1' })).order.trackingCode;
  out.codesInDatabase = (await p.order.findMany({ where: { trackingCode: { not: null } }, select: { trackingCode: true } })).length;
  out.many = { count: codes.length, distinct: new Set(codes).size, allSixDigits: codes.every((c) => Number.isInteger(c) && c >= 100000 && c <= 999999), notCountedUp: codes.some((c, i) => i > 0 && c < codes[i - 1]) && codes.some((c, i) => i > 0 && c > codes[i - 1]) };

  // it is sent: the order pushes carry the code, as a number
  const orderBodies = bodies.filter((b) => b.table === 'orders');
  const sentRows = orderBodies.flatMap((b) => b.rows);
  const withCode = sentRows.filter((r) => r.prescriptionId);
  const withoutCode = sentRows.filter((r) => !r.prescriptionId);
  out.sent = { requests: orderBodies.length, withCode: withCode.length, withoutCode: withoutCode.length, allCarryIt: withCode.every((r) => Number.isInteger(r.trackingCode) && r.trackingCode >= 100000 && r.trackingCode <= 999999 && codes.includes(r.trackingCode)), othersNull: withoutCode.every((r) => r.trackingCode === null) };
  const { toApiRow } = require(ROOT + '/dist/local/tableSync.js');
  out.apiRow = Object.keys(toApiRow({ id: 'x', number: 'CMD-1', trackingCode: 123456, synced: false })).join();
  server.close();

  // the database refuses the same code twice for one shop, and allows it for another shop and for orders with none
  const o = (extra) => p.order.create({ data: { number: 'N' + Math.random(), tenantKey: 't1', ...extra } });
  const dup = codes[0];
  out.duplicate = await o({ trackingCode: dup }).then(() => 'accepted', () => 'refused');
  out.otherShop = await p.order.create({ data: { number: 'N' + Math.random(), tenantKey: 't2', trackingCode: dup } }).then(() => 'accepted', () => 'refused');
  await o({}); await o({});
  out.manyWithNone = await p.order.count({ where: { trackingCode: null } });

  // the order read back through the service (what the screen gets)
  const read = await L.localOrderService.get(first.order.id);
  out.read = read.trackingCode;
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("making a code");
R.ck(r.maker === 777777 && r.makerSkipped === 3, "a code that is taken is skipped and another is tried", JSON.stringify([r.maker, r.makerSkipped]));
R.ck(r.exhausted === "invalid-input", "when every try hits a taken code it gives up with an error, not an endless loop");
R.ck(JSON.stringify(r.bounds) === JSON.stringify([100000, 999999]), "the codes are asked for between 100000 and 999999", JSON.stringify(r.bounds));

R.section("only an order with a prescription");
R.ck(r.without?.count === 5 && r.without?.allNone === true, "orders placed with no prescription get no code (null, in the answer and in the database)", JSON.stringify(r.without));
R.ck(r.withoutBlank === null, "an empty prescription choice counts as none");
R.ck(r.codesInDatabase === 200, "only the 200 orders with a prescription have a code", String(r.codesInDatabase));

R.section("placing orders");
R.ck(r.first?.status === "placed" && r.first?.type === "number" && /^\d{6}$/.test(String(r.first?.code)) && r.first?.stored === r.first?.code, "an order placed gets a 6-digit number, kept in the database and in the answer", JSON.stringify(r.first));
R.ck(r.many?.count === 200 && r.many?.distinct === 200 && r.many?.allSixDigits === true, "200 orders: 200 different codes, every one of 6 digits", JSON.stringify(r.many));
R.ck(r.many?.notCountedUp === true, "they are random, not counted up (no pattern from one order to the next)");
R.ck(r.read === r.first?.code, "reading the order back gives the same code");

R.section("sent to the server");
R.ck(r.sent?.withCode === 200 && r.sent?.allCarryIt === true, "every order with a prescription sent to the server carries its tracking code (a 6-digit number, the one made here)", JSON.stringify(r.sent));
R.ck(r.sent?.withoutCode === 6 && r.sent?.othersNull === true, "the others are sent with no code (null)");
R.ck(/trackingCode/.test(r.apiRow ?? ""), "the function that makes the server's rows keeps it", r.apiRow);
for (const [name, file] of [["Worker", path.join(ROOT, "cloudflare", "src", "tableColumns.js")], ["backend", path.join(ROOT, "backend", "src", "lib", "tableColumns.js")]]) {
  const columns = fs.readFileSync(file, "utf8");
  R.ck(/"trackingCode": \{\s*"column": "tracking_code",\s*"type": "int"\s*\}/.test(columns), `the ${name}'s table API knows the column: trackingCode is the integer column tracking_code`);
}
const sql = fs.readFileSync(path.join(ROOT, "backend", "prisma", "tracking_code.sql"), "utf8");
R.ck(/ADD COLUMN IF NOT EXISTS tracking_code integer/.test(sql) && /CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_key_tracking_code_key ON orders \(tenant_key, tracking_code\)/.test(sql), "the SQL for Neon adds the column and the unique index per shop");

R.section("the database");
R.ck(r.duplicate === "refused" && r.otherShop === "accepted" && r.manyWithNone >= 2, "the same code twice in one shop is refused, another shop may use it, and any number of orders may have none", JSON.stringify([r.duplicate, r.otherShop, r.manyWithNone]));

// an older database: the column is added at the next start, and the older orders keep none
run1();
function run1() {
  const old = sandbox("op-tracking-old-");
  old.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  const result = JSON.parse(
    /RESULT (.*)/.exec(
      runScript(
        old,
        `
        await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
        await p.order.create({ data: { number: 'CMD-OLD-1', tenantKey: 't1' } });
        await p.$executeRawUnsafe('DROP INDEX IF EXISTS "orders_tenant_key_tracking_code_key"');
        await p.$executeRawUnsafe('ALTER TABLE "orders" DROP COLUMN "tracking_code"');
        console.log('RESULT ' + JSON.stringify({ droppedOk: !(await p.$queryRawUnsafe('PRAGMA table_info("orders")')).some((c) => c.name === 'tracking_code') }));
        `,
      ),
    )?.[1] ?? "{}",
  );
  R.section("an older database");
  R.ck(result.droppedOk === true, "(an older database is made: the orders table without the column)");
  const after = JSON.parse(
    /RESULT (.*)/.exec(
      runScript(
        old,
        `
        const out = {};
        out.hasColumn = (await p.$queryRawUnsafe('PRAGMA table_info("orders")')).some((c) => c.name === 'tracking_code');
        out.old = (await p.order.findFirst({ where: { number: 'CMD-OLD-1' } })).trackingCode;
        out.index = (await p.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'orders' AND name LIKE '%tracking%'")).length;
        console.log('RESULT ' + JSON.stringify(out));
        `,
      ),
    )?.[1] ?? "{}",
  );
  R.ck(after.hasColumn === true && after.old === null && after.index === 1, "at the next start the column and its unique index are added, and the older order has no code", JSON.stringify(after));
}

process.exit(R.done());
