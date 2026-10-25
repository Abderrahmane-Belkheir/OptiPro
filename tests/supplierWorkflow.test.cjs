// The supplier order WORKFLOWS from end to end, with the current stock and the money that follows:
//   1. a frame's life: bought, sold (the cost of the day is copied onto each sale), a second batch ordered while the first is on the shelf, the second coming in
//      when the first is gone, and what the Orders and Supplier orders pages add up to;
//   2. all or nothing (a failure in the middle changes nothing), two orders at the same moment, another shop's rows never touched (also by the trigger);
//   3. the batch price shared over the pieces (rounded to the centime, many cases);
//   4. the sync: what is sent to the server, in which order, what stays behind when the server is down or a parent is not there yet, and what a later pass sends.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-supplierflow-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = (key = 't1', synced = true) => ({ tenantKey: key, synced });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S() } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S() } });
  await p.brand.create({ data: { id: 'b2', name: 'Other', ...S('t2') } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.supplier.create({ data: { id: 's1', name: 'Optic Import', kinds: 'frames', ...S() } });
  await p.supplier.create({ data: { id: 'sx', name: 'Other shop supplier', kinds: 'frames', ...S('t2') } });
  const frame = (id, name, stock, key = 't1', brandId = 'b1') => p.frame.create({ data: { id, name, brandId, categoryId: 1, price: 18500, currency: 'DZD', stock, ...S(key) } });
  const accessory = (id, name, stock, key = 't1') => p.accessory.create({ data: { id, name, description: 'x', price: 1500, currency: 'DZD', stock, ...S(key) } });
  const L = require(ROOT + '/dist/local/index.js');
  const order = (d) => L.localSupplierOrderPlacementService.place(d);
  const sell = (productKey, id) => L.localOrderPlacementService.place({ customerId: 'c1', [productKey]: id });
  const fr = async (id) => { const x = await p.frame.findFirst({ where: { id } }); return [x.stock, x.costPrice]; };
  const out = {};

  // ============================== 1. a frame's life
  await frame('FL', 'Aviator', 0);
  const a = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FL', quantity: 10, unitCost: '9000' }] });
  out.lifeA = { status: a.status, total: a.totalCents, stock: await fr('FL') };
  const costs = [];
  for (let i = 0; i < 3; i++) { const o = await sell('frameId', 'FL'); costs.push((await p.orderItem.findFirst({ where: { orderId: o.order.id } })).unitCostCents); }
  out.lifeSold3 = { costs: costs.slice(), stock: await fr('FL') };
  // the second batch is ordered while the first is still on the shelf (7 left): it waits
  const b = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FL', quantity: 20, unitCost: '8000' }] });
  const lineB = await p.supplierOrderItem.findFirst({ where: { supplierOrderId: b.orderId } });
  out.lifeB = { status: b.status, updated: b.updatedLines, used: lineB.used, stock: await fr('FL') };
  // ... and a third can not be ordered while the second waits
  const c = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FL', quantity: 5, unitCost: '7000' }] });
  out.lifeC = c.status === 'invalid' ? Object.keys(c.errors).join() : c.status;
  for (let i = 0; i < 6; i++) { const o = await sell('frameId', 'FL'); costs.push((await p.orderItem.findFirst({ where: { orderId: o.order.id } })).unitCostCents); }
  out.lifeStillFirst = { stock: await fr('FL'), usedB: (await p.supplierOrderItem.findFirst({ where: { id: lineB.id } })).used }; // 1 piece left of the first batch
  const last = await sell('frameId', 'FL'); // the LAST piece of the first batch: the second comes in
  costs.push((await p.orderItem.findFirst({ where: { orderId: last.order.id } })).unitCostCents);
  out.lifeSwitch = { stock: await fr('FL'), usedB: (await p.supplierOrderItem.findFirst({ where: { id: lineB.id } })).used };
  const next = await sell('frameId', 'FL'); // the first sale from the second batch
  const nextCost = (await p.orderItem.findFirst({ where: { orderId: next.order.id } })).unitCostCents;
  out.lifeNext = { cost: nextCost, stock: await fr('FL') };
  out.lifeCosts = costs.join();
  // it can be ordered again now that the second line has been used
  const d = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FL', quantity: 4, unitCost: '7500' }] });
  out.lifeD = { status: d.status, updated: d.updatedLines };
  // the money: 11 sales of 18 500 (price in the shop) minus the cost copied on each, and what was spent on the suppliers
  const sales = await L.localSalesService.list({});
  out.lifeProfit = sales.totals.profitCents;
  const spent = await L.localSupplierOrdersService.list({});
  out.lifeSpent = spent.totals;

  // ============================== 2. all or nothing, two at once, another shop's rows
  await frame('F8', 'Atomic one', 0);
  await frame('F9', 'Atomic two', 0);
  await p.$executeRawUnsafe("CREATE TRIGGER block_f9 BEFORE INSERT ON supplier_order_items WHEN NEW.frame_id = 'F9' BEGIN SELECT RAISE(ABORT, 'blocked on purpose'); END");
  const ordersBefore = await p.supplierOrder.count();
  const itemsBefore = await p.supplierOrderItem.count();
  out.atomicThrew = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'F8', quantity: 3, unitCost: '100' }, { frameId: 'F9', quantity: 3, unitCost: '100' }] }).then(() => 'placed', () => 'threw');
  out.atomic = { orders: (await p.supplierOrder.count()) - ordersBefore, items: (await p.supplierOrderItem.count()) - itemsBefore, f8: await fr('F8'), f9: await fr('F9') };
  await p.$executeRawUnsafe('DROP TRIGGER block_f9');
  out.atomicAfter = (await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'F8', quantity: 3, unitCost: '100' }, { frameId: 'F9', quantity: 3, unitCost: '100' }] })).status;

  // two orders for the same frame at the same moment: one is applied, the other waits or is refused; never two applied
  await frame('FC', 'Concurrent', 0);
  const both = await Promise.all([
    order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FC', quantity: 4, unitCost: '1000' }] }),
    order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FC', quantity: 9, unitCost: '2000' }] }),
  ]);
  const cLines = await p.supplierOrderItem.findMany({ where: { frameId: 'FC' } });
  const cUsed = cLines.filter((l) => l.used);
  const cFrame = await p.frame.findFirst({ where: { id: 'FC' } });
  out.concurrent = { statuses: both.map((x) => x.status).sort().join(), used: cUsed.length, stockIsTheUsedLine: cUsed.length === 1 && cFrame.stock === cUsed[0].quantity && cFrame.costPrice === cUsed[0].unitCostCents / 100, waiting: cLines.filter((l) => !l.used).length };

  // another shop's rows are never touched, and the trigger respects the shop
  await frame('FX', 'Other shop frame', 1, 't2', 'b2');
  await p.supplierOrder.create({ data: { id: 'ox', supplierId: 'sx', ...S('t2') } });
  await p.supplierOrderItem.create({ data: { id: 'oxi', supplierOrderId: 'ox', frameId: 'FX', quantity: 7, unitCostCents: 123400, used: false, ...S('t2') } });
  // a line of the FIRST shop that points at the other shop's frame (wrong data): when that frame reaches 0 the trigger must not apply it
  await p.supplierOrderItem.create({ data: { id: 'oxbad', supplierOrderId: 'ox', frameId: 'FX', quantity: 99, unitCostCents: 99900, used: false, createdAt: new Date('2000-01-01T00:00:00Z'), ...S('t1') } });
  await p.frame.update({ where: { id: 'FX' }, data: { stock: 0 } });
  const fx = await p.frame.findFirst({ where: { id: 'FX' } });
  out.isolation = { stock: fx.stock, cost: fx.costPrice, own: (await p.supplierOrderItem.findFirst({ where: { id: 'oxi' } })).used, foreign: (await p.supplierOrderItem.findFirst({ where: { id: 'oxbad' } })).used };
  out.refusedForeign = [
    (await order({ supplierId: 'sx', priceMode: 'unit', lines: [{ frameId: 'FL', quantity: 1, unitCost: '1' }] })).status,
    (await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'FX', quantity: 1, unitCost: '1' }] })).status,
  ].join();
  out.listOnlyOwn = (await L.localSupplierOrdersService.list({})).rows.every((r) => r.id !== 'ox');

  // ============================== 3. the batch price shared over the pieces
  const rounding = [];
  let seed = 424242;
  const next01 = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 40; i++) {
    const n = 1 + Math.floor(next01() * 4); // lines
    const ids = [];
    const qtys = [];
    for (let j = 0; j < n; j++) { const id = 'R' + i + '_' + j; ids.push(id); qtys.push(1 + Math.floor(next01() * 30)); await accessory(id, 'Acc ' + id, 0); }
    const pieces = qtys.reduce((x, y) => x + y, 0);
    const totalCents = 100 + Math.floor(next01() * 99999999);
    const typed = (Math.floor(totalCents / 100) + '.' + String(totalCents % 100).padStart(2, '0'));
    const placed = await order({ supplierId: 's1', priceMode: 'batch', batchTotal: typed, lines: ids.map((id, j) => ({ accessoryId: id, quantity: qtys[j] })) });
    if (placed.status !== 'placed') { rounding.push({ i, refused: placed.errors }); continue; }
    const rows = await p.supplierOrderItem.findMany({ where: { supplierOrderId: placed.orderId } });
    const unit = Math.round(totalCents / pieces);
    const same = rows.every((r) => r.unitCostCents === unit);
    const drift = Math.abs(rows.reduce((s, r) => s + r.unitCostCents * r.quantity, 0) - totalCents);
    rounding.push({ i, pieces, same, positive: unit > 0, driftOk: drift <= pieces / 2 + 0.5, totalKept: placed.totalCents === totalCents });
  }
  out.rounding = { cases: rounding.length, bad: rounding.filter((r) => r.refused || !r.same || !r.positive || !r.driftOk || !r.totalKept).slice(0, 3) };

  // ============================== 4. the sync
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const m = /^\\/api\\/table\\/([a-z_]+)\\?action=([a-z]+)$/.exec(req.url);
      seen.push({ table: m?.[1], action: m?.[2], auth: req.headers.authorization, rows: raw ? JSON.parse(raw).rows : null });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const up = 'http://127.0.0.1:' + server.address().port;
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const down = 'http://127.0.0.1:' + dead.address().port;
  await new Promise((r) => dead.close(r));
  const serverIs = (url) => fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'tenant.key=t1\\nserver.url=' + url + '\\n');
  const circuit = require(ROOT + '/dist/local/tableApiClient.js');
  const tables = () => seen.map((s) => s.table + ':' + s.action).join();
  await frame('SY1', 'Sync frame', 0);
  await accessory('SY2', 'Sync accessory', 4);
  await p.supplier.update({ where: { id: 's1' }, data: { synced: true } });

  // the server is reachable: the order, its lines and the products that changed are sent, parents first
  circuit.resetTableApiCircuit(); // (the earlier orders found nobody at the address and paused the requests for a minute)
  serverIs(up);
  seen.length = 0;
  const live = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'SY1', quantity: 6, unitCost: '2500' }, { accessoryId: 'SY2', quantity: 3, unitCost: '300' }] });
  out.syncLive = { sent: live.sentToServer, tables: tables(), auth: [...new Set(seen.map((s) => s.auth))].join() };
  const orderRow = seen.find((s) => s.table === 'supplier_orders')?.rows?.[0];
  const itemRows = seen.filter((s) => s.table === 'supplier_order_items').flatMap((s) => s.rows).sort((x, y) => y.quantity - x.quantity);
  out.syncBodies = {
    order: orderRow ? { supplierId: orderRow.supplierId, priceMode: orderRow.priceMode, totalCents: orderRow.totalCents, status: orderRow.status, hasSynced: 'synced' in orderRow, hasTenant: orderRow.tenantKey ?? undefined } : null,
    item: itemRows[0] ? { keys: Object.keys(itemRows[0]).sort().join(), used: itemRows[0].used, unitCostCents: itemRows[0].unitCostCents, quantity: itemRows[0].quantity, order: itemRows[0].supplierOrderId === orderRow?.id } : null,
    frame: seen.find((s) => s.table === 'frames')?.rows?.[0] ? { stock: seen.find((s) => s.table === 'frames').rows[0].stock, costPrice: seen.find((s) => s.table === 'frames').rows[0].costPrice } : null,
    accessorySent: seen.some((s) => s.table === 'accessories'), // the accessory had stock: it did not change, so it is not sent
  };
  out.syncMarks = { order: (await p.supplierOrder.findFirst({ where: { id: live.orderId } })).synced, items: (await p.supplierOrderItem.findMany({ where: { supplierOrderId: live.orderId } })).every((i) => i.synced), frame: (await p.frame.findFirst({ where: { id: 'SY1' } })).synced };

  // a customer's order for that frame while the server is up: the frame (its stock went down) is sent before the line that points at it, so nothing waits
  seen.length = 0;
  const saleLive = await sell('frameId', 'SY1');
  out.syncSale = { sent: saleLive.sentToServer, tables: tables(), stock: (await fr('SY1'))[0] };

  // the server is down: everything stays behind (unsent), and a later pass sends it, parents first
  await frame('SY3', 'Offline frame', 0);
  serverIs(down);
  seen.length = 0;
  const offline = await order({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'SY3', quantity: 2, unitCost: '1500' }] });
  const unsentRows = async () => ({
    order: (await p.supplierOrder.findFirst({ where: { id: offline.orderId } })).synced,
    items: (await p.supplierOrderItem.findMany({ where: { supplierOrderId: offline.orderId } })).map((i) => i.synced).join(),
    frame: (await p.frame.findFirst({ where: { id: 'SY3' } })).synced,
  });
  out.syncOffline = { sent: offline.sentToServer, requests: seen.length, marks: await unsentRows() };
  // the supplier itself is not on the server yet: the order must wait for it
  await p.supplier.update({ where: { id: 's1' }, data: { synced: false } });
  circuit.resetTableApiCircuit();
  serverIs(up);
  seen.length = 0;
  await L.pushAll();
  const order_ = seen.map((s) => s.table);
  out.syncPass = { tables: tables(), supplierBeforeOrders: order_.indexOf('suppliers') !== -1 && order_.indexOf('suppliers') < order_.indexOf('supplier_orders'), ordersBeforeItems: order_.indexOf('supplier_orders') < order_.indexOf('supplier_order_items'), marks: await unsentRows(), supplier: (await p.supplier.findFirst({ where: { id: 's1' } })).synced };
  seen.length = 0;
  await L.pushAll();
  out.syncAgain = seen.length; // everything is in step: a second pass sends nothing
  server.close();

  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("1. a frame's life");
R.ck(r.lifeA?.status === "placed" && r.lifeA?.total === 9000000 && JSON.stringify(r.lifeA?.stock) === JSON.stringify([10, 9000]), "the first order (10 at 9 000) is applied at once: stock 10, cost 9 000", JSON.stringify(r.lifeA));
R.ck(JSON.stringify(r.lifeSold3?.costs) === JSON.stringify([900000, 900000, 900000]) && r.lifeSold3?.stock?.[0] === 7, "three sales copy the cost of the day (9 000) and take the stock to 7", JSON.stringify(r.lifeSold3));
R.ck(r.lifeB?.status === "placed" && r.lifeB?.updated === 0 && r.lifeB?.used === false && r.lifeB?.stock?.[0] === 7 && r.lifeB?.stock?.[1] === 9000, "a second order (20 at 8 000) while 7 are left WAITS: the stock and the cost stay (7 at 9 000)", JSON.stringify(r.lifeB));
R.ck(r.lifeC === "FL.waiting", "a third order is refused while the second waits", String(r.lifeC));
R.ck(r.lifeStillFirst?.stock?.[0] === 1 && r.lifeStillFirst?.usedB === false, "six more sales leave 1 of the first batch, the second still waits", JSON.stringify(r.lifeStillFirst));
R.ck(r.lifeSwitch?.stock?.[0] === 20 && r.lifeSwitch?.stock?.[1] === 8000 && r.lifeSwitch?.usedB === true, "the last piece of the first batch is sold: the second comes in (20 at 8 000)", JSON.stringify(r.lifeSwitch));
R.ck(r.lifeNext?.cost === 800000 && r.lifeNext?.stock?.[0] === 19, "the next sale copies the new cost (8 000) and takes the stock to 19", JSON.stringify(r.lifeNext));
R.ck(r.lifeCosts === "900000,900000,900000,900000,900000,900000,900000,900000,900000,900000", "all ten sales of the first batch copied 9 000", r.lifeCosts);
R.ck(r.lifeD?.status === "placed" && r.lifeD?.updated === 0, "once the second line is used a new order can be placed (it waits: 19 left)", JSON.stringify(r.lifeD));
R.ck(r.lifeProfit === 11 * 1850000 - (10 * 900000 + 800000), "the Orders page's profit is the 11 sales at 18 500 minus the cost copied on each (105 500)", String(r.lifeProfit));
R.ck(r.lifeSpent?.orders === 3 && r.lifeSpent?.spentCents === 9000000 + 16000000 + 4 * 750000, "the Supplier orders page adds up 3 orders and what was spent on them (90 000 + 160 000 + 30 000)", JSON.stringify(r.lifeSpent));

R.section("2. all or nothing, two at once, another shop");
R.ck(r.atomicThrew === "threw" && r.atomic?.orders === 0 && r.atomic?.items === 0 && JSON.stringify(r.atomic?.f8) === JSON.stringify([0, null]) && JSON.stringify(r.atomic?.f9) === JSON.stringify([0, null]), "a failure on the second line undoes everything: no order, no line, no stock or cost changed on the first line either", JSON.stringify([r.atomicThrew, r.atomic]));
R.ck(r.atomicAfter === "placed", "once the cause is gone the same order is placed");
R.ck(r.concurrent?.used === 1 && r.concurrent?.stockIsTheUsedLine === true && r.concurrent?.waiting <= 1, "two orders for the same frame at the same moment: only one line is applied, and the stock and cost are that line's", JSON.stringify(r.concurrent));
R.ck(r.isolation?.stock === 7 && r.isolation?.cost === 1234 && r.isolation?.own === true && r.isolation?.foreign === false, "when another shop's frame reaches 0 only that shop's own line comes in (7 at 1 234); a line of this shop pointing at it is ignored", JSON.stringify(r.isolation));
R.ck(r.refusedForeign === "invalid,invalid", "an order with another shop's supplier, or for its frame, is refused", String(r.refusedForeign));
R.ck(r.listOnlyOwn === true, "the list never shows another shop's orders");

R.section("3. the batch price shared over the pieces");
R.ck(r.rounding?.cases === 40 && r.rounding?.bad?.length === 0, "40 random batches (1 to 4 lines, up to 120 pieces): the same cost on every line = batch / pieces to the centime, never 0, the total kept as typed, and the lines add up to the batch within half a centime per piece", JSON.stringify(r.rounding));

R.section("4. the sync");
R.ck(r.syncLive?.sent === true && r.syncLive?.tables === "supplier_orders:insert,frames:insert,supplier_order_items:insert,supplier_order_items:insert", "with the server up: the order, then the frame that changed, then both lines are sent (the accessory did not change, so it is not): a line is not held back by its unsent product", JSON.stringify(r.syncLive));
R.ck(/^Bearer t1$/.test(r.syncLive?.auth ?? ""), "with the shop's key");
R.ck(r.syncBodies?.order?.supplierId === "s1" && r.syncBodies?.order?.priceMode === "unit" && r.syncBodies?.order?.totalCents === 1590000 && r.syncBodies?.order?.status === "received" && r.syncBodies?.order?.hasSynced === false && r.syncBodies?.order?.hasTenant === undefined, "the order row has its supplier, how the price was given, its total (15 000 + 900) and its status; it has no local 'synced' column and no shop key (the server takes the shop from the Bearer key)", JSON.stringify(r.syncBodies?.order));
R.ck(r.syncBodies?.item?.used === true && r.syncBodies?.item?.unitCostCents === 250000 && r.syncBodies?.item?.quantity === 6 && r.syncBodies?.item?.order === true && !/synced/.test(r.syncBodies?.item?.keys ?? "synced"), "a line row has its order, quantity, what one cost and used, and no 'synced'", JSON.stringify(r.syncBodies?.item));
R.ck(r.syncBodies?.frame?.stock === 6 && r.syncBodies?.frame?.costPrice === 2500 && r.syncBodies?.accessorySent === false, "the frame is sent with its new stock and cost (6 at 2 500)", JSON.stringify(r.syncBodies));
R.ck(r.syncMarks?.order === true && r.syncMarks?.items === true && r.syncMarks?.frame === true, "what the server accepted is marked synced");
R.ck(r.syncSale?.sent === true && /^number_sequences:insert,orders:insert,frames:insert,order_items:insert/.test(r.syncSale?.tables ?? "") && r.syncSale?.stock === 5, "a customer's order for that frame sends the order, then the frame with its lower stock, then the line: nothing is held back, so it is all on the server at once", JSON.stringify(r.syncSale));
R.ck(r.syncOffline?.sent === false && r.syncOffline?.requests === 0 && r.syncOffline?.marks?.order === false && r.syncOffline?.marks?.items === "false" && r.syncOffline?.marks?.frame === false, "with the server down nothing is lost: the order, its line and the frame stay unsent", JSON.stringify(r.syncOffline));
R.ck(r.syncPass?.supplierBeforeOrders === true && r.syncPass?.ordersBeforeItems === true, "a later pass sends the supplier first, then the orders, then their lines", JSON.stringify(r.syncPass?.tables));
R.ck(r.syncPass?.marks?.order === true && r.syncPass?.marks?.items === "true" && r.syncPass?.marks?.frame === true && r.syncPass?.supplier === true, "and then everything is marked synced");
R.ck(r.syncAgain === 0, "a second pass sends nothing: everything is in step");

process.exit(R.done());
