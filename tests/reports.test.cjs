// The figures of the Reports page (src/local/reportsService.ts): the picture of a period (sales, discounts, net profit, money collected, what was bought from the suppliers,
// the chart, the sales by kind and by product, the best customers, the orders by status), its comparison with the period before, and the two figures that are not about a
// period: who owes money and what the stock is worth. Cancelled orders are not sales, an order with an unknown cost is counted apart, a cheque counts on the day it falls due.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-reports-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = JSON.parse(
  runScript(
    box,
    `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina', createdAt: new Date('2025-02-01T10:00:00'), ...S } });
  await p.customer.create({ data: { id: 'c2', name: 'Karim', createdAt: new Date('2025-03-15T10:00:00'), ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, stock, price, costPrice) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, price, costPrice, currency: 'DZD', stock, ...S } });
  await frame('f1', 'Aviator', 3, 18500, 12000);
  await frame('f2', 'Persol 649', 0, 9000, 5000);
  await frame('f3', 'Wayfarer', 2, 10000, null);
  await p.accessory.create({ data: { id: 'a1', name: 'Case', description: 'Hard case', stock: 10, price: 1500, costPrice: 600, ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', priceCents: 500000, costCents: 300000, ...S } });

  // an order with its lines: items = [[kind, productIds, description, unitPriceCents, unitCostCents | null, quantity]]
  const order = async (id, number, customerId, at, status, subtotal, total, items, extra = {}) => {
    await p.order.create({ data: { id, number, customerId, orderedAt: new Date(at), status, subtotalCents: subtotal, discountCents: subtotal - total, totalCents: total, ...extra, ...S } });
    for (const [kind, ids, description, price, cost, qty] of items) await p.orderItem.create({ data: { orderId: id, kind, ...ids, description, quantity: qty ?? 1, unitPriceCents: price, totalCents: price * (qty ?? 1), unitCostCents: cost, ...S } });
  };
  await order('A', 'N-A', 'c1', '2025-03-05T10:00:00', 'delivered', 2350000, 2000000, [['frame', { frameId: 'f1' }, 'Ray-Ban Aviator', 1850000, 1200000], ['lens', { lensId: 'l1' }, 'Stock 1.5', 500000, 300000]], { deliveredAt: new Date('2025-03-06T10:00:00') });
  await order('B', 'N-B', 'c1', '2025-03-20T10:00:00', 'delivered', 1000000, 1000000, [['frame', { frameId: 'f1' }, 'Ray-Ban Aviator', 1000000, 600000]], { deliveredAt: new Date('2025-03-21T10:00:00') });
  await order('C', 'N-C', 'c2', '2025-03-25T10:00:00', 'confirmed', 900000, 900000, [['frame', { frameId: 'f2' }, 'Persol 649', 400000, 250000], ['lens', {}, 'Custom lens', 500000, null]]);
  await order('D', 'N-D', 'c1', '2025-04-02T10:00:00', 'cancelled', 700000, 700000, [['frame', { frameId: 'f1' }, 'Ray-Ban Aviator', 700000, 100000]]);
  await order('E', 'N-E', 'c2', '2024-12-30T10:00:00', 'delivered', 500000, 500000, [['accessory', { accessoryId: 'a1' }, 'Case', 500000, 200000]], { deliveredAt: new Date('2024-12-31T10:00:00') });
  await order('F', 'N-F', 'c1', '2025-04-10T10:00:00', 'confirmed', 1000000, 1000000, [['accessory', { accessoryId: 'a1' }, 'Case', 500000, 100000, 2]]);
  await order('G', 'N-G', null, '2025-04-11T10:00:00', 'confirmed', 300000, 300000, []);

  const day = (n) => new Date(Date.now() + n * 86400000);
  const pay = (id, orderId, amountCents, at, cheque) => p.payment.create({ data: { id, orderId, amountCents, paidAt: new Date(at), chequeDueDate: cheque ? new Date(cheque) : null, ...S } });
  await pay('pa', 'A', 1500000, '2025-03-06T10:00:00');
  await pay('pb', 'B', 400000, '2025-03-21T10:00:00');
  await pay('pc', 'C', 100000, '2025-03-26T10:00:00');
  await pay('pd', 'D', 700000, '2025-04-03T10:00:00');   // on a cancelled order: still money received
  await pay('pe', 'E', 500000, '2024-12-31T10:00:00');
  await pay('pq', 'F', 300000, '2025-04-12T10:00:00', '2025-06-01T10:00:00');   // a cheque: it counts in June
  await pay('pf', 'G', 123000, day(-1), day(30));        // a cheque not due yet: not money in hand

  const sup = (id, name) => p.supplier.create({ data: { id, name, ...S } });
  await sup('s1', 'Lab One');
  await sup('s2', 'Frames Co');
  const buy = (id, supplierId, at, totalCents, status) => p.supplierOrder.create({ data: { id, supplierId, orderedAt: new Date(at), totalCents, status, ...S } });
  await buy('so1', 's1', '2025-03-10T10:00:00', 800000, 'received');
  await buy('so2', 's1', '2025-05-01T10:00:00', 200000, 'received');
  await buy('so3', 's2', '2025-03-15T10:00:00', 450000, 'cancelled');
  await buy('so4', 's2', '2025-03-18T10:00:00', 300000, 'received');

  const L = require(ROOT + '/dist/local/index.js');
  const R = L.localReportsService;
  const out = {};
  out.all = await R.overview({});
  out.y2025 = await R.overview({ year: 2025 });
  out.m3 = await R.overview({ year: 2025, month: 3 });
  out.m4 = await R.overview({ year: 2025, month: 4 });
  out.m6 = await R.overview({ year: 2025, month: 6 });
  out.jan = await R.overview({ year: 2025, month: 1 });
  out.empty = await R.overview({ year: 2019 });
  out.bad = [];
  for (const f of [{ month: 3 }, { year: 'x' }, { year: 2025, month: 13 }]) out.bad.push(await R.overview(f).then(() => false, () => true));
  out.debtors = await R.debtors();
  out.inventory = await R.inventory();
  console.log(JSON.stringify(out));
`,
  ).trim().split("\n").pop(),
);

R.section("a year");
{
  const y = out.y2025;
  const c = y.current;
  R.ck(y.granularity === "month" && y.series.length === 12 && y.series[0].key === "2025-01" && y.series[11].key === "2025-12", "a year is charted by month");
  R.ck(c.orders === 5 && c.cancelledOrders === 1, "orders placed, the cancelled one apart", JSON.stringify(c));
  R.ck(c.salesCents === 5200000 && c.discountCents === 350000 && c.averageOrderCents === 1040000, "sales, discounts and the average order", JSON.stringify(c));
  R.ck(c.profitCents === 1700000 && c.costCents === 2300000 && c.profitOrders === 3 && c.withoutCostOrders === 2, "net profit counts only the orders whose cost is known", JSON.stringify(c));
  R.ck(c.marginPercent === 42.5, "the margin is the profit over the price of those orders", String(c.marginPercent));
  R.ck(c.collectedCents === 3000000, "collected: money received in the year, a cheque on the day it falls due, the cancelled order's money too", String(c.collectedCents));
  R.ck(c.chequesLaterCents === 0, "no cheque of 2025 is still to come");
  R.ck(c.purchasesCents === 1300000 && c.purchaseOrders === 3, "supplier orders: the cancelled one is not spent", JSON.stringify([c.purchasesCents, c.purchaseOrders]));
  R.ck(c.newCustomers === 2, "customers added in the year");
  R.ck(y.years.includes(2025) && y.years.includes(2024) && y.years[0] >= 2025, "the years that have orders", JSON.stringify(y.years));
}

R.section("the chart");
{
  const pt = (o, key) => o.series.find((s) => s.key === key);
  R.ck(pt(out.y2025, "2025-03").salesCents === 3900000 && pt(out.y2025, "2025-03").collectedCents === 2000000, "March: sold and received");
  R.ck(pt(out.y2025, "2025-04").salesCents === 1300000 && pt(out.y2025, "2025-04").collectedCents === 700000, "April: the cancelled order is not sold, the cheque is not yet received");
  R.ck(pt(out.y2025, "2025-06").collectedCents === 300000 && pt(out.y2025, "2025-06").salesCents === 0, "June: the cheque falls due");
  R.ck(out.y2025.series.reduce((s, p) => s + p.salesCents, 0) === 5200000 && out.y2025.series.reduce((s, p) => s + p.collectedCents, 0) === 3000000, "the chart adds up to the headline");
  R.ck(out.m3.granularity === "day" && out.m3.series.length === 31 && out.m3.series[0].key === "2025-03-01", "a month is charted by day");
  R.ck(out.m3.series.find((s) => s.key === "2025-03-05").salesCents === 2000000 && out.m3.series.find((s) => s.key === "2025-03-06").collectedCents === 1500000, "a day: sold and received");
  R.ck(out.all.granularity === "year" && out.all.series[0].key === "2024" && out.all.series.at(-1).key === String(new Date().getFullYear()), "everything is charted by year, up to this year", out.all.series.map((s) => s.key).join());
  R.ck(out.all.series.find((s) => s.key === "2024").salesCents === 500000 && out.all.series.find((s) => s.key === "2025").salesCents === 5200000, "a year: sold");
}

R.section("a month, and the whole history");
{
  const c = out.m3.current;
  R.ck(c.orders === 3 && c.salesCents === 3900000 && c.profitCents === 900000 && c.withoutCostOrders === 1, "March", JSON.stringify(c));
  R.ck(c.purchasesCents === 1100000 && c.purchaseOrders === 2 && c.newCustomers === 1, "March: purchases and new customers");
  R.ck(out.m4.current.collectedCents === 700000 && out.m6.current.collectedCents === 300000 && out.m6.current.orders === 0, "a cheque is collected in the month it falls due");
  const a = out.all.current;
  R.ck(a.orders === 6 && a.salesCents === 5700000 && a.collectedCents === 3500000, "everything: sales and collected", JSON.stringify(a));
  R.ck(a.chequesLaterCents === 123000, "a cheque not due yet is shown apart, not collected", String(a.chequesLaterCents));
  R.ck(out.all.previous === null && out.all.previousPartial === false, "the whole history has nothing to be compared with");
  R.ck(out.bad.every(Boolean), "a month without a year, or a bad year or month, is refused");
  const e = out.empty.current;
  R.ck(e.orders === 0 && e.salesCents === 0 && e.averageOrderCents === 0 && e.marginPercent === null && out.empty.topProducts.length === 0 && out.empty.byKind.length === 0, "an empty period is all zeros, no division by zero", JSON.stringify(e));
}

R.section("the period before");
{
  R.ck(out.y2025.previous.salesCents === 500000 && out.y2025.previous.orders === 1 && out.y2025.previous.profitCents === 300000 && out.y2025.previousPartial === false, "a year is compared with the year before", JSON.stringify(out.y2025.previous));
  R.ck(out.m3.previous.orders === 0 && out.m3.previous.salesCents === 0, "March is compared with February");
  R.ck(out.jan.previous.salesCents === 500000 && out.jan.previous.orders === 1, "January is compared with December of the year before", JSON.stringify(out.jan.previous));
}

R.section("what was sold");
{
  const k = Object.fromEntries(out.y2025.byKind.map((r) => [r.kind, r]));
  R.ck(out.y2025.byKind.map((r) => r.kind).join() === "frame,lens,accessory", "kinds with sales, in order, the unused one left out");
  R.ck(k.frame.quantity === 3 && k.frame.revenueCents === 3250000 && k.frame.profitCents === 1200000 && k.frame.unknownCostLines === 0, "frames", JSON.stringify(k.frame));
  R.ck(k.lens.quantity === 2 && k.lens.revenueCents === 1000000 && k.lens.profitCents === 200000 && k.lens.unknownCostLines === 1, "lenses: the line with no known cost is counted apart", JSON.stringify(k.lens));
  R.ck(k.accessory.quantity === 2 && k.accessory.revenueCents === 1000000 && k.accessory.profitCents === 800000, "accessories", JSON.stringify(k.accessory));
  const names = out.y2025.topProducts.map((p) => p.name).join();
  R.ck(names === "Ray-Ban Aviator,Case,Custom lens,Stock 1.5,Persol 649", "top products by what they brought in", names);
  const top = out.y2025.topProducts;
  R.ck(top[0].quantity === 2 && top[0].revenueCents === 2850000 && top[0].profitCents === 1050000, "one product sold in two orders is one row", JSON.stringify(top[0]));
  R.ck(top[2].profitCents === null, "a product with no known cost has no profit");
  R.ck(JSON.stringify(out.y2025.statuses) === JSON.stringify({ confirmed: 3, at_lab: 0, ready: 0, delivered: 2, cancelled: 1 }), "orders by status", JSON.stringify(out.y2025.statuses));
}

R.section("customers and suppliers");
{
  const c = out.y2025.topCustomers;
  R.ck(c.length === 2 && c[0].customerName === "Amina" && c[0].orders === 3 && c[0].valueCents === 4000000 && c[1].customerName === "Karim" && c[1].valueCents === 900000, "best customers: the cancelled order and the walk-in are left out", JSON.stringify(c));
  const s = out.y2025.suppliers;
  R.ck(s.length === 2 && s[0].supplierName === "Lab One" && s[0].orders === 2 && s[0].spentCents === 1000000 && s[1].supplierName === "Frames Co" && s[1].spentCents === 300000, "spent with each supplier, the cancelled order not counted", JSON.stringify(s));
}

R.section("who owes, and the stock");
{
  const d = out.debtors;
  R.ck(d.owedCents === 2777000 && d.orders === 5 && d.customers === 3, "every order not fully paid, whatever its status (cancelled left out)", JSON.stringify(d));
  R.ck(d.rows.map((r) => r.customerName + ":" + r.owedCents).join() === "Amina:1800000,Karim:800000,Walk-in customer:177000", "by customer, the biggest debt first, and the walk-in customer too", JSON.stringify(d.rows));
  R.ck(d.rows[0].since === new Date("2025-03-06T10:00:00").toISOString(), "since the oldest delivery");
  const i = out.inventory;
  R.ck(i.frames.products === 2 && i.frames.units === 5 && i.frames.costValueCents === 3600000 && i.frames.priceValueCents === 7550000 && i.frames.withoutCost === 1 && i.frames.outOfStock === 1, "frames in stock", JSON.stringify(i.frames));
  R.ck(i.accessories.products === 1 && i.accessories.units === 10 && i.accessories.costValueCents === 600000 && i.accessories.priceValueCents === 1500000, "accessories in stock", JSON.stringify(i.accessories));
  R.ck(i.total.products === 3 && i.total.units === 15 && i.total.costValueCents === 4200000 && i.total.priceValueCents === 9050000 && i.total.withoutCost === 1, "the stock in all", JSON.stringify(i.total));
}

// While a period is not over, it is compared with the same stretch of the period before.
R.section("a period not over");
{
  const box2 = sandbox("op-reports2-");
  box2.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  const r = JSON.parse(
    runScript(
      box2,
      `
    await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
    const S = { tenantKey: 't1', synced: true };
    const n = new Date();
    const curStart = new Date(n.getFullYear(), n.getMonth(), 1);
    const prevStart = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    const late = new Date(prevStart.getTime() + 25.5 * 86400000);
    const lateIsInPrevious = late < curStart;
    const order = (id, at, total) => p.order.create({ data: { id, number: id, orderedAt: at, status: 'delivered', subtotalCents: total, totalCents: total, ...S } });
    await order('J', new Date(Date.now() - 1000), 100000);
    await order('I', prevStart, 70000);
    await order('H', late, 90000);
    const L = require(ROOT + '/dist/local/index.js');
    const o = await L.localReportsService.overview({ year: n.getFullYear(), month: n.getMonth() + 1 });
    const elapsedDays = (Date.now() - curStart.getTime()) / 86400000;
    console.log(JSON.stringify({ partial: o.previousPartial, current: o.current.salesCents, previous: o.previous.salesCents, elapsedDays, lateIsInPrevious, ofLastYear: (await L.localReportsService.overview({ year: n.getFullYear() })).previousPartial }));
  `,
    ).trim().split("\n").pop(),
  );
  R.ck(r.partial === true && r.ofLastYear === true, "the month and the year in progress are compared with the same stretch before", JSON.stringify(r));
  const expected = 70000 + (r.lateIsInPrevious && r.elapsedDays >= 25.5 ? 90000 : 0);
  R.ck(r.current === 100000 && r.previous === expected, "only the days that have passed are counted in the period before", JSON.stringify({ ...r, expected }));
}

// What customers owe: the orders that are ready or delivered and not fully paid; an order still being made is only "still to pay".
R.section("every order owes, whatever its status");
{
  const box3 = sandbox("op-reports3-");
  box3.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  const r = JSON.parse(
    runScript(
      box3,
      `
    await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
    const S = { tenantKey: 't1', synced: true };
    await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S } });
    await p.customer.create({ data: { id: 'c2', name: 'Karim', ...S } });
    const order = (id, customerId, status, total) => p.order.create({ data: { id, number: id, customerId, status, subtotalCents: total, totalCents: total, orderedAt: new Date('2026-01-10T10:00:00'), ...S } });
    await order('R', 'c1', 'ready', 100000);       // ready, 30 000 paid: 70 000 owed
    await order('D', 'c2', 'delivered', 80000);    // delivered and paid in full: nothing
    await order('E', 'c2', 'delivered', 50000);    // delivered, nothing paid: 50 000 owed
    await order('C', 'c1', 'confirmed', 40000);    // still being made: only to pay later
    await order('X', 'c1', 'cancelled', 90000);    // cancelled: nothing
    const pay = (id, orderId, amountCents) => p.payment.create({ data: { id, orderId, amountCents, ...S } });
    await pay('p1', 'R', 30000);
    await pay('p2', 'D', 80000);
    const L = require(ROOT + '/dist/local/index.js');
    console.log(JSON.stringify(await L.localReportsService.debtors()));
  `,
    ).trim().split("\n").pop(),
  );
  R.ck(r.owedCents === 160000 && r.orders === 3 && r.customers === 2, "a ready order, a delivered one and one still being made all count; a cancelled one is nothing", JSON.stringify(r));
  R.ck(r.rows.map((x) => x.customerName + ":" + x.owedCents).join() === "Amina:110000,Karim:50000", "by customer, the biggest first");
}

process.exit(R.done());
