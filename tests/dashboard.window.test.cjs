// The Dashboard in the real app window: the figures of the CURRENT MONTH (orders and their value, what was spent with the suppliers, the profit of the month and the part of it
// already collected), what customers owe since the start (and who owes most), the orders that are ready (whatever their month), the latest customers. Every customer
// and order shown opens its page, and the rows of the lists open theirs when clicked.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-dash-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  const day = (n) => new Date(Date.now() + n * 86400000);
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', createdAt: day(-10), ...S } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c2', name: 'Karim', createdAt: day(-2), ...S } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c3', name: 'Sara', createdAt: day(-5), ...S } });
  const n = new Date();
  const now = new Date(Date.now() - 1000);
  const lastMonth = new Date(n.getFullYear(), n.getMonth() - 1, 1, 12, 0, 0);
  // an order with its lines: items = [[price, cost | null]]
  const order = async (id, customerId, at, status, total, items, extra = {}) => {
    await p.order.create({ data: { id, number: 'N-' + id, customerId, orderedAt: at, status, subtotalCents: total, totalCents: total, ...extra, ...S } });
    for (const [price, cost] of items) await p.orderItem.create({ data: { orderId: id, kind: 'frame', description: 'Frame ' + id, quantity: 1, unitPriceCents: price, totalCents: price, unitCostCents: cost, ...S } });
  };
  // this month
  await order('M1', 'c1', now, 'delivered', 100000, [[100000, 60000]], { deliveredAt: now });   // profit 40 000, paid in full
  await order('M2', 'c2', now, 'ready', 80000, [[80000, 50000]]);                               // profit 30 000, 30 000 paid, ready
  await order('M3', 'c1', now, 'cancelled', 999999, [[999999, 1]]);                               // not a sale
  await order('M4', 'c3', now, 'confirmed', 20000, []);                                          // no lines: its profit is unknown
  // the month before
  await order('P1', 'c1', lastMonth, 'delivered', 500000, [[500000, 200000]], { deliveredAt: lastMonth });   // profit 300 000, 400 000 paid: 100 000 owed
  await order('P2', 'c3', lastMonth, 'ready', 60000, [[60000, 20000]]);                                      // ready, nothing paid: still shown
  await order('P3', 'c2', lastMonth, 'delivered', 90000, [[90000, 30000]], { deliveredAt: lastMonth });      // profit 60 000, 10 000 paid: 80 000 owed
  await order('P4', 'c1', lastMonth, 'confirmed', 40000, []);                                                // still being made, nothing paid: owed too (the customer's page counts it)
  const pay = (id, orderId, customerId, amountCents, at, cheque) => p.payment.create({ data: { id, orderId, customerId, amountCents, paidAt: at, chequeDueDate: cheque ?? null, ...S } });
  await pay('y1', 'M1', 'c1', 100000, now);
  await pay('y2', 'M2', 'c2', 30000, now);
  await pay('y3', 'M4', 'c3', 20000, now, day(30));        // a cheque not due yet
  await pay('y4', 'P1', 'c1', 400000, lastMonth);
  await pay('y5', 'P3', 'c2', 10000, lastMonth);
  await p.supplier.create({ data: { id: 's1', name: 'Frames Co', ...S } });
  const buy = (id, at, totalCents, status) => p.supplierOrder.create({ data: { id, supplierId: 's1', orderedAt: at, totalCents, status, ...S } });
  await buy('so1', now, 70000, 'received');
  await buy('so2', now, 99999, 'cancelled');
  await buy('so3', lastMonth, 40000, 'received');
`,
);

let A;
const text = (selector) => A.val(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const money = (cents) => A.val(`new Intl.NumberFormat(undefined, { style: 'currency', currency: 'DZD', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(${cents} / 100)`);
const go = async (hash) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await sleep(300);
};
const hash = () => A.val("location.hash");

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.dashboard?.month === 'function'");

    R.section("the service");
    const m = await A.val("window.electronAPI.dashboard.month()");
    const d = new Date();
    R.ck(m.year === d.getFullYear() && m.month === d.getMonth() + 1, "it is the current month");
    R.ck(m.orders === 3 && m.salesCents === 200000, "orders placed this month and their value (the cancelled one is not a sale)", JSON.stringify([m.orders, m.salesCents]));
    R.ck(m.purchasesCents === 70000 && m.purchaseOrders === 1, "spent on suppliers this month (the cancelled order and last month's are not counted)", JSON.stringify([m.purchasesCents, m.purchaseOrders]));
    R.ck(m.profitCents === 70000 && m.profitOrders === 2 && m.withoutCostOrders === 1, "profit of this month: the order with no known cost is counted apart", JSON.stringify([m.profitCents, m.profitOrders, m.withoutCostOrders]));
    R.ck(m.collectedProfitCents === 20000 && m.toCollectCents === 50000, "the profit already collected: what was paid on those orders minus their costs (a deposit that does not cover the cost counts less), and what is left to collect", JSON.stringify([m.collectedProfitCents, m.toCollectCents]));
    R.ck(!("cashedCents" in m) && !("totalProfitCents" in m), "(no figure of the other months in it: last month's profit is not in this month's)");
    const o = await A.val("window.electronAPI.dashboard.owed()");
    R.ck(o.owedCents === 330000 && o.orders === 5 && o.customers === 3 && o.rows.map((r) => r.customerName + ":" + r.owedCents).join() === "Amina:140000,Karim:130000,Sara:60000", "what customers owe since the start: every order not paid up, whatever its status (a delivered one, a ready one, one still being made)", JSON.stringify(o));
    const history = await A.val("window.customerHistoryData?.summary ? window.customerHistoryData.summary('c1') : null");
    if (history) R.ck(history.balanceDueCents === 140000, "the customer's own page adds up the same for that customer", JSON.stringify(history));
    const r = await A.val("window.electronAPI.dashboard.ready()");
    R.ck(r.count === 2 && r.remainingCents === 110000 && r.rows.map((x) => x.id).sort().join() === "M2,P2", "the orders that are ready, whatever their month, and what is still to pay on them", JSON.stringify(r));
    R.ck((await A.val("window.electronAPI.dashboard.recentCustomers()")).map((c) => c.name).join() === "Karim,Sara,Amina", "the latest customers, newest first");

    R.section("the page");
    await go("dashboard");
    R.ck(await A.until("document.querySelectorAll('[data-section]').length >= 4 && [...document.querySelectorAll('[data-section]')].every((s) => s.dataset.status === 'ready')"), "every section loads");
    R.ck((await A.val("[...document.querySelectorAll('[data-section]')].map((s) => s.dataset.section).join()")) === "month-numbers,owed,ready,customers", "only the month's figures, who owes, the ready orders and the latest customers");
    R.ck((await text("[data-month-name]")) === (await A.val("new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date())")), "the page says which month it is");
    R.ck((await text("[data-value=orders]")) === "3" && (await text("[data-value=sales]")) === (await money(200000)), "orders and their value");
    R.ck((await text("[data-value=purchases]")) === (await money(70000)) && (await text("[data-sub=purchases]")).includes("1 supplier order"), "spent on suppliers");
    R.ck((await text("[data-value=profit]")) === (await money(70000)) && (await text("[data-tile=profit]")).includes("1 order has no known cost"), "profit this month, and the order left out is said");
    R.ck((await text("[data-value=collected]")) === (await money(20000)) && (await text("[data-tile=collected]")).includes(await money(50000)) && (await text("[data-tile=collected]")).includes("still to collect"), "the profit already collected, and what is still to collect");
    R.ck((await text("[data-tile=profit]")).includes("Collected or not yet"), "the profit of the month counts what is not collected too");
    R.ck((await text("[data-value=owed]")) === (await money(330000)) && (await text("[data-value=ready]")) === "2", "what is owed, and how many are ready");
    R.ck(!(await A.val("!!document.querySelector('[data-section=attention], [data-section=stages], [data-section=sales], [data-section=sync], [data-section=stock], .dash-chart')")), "the old sections are gone");
    R.ck(!/\bnull\b|undefined|NaN/.test(await text(".dash")), "no stray null or undefined text");

    R.section("every record opens its page");
    R.ck((await A.val("[...document.querySelectorAll('[data-debtor]')].map((a) => a.getAttribute('href')).join()")) === "#customers/c1,#customers/c2,#customers/c3", "who owes opens the customers");
    R.ck((await A.val("[...document.querySelectorAll('[data-ready-order]')].map((a) => a.getAttribute('href')).sort().join()")) === "#orders/M2,#orders/P2", "a ready order opens the order's page");
    R.ck((await A.val("[...document.querySelectorAll('[data-latest-customer]')].map((a) => a.getAttribute('href')).join()")) === "#customers/c2,#customers/c3,#customers/c1", "the latest customers open their pages");
    await A.val("document.querySelector('[data-ready-order=M2]').click()");
    R.ck(await A.until("location.hash === '#orders/M2' && document.querySelector('[data-order-page] [data-number]')?.textContent === 'N-M2'"), "clicking a ready order shows its details");
    await go("dashboard");
    await A.until("!!document.querySelector('[data-debtor=c2]')");
    await A.val("document.querySelector('[data-debtor=c2]').click()");
    R.ck(await A.until("location.hash === '#customers/c2'"), "clicking who owes shows the customer");

    R.section("the rows of the lists open");
    await go("customers");
    await A.until("document.querySelectorAll('tr[data-customer]').length === 3");
    await A.val("document.querySelector('tr[data-customer=c3] td:nth-child(2)').click()");
    R.ck((await hash()) === "#customers/c3", "a click on a customer's row opens the customer");
    await go("customers");
    await A.until("document.querySelectorAll('tr[data-customer]').length === 3");
    await A.val("document.querySelector('tr[data-customer=c3] .row-menu-button').click()");
    await sleep(200);
    R.ck((await hash()) === "#customers", "the actions button of the row keeps its own click");
    await go("customers");
    await A.until("document.querySelector('a[data-open-customer=c1]')");
    await A.val("document.querySelector('a[data-open-customer=c1]').click()");
    R.ck((await hash()) === "#customers/c1", "the customer's name is a link");

    await go("orders");
    await A.until("document.querySelectorAll('[data-sales] tbody tr').length > 0");
    await A.val("(() => { const e = document.querySelector('[data-period=year]'); e.value = ''; e.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-apply]').click(); return 1; })()");
    await A.until("document.querySelector('tr[data-id=P1]')");
    await A.val("document.querySelector('tr[data-id=P1] [data-cell=total]').click()");
    R.ck(await A.until("location.hash === '#orders/P1'"), "a click on an order's row opens the order");

    await go("payments");
    await A.until("document.querySelector('tr[data-id=y1]')");
    await A.val("document.querySelector('tr[data-id=y1] [data-cell=date]').click()");
    R.ck(await A.until("location.hash === '#orders/M1'"), "a click on a payment opens its order");

    await go("supplier-orders");
    await A.until("document.querySelector('tr[data-id=so1]')");
    await A.val("document.querySelector('tr[data-id=so1] [data-cell=supplier]').click()");
    R.ck(await A.until("location.hash === '#supplier-orders/so1'"), "a click on a supplier order opens it");

    R.section("languages");
    for (const code of ["fr", "ar"]) {
      await A.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(800);
      await A.until(`window.i18n?.lang === ${JSON.stringify(code)} && !!document.querySelector('#content')`);
      await go("dashboard");
      await A.until("[...document.querySelectorAll('[data-section]')].length >= 4 && [...document.querySelectorAll('[data-section]')].every((s) => s.dataset.status === 'ready')");
      await sleep(300);
      const formatted = [/^[\d\s.,:+·×°%  -]*(DZD|EUR|USD)?[\d\s.,  ]*$/, /^[^\s\d]*\s?\d{1,2}\s[^\s\d]+\.?(\s\d{4})?(\s\(.*\))?$/, /^[^\s\d]{1,3}\.?$/, /^[A-Z]{1,3}$/, /^[^\s\d]+ \d{4}$/, /^[\p{L}.]+ \d{1,2},? \d{4}$/u];
      const data = new Set(["Amina", "Karim", "Sara", "N-M2", "N-P2", "Frames Co"]);
      const missing = (await A.val("[...window.i18n.missing]")).filter((s) => !data.has(s) && !formatted.some((re) => re.test(s)));
      R.ck(missing.length === 0, `${code}: every text of the dashboard has a translation`, missing.length ? "\n      " + missing.map((s) => JSON.stringify(s)).join("\n      ") : "");
    }
    await A.val("(() => { window.i18n.setLang('en', { persist: false }); return 1; })()");
    await sleep(600);
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch(async (error) => {
  console.log("ERR", error.stack);
  try { await A?.stop(); } catch { /* gone */ }
  process.exit(1);
});
