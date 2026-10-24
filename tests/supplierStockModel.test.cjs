// The stock rules of supplier orders, checked against a SIMPLE MODEL of them over long random runs.
// The rules (the whole design in a few lines), for a frame or an accessory:
//   - a customer's order for it takes one piece off (never below 0); when that was the last piece, the line waiting for it (if any) becomes its stock and cost;
//   - cancelling that order gives the piece back; reopening takes it out again (never below 0), with the same "last piece" rule;
//   - the stock typed by hand: when it becomes 0 (from something else) the waiting line comes in;
//   - a supplier order line: refused while the product has a line waiting; if the stock is 0 the line is applied at once (stock = quantity, cost = what one cost);
//     otherwise it WAITS; a supplier order is all or nothing; a batch price is shared over all the pieces bought (rounded to the centime);
//   - a cancelled supplier order's waiting lines are forgotten.
// After EVERY step the database must equal the model (stock, cost, which lines are used), and these must hold:
//   stock >= 0;  a product at stock 0 has no waiting line;  a product has at most one waiting line;  the cost a sale copies is the cost of the day.
// Two seeds, 260 steps each, frames and accessories mixed.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-stockmodel-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.supplier.create({ data: { id: 's1', name: 'Optic Import', kinds: 'frames', ...S } });
  const L = require(ROOT + '/dist/local/index.js');

  const PRODUCTS = [
    { key: 'F1', kind: 'frame', stock: 0 }, { key: 'F2', kind: 'frame', stock: 2 }, { key: 'F3', kind: 'frame', stock: 5 },
    { key: 'A1', kind: 'accessory', stock: 0 }, { key: 'A2', kind: 'accessory', stock: 3 },
  ];
  for (const x of PRODUCTS) {
    if (x.kind === 'frame') await p.frame.create({ data: { id: x.key, name: 'Frame ' + x.key, brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: x.stock, ...S } });
    else await p.accessory.create({ data: { id: x.key, name: 'Accessory ' + x.key, description: 'x', price: 1500, currency: 'DZD', stock: x.stock, ...S } });
  }
  const table = (x) => (x.kind === 'frame' ? p.frame : p.accessory);

  // the seeded random numbers
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  const result = { runs: [] };
  for (const seed of [20260101, 777]) {
    const rand = rng(seed);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

    // reset the products and forget the earlier run's orders (their rows stay; only this run's products are new)
    const tag = String(seed);
    const model = {};
    const ids = {};
    for (const x of PRODUCTS) {
      const id = x.key + '-' + tag;
      ids[x.key] = id;
      if (x.kind === 'frame') await p.frame.create({ data: { id, name: 'Frame ' + id, brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: x.stock, ...S } });
      else await p.accessory.create({ data: { id, name: 'Accessory ' + id, description: 'x', price: 1500, currency: 'DZD', stock: x.stock, ...S } });
      model[x.key] = { kind: x.kind, id, stock: x.stock, cost: null, waiting: null };
    }
    const keys = PRODUCTS.map((x) => x.key);
    const row = async (k) => (model[k].kind === 'frame' ? p.frame : p.accessory).findFirst({ where: { id: model[k].id } });
    const itemsOf = (k) => p.supplierOrderItem.findMany({ where: model[k].kind === 'frame' ? { frameId: model[k].id } : { accessoryId: model[k].id } });

    const sales = [];          // { orderId, key, cancelled }
    const supplierOrders = []; // { id, lines: [key] }
    const log = [];
    const problems = [];
    const costCents = (c) => (c == null ? null : Math.round(c * 100));

    // what the model does when a product's stock became 0 (from something else): the waiting line comes in
    const hitZero = (m) => { if (m.stock === 0 && m.waiting) { m.stock = m.waiting.qty; m.cost = m.waiting.cost; m.waiting.line.used = true; m.waiting = null; } };

    const STEPS = 260;
    for (let step = 1; step <= STEPS; step++) {
      const roll = rand();
      let what = '';
      if (roll < 0.34) {
        // a customer's order for a product
        const k = pick(keys);
        const m = model[k];
        const snapshot = m.cost == null ? null : Math.round(m.cost * 100);
        const draft = { customerId: 'c1' };
        draft[m.kind === 'frame' ? 'frameId' : 'accessoryId'] = m.id;
        const placed = await L.localOrderPlacementService.place(draft);
        what = 'sale ' + k;
        if (placed.status !== 'placed') problems.push(step + ': sale refused ' + JSON.stringify(placed.errors));
        else {
          const line = await p.orderItem.findFirst({ where: { orderId: placed.order.id } });
          if (line.unitCostCents !== snapshot) problems.push(step + ': the sale copied the cost ' + line.unitCostCents + ' instead of ' + snapshot);
          const before = m.stock;
          if (m.stock > 0) { m.stock -= 1; if (m.stock === 0 && before > 0) hitZero(m); }
          sales.push({ orderId: placed.order.id, key: k, cancelled: false });
        }
      } else if (roll < 0.46) {
        // cancel a sale: the piece comes back
        const open = sales.filter((s) => !s.cancelled);
        if (open.length) {
          const s = pick(open);
          await L.localOrderDetailsService.setStatus(s.orderId, 'cancelled');
          s.cancelled = true;
          model[s.key].stock += 1;
          what = 'cancel ' + s.key;
        }
      } else if (roll < 0.56) {
        // reopen a cancelled sale: the piece goes again (never below 0)
        const gone = sales.filter((s) => s.cancelled);
        if (gone.length) {
          const s = pick(gone);
          await L.localOrderDetailsService.setStatus(s.orderId, 'confirmed');
          s.cancelled = false;
          const m = model[s.key];
          const before = m.stock;
          m.stock = Math.max(0, m.stock - 1);
          if (m.stock === 0 && before !== 0) hitZero(m);
          what = 'reopen ' + s.key;
        }
      } else if (roll < 0.86) {
        // a supplier order for one or two products, a price for each or one for the whole batch
        const chosen = rand() < 0.35 ? [pick(keys)] : (() => { const a = pick(keys); let b = pick(keys); while (b === a) b = pick(keys); return [a, b]; })();
        const batch = rand() < 0.4;
        const qtys = chosen.map(() => int(1, 12));
        const prices = chosen.map(() => int(100, 20000)); // in DZD
        const draftLines = chosen.map((k, i) => {
          const l = { quantity: qtys[i] };
          l[model[k].kind === 'frame' ? 'frameId' : 'accessoryId'] = model[k].id;
          if (!batch) l.unitCost = String(prices[i]);
          return l;
        });
        const pieces = qtys.reduce((a, b) => a + b, 0);
        const batchCents = int(1000, 900000) * 100;
        const draft = { supplierId: 's1', priceMode: batch ? 'batch' : 'unit', lines: draftLines };
        if (batch) draft.batchTotal = String(batchCents / 100);
        const refusedByModel = chosen.some((k) => model[k].waiting);
        const placed = await L.localSupplierOrderPlacementService.place(draft);
        what = 'order ' + chosen.join('+') + (batch ? ' batch' : '');
        if (refusedByModel) {
          if (placed.status !== 'invalid') problems.push(step + ': an order for a product with a waiting line was accepted');
        } else if (placed.status !== 'placed') {
          problems.push(step + ': a valid order was refused ' + JSON.stringify(placed.errors));
        } else {
          const unitCents = batch ? Math.round(batchCents / pieces) : null;
          const lineRows = await p.supplierOrderItem.findMany({ where: { supplierOrderId: placed.orderId }, orderBy: { createdAt: 'asc' } });
          const order = { id: placed.orderId, lines: [] };
          chosen.forEach((k, i) => {
            const m = model[k];
            const cents = batch ? unitCents : prices[i] * 100;
            const line = { used: false };
            if (m.stock === 0) { m.stock = qtys[i]; m.cost = cents / 100; line.used = true; }
            else m.waiting = { qty: qtys[i], cost: cents / 100, line, orderId: placed.orderId };
            order.lines.push({ key: k, line });
            const dbLine = lineRows.find((r) => (m.kind === 'frame' ? r.frameId : r.accessoryId) === m.id);
            if (!dbLine || dbLine.unitCostCents !== cents || dbLine.quantity !== qtys[i]) problems.push(step + ': the line of ' + k + ' holds the wrong quantity or cost');
          });
          const expectTotal = batch ? batchCents : chosen.reduce((sum, k, i) => sum + prices[i] * 100 * qtys[i], 0);
          if (placed.totalCents !== expectTotal) problems.push(step + ': total ' + placed.totalCents + ' instead of ' + expectTotal);
          supplierOrders.push(order);
        }
      } else if (roll < 0.95) {
        // the stock typed by hand (0 to 4)
        const k = pick(keys);
        const m = model[k];
        const n = int(0, 4);
        const before = m.stock;
        await table(m).update({ where: { id: m.id }, data: { stock: n } });
        m.stock = n;
        if (n === 0 && before !== 0) hitZero(m);
        what = 'set ' + k + ' ' + n;
      } else {
        // a supplier order is cancelled: its waiting lines are forgotten
        const open = supplierOrders.filter((o) => !o.cancelled);
        if (open.length) {
          const o = pick(open);
          await p.supplierOrder.update({ where: { id: o.id }, data: { status: 'cancelled' } });
          o.cancelled = true;
          for (const l of o.lines) if (model[l.key].waiting && model[l.key].waiting.orderId === o.id) model[l.key].waiting = null;
          what = 'cancel supplier order';
        }
      }
      log.push(what);

      // ---- the database must equal the model, and the invariants must hold
      for (const k of keys) {
        const m = model[k];
        const r = await row(k);
        if (r.stock !== m.stock) problems.push(step + ' (' + what + '): ' + k + ' stock ' + r.stock + ' instead of ' + m.stock);
        const want = m.cost == null ? null : m.cost;
        if ((r.costPrice ?? null) !== want && !(r.costPrice != null && want != null && Math.abs(r.costPrice - want) < 1e-9)) problems.push(step + ' (' + what + '): ' + k + ' cost ' + r.costPrice + ' instead of ' + want);
        if (r.stock < 0) problems.push(step + ': ' + k + ' has a negative stock');
        const lines = await itemsOf(k);
        const live = [];
        for (const l of lines) {
          if (l.used) continue;
          const o = await p.supplierOrder.findFirst({ where: { id: l.supplierOrderId } });
          if (o.status !== 'cancelled') live.push(l);
        }
        if (live.length > 1) problems.push(step + ' (' + what + '): ' + k + ' has ' + live.length + ' waiting lines');
        if (r.stock === 0 && live.length > 0) problems.push(step + ' (' + what + '): ' + k + ' is at 0 with a waiting line');
        if ((live.length === 1) !== Boolean(m.waiting)) problems.push(step + ' (' + what + '): ' + k + ' waiting line ' + live.length + ' but the model says ' + Boolean(m.waiting));
      }
      // which lines are used
      for (const o of supplierOrders) {
        for (const l of o.lines) {
          const m = model[l.key];
          const rows = await p.supplierOrderItem.findMany({ where: { supplierOrderId: o.id } });
          const dbLine = rows.find((r) => (m.kind === 'frame' ? r.frameId : r.accessoryId) === m.id);
          if (dbLine && dbLine.used !== l.line.used) problems.push(step + ' (' + what + '): the line of ' + l.key + ' in an order says used=' + dbLine.used + ', the model ' + l.line.used);
        }
      }
      if (problems.length > 8) break;
    }
    const counts = { sale: 0, cancel: 0, reopen: 0, order: 0, set: 0 };
    for (const w of log) { const w0 = w.split(' ')[0]; if (counts[w0] !== undefined) counts[w0] += 1; }
    result.runs.push({ seed, steps: log.length, counts, problems: problems.slice(0, 8), finalStocks: Object.fromEntries(keys.map((k) => [k, model[k].stock])) });
  }
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

for (const run of r.runs ?? []) {
  R.section(`seed ${run.seed}`);
  R.ck(run.steps === 260, `${run.steps} steps were run`, String(run.steps));
  R.ck(run.counts.sale > 40 && run.counts.order > 40 && run.counts.cancel > 5 && run.counts.reopen > 3 && run.counts.set > 10, "every kind of step happened many times (sales, supplier orders, cancels, reopens, hand-typed stock)", JSON.stringify(run.counts));
  R.ck(run.problems.length === 0, "after every step the database equals the model (stock, cost, used lines) and the invariants hold", run.problems.join(" | "));
}
R.ck((r.runs ?? []).length === 2, "both runs finished");

process.exit(R.done());
