// Changing an order's status is sent to the server: every change (a status, the delivery day, the stock of the frames and accessories that come back or go out again when an order
// is cancelled or reopened, the corrected prices) makes the request the sync makes (POST /api/table/<name>?action=insert, which overwrites the row with the same id) with what changed,
// the row is marked synced when the server accepts it, a server that is down or refuses leaves it unsynced, and the next sync pass sends it. A fake server notes what it is asked.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-statuspush-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = JSON.parse(
  runScript(
    box,
    `
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator', brandId: 'b1', categoryId: 1, price: 18500, costPrice: 12000, currency: 'DZD', stock: 5, ...S } });
  await p.accessory.create({ data: { id: 'a1', name: 'Case', description: 'Hard case', price: 1500, costPrice: 600, currency: 'DZD', stock: 5, ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', priceCents: 500000, costCents: 300000, ...S } });
  await p.order.create({ data: { id: 'o1', number: 'CMD-1', customerId: 'c1', status: 'confirmed', subtotalCents: 2500000, totalCents: 2500000, ...S } });
  const line = (id, kind, ids, description, price, cost) => p.orderItem.create({ data: { id, orderId: 'o1', kind, ...ids, description, quantity: 1, unitPriceCents: price, totalCents: price, unitCostCents: cost, ...S } });
  await line('i1', 'frame', { frameId: 'f1' }, 'Ray-Ban Aviator', 1850000, 1200000);
  await line('i2', 'lens', { lensId: 'l1' }, 'Stock 1.5', 500000, 300000);
  await line('i3', 'accessory', { accessoryId: 'a1' }, 'Case', 150000, 60000);

  // a fake server: notes what it is asked; mode 'ok' accepts, 'down' drops the connection, 'refuse' answers 400
  let mode = 'ok';
  let seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const m = /^\\/api\\/table\\/([a-z_]+)\\?action=([a-z]+)$/.exec(req.url);
      if (mode === 'down') return req.socket.destroy();
      seen.push({ table: m?.[1], action: m?.[2], body: JSON.parse(body || '{}') });
      if (mode === 'refuse') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'refused' })); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'tenant.key=t1\\nserver.url=http://127.0.0.1:' + server.address().port + '\\n');
  const L = require(ROOT + '/dist/local/index.js');
  const circuit = require(ROOT + '/dist/local/tableApiClient.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const D = L.localOrderDetailsService;
  const reqs = () => seen.map((s) => s.table + ':' + s.action).join();
  const row = (table, id) => seen.filter((s) => s.table === table).map((s) => (s.body.rows ?? []).find((r) => r.id === id)).filter(Boolean).at(-1);
  const rowSynced = async (id) => (await p.order.findFirst({ where: { id } })).synced;
  const stock = async () => [(await p.frame.findFirst({ where: { id: 'f1' } })).stock, (await p.accessory.findFirst({ where: { id: 'a1' } })).stock];
  const out = {};
  const step = async (name, status) => {
    seen = [];
    const d = await D.setStatus('o1', status);
    out[name] = { status: d.status, requests: reqs(), sent: row('orders', 'o1'), synced: await rowSynced('o1') };
  };

  await step('atLab', 'at_lab');
  await step('ready', 'ready');
  await step('delivered', 'delivered');
  await step('left', 'confirmed');           // leaving delivered clears the delivery day
  seen = [];
  await D.setStatus('o1', 'confirmed');
  out.same = { requests: reqs() };           // the same status again: nothing to send

  seen = [];
  await D.setStatus('o1', 'cancelled');
  out.cancelled = { requests: reqs(), order: row('orders', 'o1'), frame: row('frames', 'f1'), accessory: row('accessories', 'a1'), stock: await stock(), synced: await rowSynced('o1') };
  seen = [];
  await D.setStatus('o1', 'confirmed');
  out.reopened = { requests: reqs(), frame: row('frames', 'f1'), accessory: row('accessories', 'a1'), stock: await stock(), synced: await rowSynced('o1') };

  // correcting the money: the order and the lines that changed are sent
  seen = [];
  await D.edit('o1', { lines: [{ id: 'i2', unitPriceCents: 600000, unitCostCents: 350000 }] });
  out.edit = { requests: reqs(), order: row('orders', 'o1'), line: row('order_items', 'i2'), synced: await rowSynced('o1') };

  // the server is down: the status changes here, the row stays unsynced, nothing is lost
  mode = 'down';
  seen = [];
  const down = await D.setStatus('o1', 'at_lab');
  out.down = { status: down.status, local: (await p.order.findFirst({ where: { id: 'o1' } })).status, synced: await rowSynced('o1'), requests: reqs() };
  // ... and the next sync pass sends it once the server is back
  mode = 'ok';
  circuit.resetTableApiCircuit();
  await sleep(100);
  seen = [];
  await L.pushAll('manual');
  out.afterDown = { requests: reqs(), sent: row('orders', 'o1'), synced: await rowSynced('o1') };

  // the server refuses the row: it stays unsynced, the status is still changed here, and a later pass sends it
  mode = 'refuse';
  circuit.resetTableApiCircuit();
  seen = [];
  const refused = await D.setStatus('o1', 'ready');
  out.refused = { status: refused.status, synced: await rowSynced('o1'), attempted: reqs() };
  mode = 'ok';
  circuit.resetTableApiCircuit();
  await sleep(100);
  seen = [];
  await L.pushAll('manual');
  out.afterRefused = { sent: row('orders', 'o1'), synced: await rowSynced('o1') };

  server.close();
  process.stdout.write(JSON.stringify(out) + '\\n', () => process.exit(0));
`,
  ).trim().split("\n").pop(),
);

const status = (r) => r?.status;
const delivered = (r) => r?.delivered_at ?? r?.deliveredAt ?? null;

R.section("a status change is sent");
for (const [name, want] of [["atLab", "at_lab"], ["ready", "ready"], ["delivered", "delivered"], ["left", "confirmed"]]) {
  const r = out[name];
  R.ck(r.status === want && r.requests === "orders:insert" && status(r.sent) === want && r.synced === true, `-> ${want}: one request for the order, with the new status, and the row is marked synced`, JSON.stringify([r.requests, status(r.sent), r.synced]));
}
R.ck(delivered(out.delivered.sent) !== null && /^\d{4}-\d\d-\d\dT/.test(String(delivered(out.delivered.sent))), "delivered: the delivery day goes with it", String(delivered(out.delivered.sent)));
R.ck(delivered(out.left.sent) === null, "leaving delivered: the delivery day is cleared on the server too", String(delivered(out.left.sent)));
R.ck(out.same.requests === "", "the same status again sends nothing");

R.section("cancelling and reopening");
const c = out.cancelled;
R.ck(status(c.order) === "cancelled" && c.synced === true, "cancelled: the order is sent with its new status");
R.ck(c.requests.split(",").sort().join() === "accessories:insert,frames:insert,orders:insert", "the frame and the accessory that come back to the stock are sent too", c.requests);
R.ck(c.frame?.stock === 6 && c.accessory?.stock === 6 && c.stock.join() === "6,6", "with their new stock (5 -> 6), here and on the server", JSON.stringify([c.frame?.stock, c.accessory?.stock, c.stock]));
const o = out.reopened;
R.ck(o.requests.split(",").sort().join() === "accessories:insert,frames:insert,orders:insert" && o.frame?.stock === 5 && o.accessory?.stock === 5 && o.synced === true, "reopened: the order and the stock (6 -> 5) are sent again", JSON.stringify([o.requests, o.frame?.stock, o.accessory?.stock]));

R.section("correcting the money");
const e = out.edit;
R.ck(e.requests.split(",").sort().join() === "order_items:insert,orders:insert" && e.synced === true, "the order and the line that changed are sent (not the lines that did not)", e.requests);
R.ck((e.order?.total_cents ?? e.order?.totalCents) === 2600000 && (e.line?.unit_price_cents ?? e.line?.unitPriceCents) === 600000 && (e.line?.unit_cost_cents ?? e.line?.unitCostCents) === 350000, "with the new total, price and cost", JSON.stringify([e.order, e.line]));

R.section("the server is down, or refuses");
R.ck(out.down.status === "at_lab" && out.down.local === "at_lab" && out.down.synced === false, "server down: the status is changed here and the row stays unsynced (nothing is lost)", JSON.stringify(out.down));
R.ck(status(out.afterDown.sent) === "at_lab" && out.afterDown.synced === true && /orders:insert/.test(out.afterDown.requests), "the next sync pass sends it once the server is back", JSON.stringify([out.afterDown.requests, status(out.afterDown.sent), out.afterDown.synced]));
R.ck(out.refused.status === "ready" && out.refused.synced === false, "the server refuses the row: the status is still changed here and the row stays unsynced", JSON.stringify(out.refused));
R.ck(status(out.afterRefused.sent) === "ready" && out.afterRefused.synced === true, "and a later pass sends it", JSON.stringify([status(out.afterRefused.sent), out.afterRefused.synced]));

process.exit(R.done());
