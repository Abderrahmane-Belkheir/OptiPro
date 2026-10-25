// The net profit on the Orders page (src/local/salesService.ts): the final price of each order minus what its lines COST on the day of the sale (the cost saved on the line),
// for the period, the status and the search chosen. Orders with an unknown cost are counted apart, cancelled orders are not counted at all, and a later change of a
// product's cost changes nothing.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-profit-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c2', name: 'Karim', ...S } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c3', name: 'Zed Solo', ...S } });
  let n = 0;
  // an order with its lines: items = [[kind, unitPriceCents, unitCostCents | null, quantity]]
  const order = async (id, customerId, day, status, subtotal, total, items) => {
    n += 1;
    await p.order.create({ data: { id, number: 'OLD-' + String(n).padStart(4, '0'), customerId, orderedAt: new Date(day + 'T10:00:00'), status, subtotalCents: subtotal, discountCents: subtotal - total, totalCents: total, ...S } });
    for (const [kind, price, cost, qty] of items) await p.orderItem.create({ data: { orderId: id, kind, description: kind, quantity: qty ?? 1, unitPriceCents: price, totalCents: price * (qty ?? 1), unitCostCents: cost, ...S } });
  };
  await order('A', 'c1', '2026-03-05', 'delivered', 2350000, 2000000, [['frame', 1850000, 1200000], ['lens', 500000, 300000]]); // discounted: profit 2 000 000 - 1 500 000
  await order('B', 'c1', '2026-03-20', 'delivered', 1000000, 1000000, [['frame', 1000000, 600000]]);                                       // 400 000
  await order('C', 'c1', '2026-03-25', 'confirmed', 900000, 900000, [['frame', 400000, 250000], ['lens', 500000, null]]);                   // a lens with no known cost: excluded
  await order('D', 'c1', '2026-04-02', 'cancelled', 700000, 700000, [['frame', 700000, 100000]]);                                          // cancelled: not counted at all
  await order('E', 'c2', '2025-12-30', 'delivered', 500000, 500000, [['accessory', 500000, 200000]]);                                      // another year: 300 000
  await order('F', 'c1', '2026-04-10', 'confirmed', 1000000, 1000000, [['accessory', 500000, 100000, 2]]);                                 // two of them: 1 000 000 - 200 000 = 800 000
  await order('G', 'c1', '2026-04-11', 'confirmed', 300000, 300000, []);                                                                   // no lines: unknown

  // what was really paid: A in full (1 500 000 of 2 000 000? no: 1 500 000 = its cost), B 400 000 of 1 000 000, E all 500 000, F nothing, C and G a little (not counted: unknown cost)
  const pay = (id, orderId, amountCents) => p.payment.create({ data: { id, orderId, amountCents, ...S } });
  await pay('pa', 'A', 1500000);
  await pay('pb', 'B', 400000);
  await pay('pe', 'E', 500000);
  await pay('pc', 'C', 100000);
  await pay('pd', 'D', 700000);

  const L = require(ROOT + '/dist/local/index.js');
  const t = async (filter) => { const r = await L.localSalesService.list(filter); return { collected: r.totals.collectedProfitCents, profit: r.totals.profitCents, profitOrders: r.totals.profitOrders, without: r.totals.withoutCostOrders, orders: r.totals.orders, value: r.totals.valueCents }; };
  const out = {};
  out.all = await t({});
  out.y2026 = await t({ year: 2026 });
  out.y2025 = await t({ year: 2025 });
  out.m3 = await t({ year: 2026, month: 3 });
  out.m4 = await t({ year: 2026, month: 4 });
  out.d5 = await t({ year: 2026, month: 3, day: 5 });
  out.d6 = await t({ year: 2026, month: 3, day: 6 });
  out.delivered2026 = await t({ year: 2026, status: 'delivered' });
  out.confirmed = await t({ status: 'confirmed' });
  out.cancelled = await t({ status: 'cancelled' });
  out.karim = await t({ query: 'Karim' });

  // end to end: an order placed for real keeps the cost of the day, whatever happens to the product's cost afterwards
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator', brandId: 'b1', categoryId: 1, price: 18500, costPrice: 12000, currency: 'DZD', stock: 2, ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', priceCents: 500000, costCents: 300000, ...S } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c3', prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, ...S } });
  const placed = await L.localOrderPlacementService.place({ customerId: 'c3', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', finalPrice: '20000' });
  out.placed = [placed.status, placed.totalCents];
  out.solo = await t({ query: 'Zed' });
  // paying: nothing yet (-1 500 000: the costs are not covered), a deposit, then the rest
  await L.localOrderDetailsService.pay(placed.order.id, { amountCents: 1000000 });
  out.soloDeposit = (await t({ query: 'Zed' })).collected;
  await L.localOrderDetailsService.pay(placed.order.id, { amountCents: 1000000 });
  out.soloPaidUp = (await t({ query: 'Zed' })).collected;
  await L.localOrderDetailsService.setStatus(placed.order.id, 'confirmed');
  await p.frame.update({ where: { id: 'f1' }, data: { costPrice: 99999, price: 1 } });
  await p.lens.update({ where: { id: 'l1' }, data: { costCents: 888888 } });
  out.soloAfter = await t({ query: 'Zed' });
  // an order cancelled afterwards leaves the profit
  await L.localOrderDetailsService.setStatus(placed.order.id, 'cancelled');
  out.soloCancelled = await t({ query: 'Zed' });
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

R.section("the net profit of a period");
R.ck(r.all?.profit === 2000000 && r.all?.profitOrders === 4, "over everything: the final prices minus the saved costs (A 500 000 + B 400 000 + E 300 000 + F 800 000)", JSON.stringify(r.all));
R.ck(r.all?.without === 2 && r.all?.orders === 6, "two orders have an unknown cost (a lens with none entered, an order with no lines) and are counted apart; the cancelled one is not counted at all", JSON.stringify(r.all));
R.ck(same(r.y2026, { collected: -400000, profit: 1700000, profitOrders: 3, without: 2, orders: 5, value: 5200000 }), "a year", JSON.stringify(r.y2026));
R.ck(r.y2025?.profit === 300000 && r.y2025?.without === 0, "another year", JSON.stringify(r.y2025));
R.ck(r.m3?.profit === 900000 && r.m3?.profitOrders === 2 && r.m3?.without === 1, "a month (March 2026)", JSON.stringify(r.m3));
R.ck(r.m4?.profit === 800000 && r.m4?.without === 1 && r.m4?.orders === 2, "a month where the cancelled order is left out (April 2026)", JSON.stringify(r.m4));
R.ck(r.d5?.profit === 500000 && r.d5?.profitOrders === 1 && r.d6?.profit === 0 && r.d6?.orders === 0, "a day, and a day with no order", `${JSON.stringify(r.d5)} ${JSON.stringify(r.d6)}`);
R.ck(r.delivered2026?.profit === 900000 && r.confirmed?.profit === 800000 && r.confirmed?.without === 2, "it follows the status filter", `${JSON.stringify(r.delivered2026)} ${JSON.stringify(r.confirmed)}`);
R.ck(r.cancelled?.profit === 0 && r.cancelled?.orders === 0 && r.cancelled?.without === 0, "the cancelled filter has no profit and nothing counted");
R.ck(r.karim?.profit === 300000, "and the search");

R.section("the profit collected: what was really paid minus the cost");
R.ck(r.all?.collected === -100000, "over everything: A 0 (paid exactly its cost), B -200 000 (paid 400 000 of a 600 000 cost), E +300 000, F -200 000; the cancelled and the unknown-cost orders are not in it", String(r.all?.collected));
R.ck(r.y2026?.collected === -400000 && r.y2025?.collected === 300000 && r.m3?.collected === -200000 && r.m4?.collected === -200000, "by year and by month", `${r.y2026?.collected} ${r.y2025?.collected} ${r.m3?.collected} ${r.m4?.collected}`);
R.ck(r.delivered2026?.collected === -200000 && r.d5?.collected === 0 && r.cancelled?.collected === 0, "and by status and by day", `${r.delivered2026?.collected} ${r.d5?.collected}`);

R.section("the discount and the cost of the day");
R.ck(r.placed?.[0] === "placed" && r.placed?.[1] === 2000000, "an order placed with a final price of 20 000 (the items add up to 23 500)");
R.ck(same(r.solo, { collected: -1500000, profit: 500000, profitOrders: 1, without: 0, orders: 1, value: 2000000 }), "its profit is the final price minus the costs of the day: 20 000 - (12 000 + 3 000) = 5 000", JSON.stringify(r.solo));
R.ck(r.soloDeposit === -500000 && r.soloPaidUp === 500000, "the profit collected follows the payments: -15 000 with nothing paid, -5 000 after a deposit of 10 000, and the full 5 000 once the order is paid up", `${r.soloDeposit} ${r.soloPaidUp}`);
R.ck(same({ ...r.soloAfter, collected: 0 }, { ...r.solo, collected: 0 }), "changing the frame's and the lens's costs (and prices) afterwards changes nothing", JSON.stringify(r.soloAfter));
R.ck(r.soloCancelled?.profit === 0 && r.soloCancelled?.orders === 0, "cancelling the order takes it out of the profit");
process.exit(R.done());
