// A shop that has been using the app for three years: how long do the pages' figures take? 6 000 orders, 12 000 order lines, 9 000 payments, 3 000 customers, 600 frames.
// The limits are generous (a page that waits for these must not feel slow on an ordinary shop computer); the point is to catch a figure that grows with the history.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-perf-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = JSON.parse(
  runScript(
    box,
    `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  const year = new Date().getFullYear();
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.createMany({ data: Array.from({ length: 600 }, (_, i) => ({ id: 'f' + i, name: 'Frame ' + i, brandId: 'b1', categoryId: 1, price: 15000, costPrice: 8000, currency: 'DZD', stock: i % 7, code: 'fr' + String(i).padStart(1, 'a') + '-' + String(i).padStart(3, '0'), ...S })) });
  await p.customer.createMany({ data: Array.from({ length: 3000 }, (_, i) => ({ id: 'c' + i, yearOfBirth: 1990, name: 'Customer ' + i + ' Benali', phone: '055' + String(1000000 + i), createdAt: new Date(Date.now() - i * 3600000), ...S })) });
  const N = 6000;
  const order = (i) => {
    const at = new Date(Date.now() - (i / N) * 3 * 365 * 86400000);
    const total = 1500000 + (i % 40) * 50000;
    const status = i % 50 === 0 ? 'cancelled' : i % 9 === 0 ? 'ready' : i % 13 === 0 ? 'at_lab' : 'delivered';
    return { id: 'o' + i, number: 'CMD-' + at.getFullYear() + '-' + String(i).padStart(5, '0'), customerId: 'c' + (i % 3000), status, orderedAt: at, deliveredAt: status === 'delivered' ? at : null, subtotalCents: total, totalCents: total, ...S };
  };
  for (let s = 0; s < N; s += 1000) await p.order.createMany({ data: Array.from({ length: 1000 }, (_, k) => order(s + k)) });
  const items = [];
  for (let i = 0; i < N; i++) {
    const total = 1500000 + (i % 40) * 50000;
    items.push({ id: 'i' + i + 'a', orderId: 'o' + i, kind: 'frame', frameId: 'f' + (i % 600), description: 'Frame', quantity: 1, unitPriceCents: 1000000, totalCents: 1000000, unitCostCents: 600000, ...S });
    items.push({ id: 'i' + i + 'b', orderId: 'o' + i, kind: 'lens', description: 'Lens', eye: 'both', quantity: 1, unitPriceCents: total - 1000000, totalCents: total - 1000000, unitCostCents: i % 11 === 0 ? null : 400000, ...S });
  }
  for (let s = 0; s < items.length; s += 2000) await p.orderItem.createMany({ data: items.slice(s, s + 2000) });
  const pays = [];
  for (let i = 0; i < N; i++) {
    const total = 1500000 + (i % 40) * 50000;
    const at = new Date(Date.now() - (i / N) * 3 * 365 * 86400000);
    pays.push({ id: 'p' + i + 'a', orderId: 'o' + i, customerId: 'c' + (i % 3000), amountCents: i % 5 === 0 ? total - 200000 : total, paidAt: at, ...S });
    if (i % 2 === 0) pays.push({ id: 'p' + i + 'b', orderId: 'o' + i, customerId: 'c' + (i % 3000), amountCents: 0 + 1, paidAt: at, ...S });
  }
  for (let s = 0; s < pays.length; s += 2000) await p.payment.createMany({ data: pays.slice(s, s + 2000) });

  const L = require(ROOT + '/dist/local/index.js');
  const time = async (name, fn) => { const t = Date.now(); const value = await fn(); return [name, Date.now() - t, value]; };
  const month = new Date().getMonth() + 1;
  const results = [];
  results.push(await time('dashboard.month', () => L.localDashboardService.month()));
  results.push(await time('dashboard.owed', () => L.localDashboardService.owed()));
  results.push(await time('dashboard.ready', () => L.localDashboardService.ready()));
  results.push(await time('reports.overview (everything)', () => L.localReportsService.overview({})));
  results.push(await time('reports.overview (a year)', () => L.localReportsService.overview({ year })));
  results.push(await time('reports.overview (a month)', () => L.localReportsService.overview({ year, month })));
  results.push(await time('reports.debtors', () => L.localReportsService.debtors()));
  results.push(await time('reports.inventory', () => L.localReportsService.inventory()));
  results.push(await time('sales.list (everything)', () => L.localSalesService.list({})));
  results.push(await time('sales.list (a search)', () => L.localSalesService.list({ query: 'benali 12' })));
  results.push(await time('customers.list', () => L.localCustomerService.list()));
  results.push(await time('customers.search', () => L.localCustomerService.search('Customer 29')));
  results.push(await time('paymentsView.list', () => L.localPaymentsService.list({})));
  // a word that is in the name of ALL 3 000 customers (a common surname) must not break the searches
  const found = await L.localSalesService.list({ query: 'benali' });
  const foundPayments = await L.localPaymentsService.list({ query: 'benali' });
  const foundOne = await L.localSalesService.list({ query: 'customer 2999 benali' });
  results.push(await time('paymentsView.list (a search)', () => L.localPaymentsService.list({ query: 'benali 12' })));
  const sizes = { orders: await p.order.count(), items: await p.orderItem.count(), payments: await p.payment.count() };
  console.log('RESULT ' + JSON.stringify({ common: { orders: found.matching, shown: found.shown, payments: foundPayments.totals?.payments ?? foundPayments.rows?.length, one: foundOne.rows.map((r) => r.customerName).join() }, sizes, results: results.map(([name, ms]) => [name, ms]), overview: { orders: results[3][2].current.orders, sales: results[3][2].current.salesCents } }));
`,
  ).split("\n").find((l) => l.startsWith("RESULT "))?.slice(7) ?? "{}",
);

R.section("a shop with three years of history");
R.ck(out.sizes?.orders === 6000 && out.sizes?.payments >= 9000, "the data is there", JSON.stringify(out.sizes));
const LIMIT_MS = 2500;
for (const [name, ms] of out.results ?? []) R.ck(ms < LIMIT_MS, `${name}: ${ms} ms (limit ${LIMIT_MS} ms)`);
R.ck(out.common?.orders === 6000 && out.common?.shown === 100, "a word that is in every customer's name finds all 6 000 orders (the list shows the newest 100) instead of failing", JSON.stringify(out.common));
R.ck(out.common?.one === "Customer 2999 Benali,Customer 2999 Benali", "and the words together narrow it down to that customer (her 2 orders)", out.common?.one);
R.ck(out.overview?.orders > 5000, "and the figures count the whole history", JSON.stringify(out.overview));
process.exit(R.done());
