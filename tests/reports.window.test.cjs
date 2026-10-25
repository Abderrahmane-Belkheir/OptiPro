// The Reports page in the real app window (#reports): the period (shortcuts and lists), the headline figures with their comparison with the period before, the chart,
// the tables, the two cards about today (who owes, the stock), an empty shop, the way back to the page, and the French and Arabic versions.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-reportsw-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', createdAt: new Date('2025-02-01T10:00:00'), ...S } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c2', name: 'Karim', createdAt: new Date('2025-03-15T10:00:00'), ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, stock, price, costPrice) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, price, costPrice, currency: 'DZD', stock, ...S } });
  await frame('f1', 'Aviator', 3, 18500, 12000);
  await frame('f2', 'Persol 649', 0, 9000, 5000);
  await frame('f3', 'Wayfarer', 2, 10000, null);
  await p.accessory.create({ data: { id: 'a1', name: 'Case', description: 'Hard case', stock: 10, price: 1500, costPrice: 600, ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', priceCents: 500000, costCents: 300000, ...S } });
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
  // one order today, so the opening view (this month) has something in it
  await order('J', 'N-J', 'c2', new Date(Date.now() - 1000), 'confirmed', 123000, 123000, [['frame', { frameId: 'f1' }, 'Ray-Ban Aviator', 123000, 80000]]);
  const pay = (id, orderId, amountCents, at, cheque) => p.payment.create({ data: { id, orderId, amountCents, paidAt: new Date(at), chequeDueDate: cheque ? new Date(cheque) : null, ...S } });
  await pay('pa', 'A', 1500000, '2025-03-06T10:00:00');
  await pay('pb', 'B', 400000, '2025-03-21T10:00:00');
  await pay('pc', 'C', 100000, '2025-03-26T10:00:00');
  await pay('pd', 'D', 700000, '2025-04-03T10:00:00');
  await pay('pe', 'E', 500000, '2024-12-31T10:00:00');
  await pay('pq', 'F', 300000, '2025-04-12T10:00:00', '2025-06-01T10:00:00');
  await p.supplier.create({ data: { id: 's1', name: 'Lab One', ...S } });
  await p.supplier.create({ data: { id: 's2', name: 'Frames Co', ...S } });
  const buy = (id, supplierId, at, totalCents, status) => p.supplierOrder.create({ data: { id, supplierId, orderedAt: new Date(at), totalCents, status, ...S } });
  await buy('so1', 's1', '2025-03-10T10:00:00', 800000, 'received');
  await buy('so2', 's1', '2025-05-01T10:00:00', 200000, 'received');
  await buy('so3', 's2', '2025-03-15T10:00:00', 450000, 'cancelled');
  await buy('so4', 's2', '2025-03-18T10:00:00', 300000, 'received');
`,
);

const DATA = new Set(["Amina", "Karim", "Ray-Ban Aviator", "Stock 1.5", "Custom lens", "Case", "Persol 649", "Lab One", "Frames Co"]);

let A;
const go = async (hash, wait = 250) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await sleep(wait);
};
const ready = () => A.until("document.querySelector('[data-reports]')?.dataset.status === 'ready' && !!document.querySelector('[data-tiles]')");
const text = (selector) => A.val(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const money = (cents) => A.val(`new Intl.NumberFormat(undefined, { style: 'currency', currency: 'DZD', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(${cents} / 100)`);
const pick = async (name, value) => {
  await A.val(`(() => { const e = document.querySelector('[data-period=${name}]'); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await sleep(150);
  await ready();
};
const preset = async (key) => {
  await A.val(`(() => { document.querySelector('[data-preset=${key}]').click(); return 1; })()`);
  await sleep(150);
  await ready();
};

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.reports?.overview === 'function'");

    R.section("the page");
    R.ck(await A.val("!!document.querySelector('.nav-item[data-page=reports]')"), "the Reports entry is in the menu");
    await go("reports");
    R.ck(await ready(), "the report loads");
    R.ck((await text("#reports-title")) === "Reports" && (await A.val("document.querySelector('.nav-item[aria-current=page]')?.dataset.page")) === "reports", "it is the Reports page, and the menu says so");
    const now = new Date();
    const thisMonth = await A.val("new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' }).format(new Date())");
    R.ck((await text("[data-period-name]")) === thisMonth, "it opens on the current month", await text("[data-period-name]"));
    R.ck((await A.val("document.querySelector('[data-preset=this-month]').getAttribute('aria-pressed')")) === "true", "the shortcut for this month is pressed");
    R.ck((await text("[data-value=sales]")) === (await money(123000)) && (await text("[data-note=sales]")).includes("1 order"), "this month: the order placed today", await text("[data-value=sales]"));
    R.ck((await A.val("document.querySelectorAll('[data-point]').length")) === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), "a month is charted by day");

    R.section("a year, and the comparison");
    await pick("year", "2025");
    R.ck((await text("[data-period-name]")).includes("2025") && (await A.val("document.querySelector('[data-period=month]').value")) === String(now.getMonth() + 1), "choosing another year keeps the month (the same month, another year)");
    await pick("month", "");
    R.ck((await text("[data-period-name]")) === "2025", "the year is shown");
    R.ck((await text("[data-value=sales]")) === (await money(5200000)), "sales", await text("[data-value=sales]"));
    R.ck((await text("[data-value=collected]")) === (await money(3000000)), "money received (the cheque counted when it falls due)", await text("[data-value=collected]"));
    R.ck((await text("[data-value=profit]")) === (await money(1700000)), "net profit", await text("[data-value=profit]"));
    R.ck((await text("[data-note=profit]")).includes("42.5%") && (await A.val("[...document.querySelectorAll('[data-note=profit]')].some((n) => n.textContent.includes('2 orders have no known cost'))")), "the margin, and the orders left out because their cost is not known");
    R.ck((await text("[data-value=purchases]")) === (await money(1300000)) && (await text("[data-value=average]")) === (await money(1040000)) && (await text("[data-value=discounts]")) === (await money(350000)), "bought from suppliers, average order, discounts");
    const salesDelta = await A.val("(() => { const d = document.querySelector('[data-delta=sales]'); return { text: d.textContent, tone: d.className }; })()");
    R.ck(salesDelta.text.includes("▲") && salesDelta.text.includes("940%") && salesDelta.text.includes("vs the year before") && salesDelta.tone.includes("rep-delta--good"), "sales rose 940% against the year before, shown as good news", JSON.stringify(salesDelta));
    const buyDelta = await A.val("(() => { const d = document.querySelector('[data-delta=purchases]'); return { text: d.textContent, tone: d.className }; })()");
    R.ck(buyDelta.text.includes("Nothing before") && buyDelta.tone.includes("rep-delta--flat"), "no purchases the year before: said so, and not coloured", JSON.stringify(buyDelta));
    R.ck(!(await A.val("!!document.querySelector('[data-delta=discounts]') && document.querySelector('[data-delta=discounts]').className.includes('good')")), "a rise in discounts is not shown as good news");

    R.ck(!/\bnull\b|undefined|NaN/.test(await text("[data-reports]")) && !/\bnull\b|undefined/.test(await text(".rep")), "no stray null or undefined text on the page");

    R.section("the chart");
    R.ck((await A.val("document.querySelector('[data-chart]').dataset.chart")) === "month" && (await A.val("document.querySelectorAll('[data-point]').length")) === 12, "a year is charted by month");
    const march = await A.val("(() => { const c = document.querySelector('[data-point=\"2025-03\"]'); const [s, r] = c.children; return { sold: s.style.height, received: r.style.height, title: c.title }; })()");
    R.ck(march.sold === "100%" && Math.abs(parseFloat(march.received) - (2000000 / 3900000) * 100) < 0.01, "March is the tallest sold bar; the bar of what was received is in proportion", JSON.stringify(march));
    R.ck(march.title.includes("March") && march.title.includes(await money(3900000)) && march.title.includes(await money(2000000)), "hovering a month tells what was sold and received", march.title);
    R.ck((await A.val("document.querySelector('[data-point=\"2025-02\"]').children[0].style.height")) === "0px" || (await A.val("document.querySelector('[data-point=\"2025-02\"]').children[0].style.height")) === "0", "a month without sales has no bar");
    R.ck((await A.val("document.querySelector('.rep-chart__plot').getAttribute('aria-label')")).includes(await money(5200000)), "the chart is described for screen readers");

    R.section("the tables");
    R.ck((await A.val("[...document.querySelectorAll('[data-table=kinds] tbody tr')].map((r) => r.dataset.kind).join()")) === "frame,lens,accessory", "sales by type");
    R.ck((await text("[data-table=kinds] tr[data-kind=frame] [data-cell=sold]")) === (await money(3250000)) && (await text("[data-table=kinds] tr[data-kind=frame] [data-cell=profit]")) === (await money(1200000)), "frames: sold and profit");
    R.ck((await text("[data-table=kinds] tr[data-kind=lens] [data-cell=profit]")).includes("1 without known cost"), "lenses: the line with no known cost is said");
    R.ck((await text("[data-section=statuses] [data-count=confirmed]")) === "3" && (await text("[data-section=statuses] [data-count=delivered]")) === "2" && (await text("[data-section=statuses] [data-count=cancelled]")) === "1", "orders by status");
    R.ck((await A.val("document.querySelector('[data-table=products] tbody tr').dataset.product")) === "Ray-Ban Aviator", "the best seller comes first");
    R.ck((await A.val("document.querySelector('[data-table=customers] tbody tr a').getAttribute('href')")) === "#customers/c1", "the best customer opens their page");
    R.ck((await A.val("[...document.querySelectorAll('[data-table=suppliers] tbody tr')].map((r) => r.children[0].textContent + ':' + r.children[1].textContent).join()")) === "Lab One:2,Frames Co:1", "spent with each supplier");

    R.section("today");
    R.ck((await ready()) && (await A.until("document.querySelector('[data-section=debtors]')?.dataset.status === 'ready' && document.querySelector('[data-section=stock]')?.dataset.status === 'ready'")), "the two cards about today load by themselves");
    R.ck((await text("[data-value=owed]")) === (await money(3023000)), "who owes: the orders not fully paid", await text("[data-value=owed]"));
    R.ck((await A.val("document.querySelector('[data-debtor] ')?.getAttribute('href')")) === "#customers/c1", "a debtor opens their page");
    R.ck((await text("tr[data-stock=total] [data-cell=cost]")) === (await money(4200000)) && (await text("tr[data-stock=total] [data-cell=price]")) === (await money(9050000)), "the stock at cost and at selling price");
    R.ck((await text("[data-nocost]")).includes("1 product in stock has no cost") && (await text("[data-outofstock]")).includes("1 product is out of stock"), "the products with no cost, and the ones out of stock, are said");
    R.ck((await A.val("document.querySelector('[data-section=debtors]').dataset.status")) === "ready" && !(await A.val("!!document.querySelector('.dash-error')")), "no card failed");

    R.section("the period");
    await pick("month", "3");
    R.ck((await A.val("document.querySelectorAll('[data-point]').length")) === 31 && (await A.val("document.querySelector('[data-chart]').dataset.chart")) === "day", "year and month: charted by day");
    R.ck((await text("[data-value=sales]")) === (await money(3900000)), "March sales", await text("[data-value=sales]"));
    R.ck((await text("[data-delta=sales]")).includes("vs the month before"), "a month is compared with the month before");
    await pick("year", "");
    R.ck((await A.val("document.querySelector('[data-period=month]').disabled")) && (await A.val("document.querySelector('[data-period=month]').value")) === "", "without a year there is no month to choose");
    R.ck((await A.val("document.querySelector('[data-chart]').dataset.chart")) === "year" && !(await A.val("!!document.querySelector('[data-delta]')")), "everything: charted by year, nothing to compare with");
    R.ck((await A.val("document.querySelector('[data-preset=all]').getAttribute('aria-pressed')")) === "true", "the All time shortcut is pressed");
    await preset("this-year");
    R.ck((await A.val("document.querySelector('[data-period=year]').value")) === String(now.getFullYear()) && (await A.val("document.querySelector('[data-period=month]').value")) === "", "the This year shortcut");
    await preset("last-month");
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    R.ck((await A.val("document.querySelector('[data-period=year]').value")) === String(last.getFullYear()) && (await A.val("document.querySelector('[data-period=month]').value")) === String(last.getMonth() + 1), "the Last month shortcut");
    await preset("this-month");
    R.ck((await text("[data-period-name]")) === thisMonth, "back to this month");

    R.section("coming back");
    await pick("year", "2025");
    await go("dashboard", 400);
    R.ck(!(await A.val("!!document.querySelector('[data-reports]')")), "the report leaves when another page opens");
    await go("reports");
    await ready();
    R.ck((await text("[data-period-name]")) === thisMonth, "coming back opens on the current month again");

    R.section("languages");
    for (const code of ["fr", "ar"]) {
      await A.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(800);
      await A.until(`window.i18n?.lang === ${JSON.stringify(code)} && !!document.querySelector('#content')`);
      await go("reports", 500);
      await ready();
      await A.until("document.querySelector('[data-section=stock]')?.dataset.status === 'ready'");
      for (const [year, month] of [["2025", "3"], ["2025", ""], ["", ""]]) {
        await pick("year", year);
        if (year) await pick("month", month);
        await sleep(200);
      }
      await preset("this-month");
      await sleep(300);
      const formatted = [/^[\d\s.,:+·×°%  -]*(DZD|EUR|USD)?[\d\s.,  ]*$/, /^[^\s\d]*\s?\d{1,2}\s[^\s\d]+\.?(\s\d{4})?(\s\(.*\))?$/, /^[^\s\d]{1,3}\.?$/, /^\d+ [^\s\d]+\.?: /, /^[A-Z]{1,3}$/, /^[^\s\d]+ \d{4}$/, /^[\d\s.,  ]+ ?[kKMB  ]* ?(DZD)?$/, /^[a-zA-Zéû]{3,5}\.?$/]; // (also the short amounts of the chart and the short month names: made by Intl)
      const missing = (await A.val("[...window.i18n.missing]")).filter((s) => !DATA.has(s) && !formatted.some((re) => re.test(s)));
      R.ck(missing.length === 0, `${code}: every text of the report has a translation`, missing.length ? "\n      " + missing.map((s) => JSON.stringify(s)).join("\n      ") : "");
      R.ck((await text("[data-tile=sales] .rep-tile__label")) === (code === "fr" ? "Ventes" : "المبيعات"), `${code}: the tiles are translated`, await text("[data-tile=sales] .rep-tile__label"));
      if (code === "ar") R.ck(await A.val("getComputedStyle(document.querySelector('.rep-tiles')).direction === 'rtl'"), "ar: the page is right to left");
    }
    await A.val("(() => { window.i18n.setLang('en', { persist: false }); return 1; })()");
    await sleep(800);

    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }

  // a shop with nothing in it: the page shows zeros and kind words, never an error
  const empty = sandbox("op-reportsw2-");
  empty.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
  runScript(empty, `await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });`);
  A = await launchApp(empty);
  try {
    R.section("an empty shop");
    await A.until("typeof window.electronAPI?.reports?.overview === 'function'");
    await go("reports", 400);
    R.ck(await ready(), "the report loads");
    R.ck((await text("[data-value=sales]")) === (await money(0)) && (await text("[data-value=profit]")) === (await money(0)), "zeros", await text("[data-value=sales]"));
    R.ck((await text("[data-section=chart]")).includes("Nothing was sold or received in this period.") && (await text("[data-section=kinds]")).includes("No sale in this period.") && (await text("[data-section=statuses]")).includes("No order in this period."), "the empty sections say so");
    R.ck(await A.until("document.querySelector('[data-section=debtors]')?.dataset.status === 'ready'") && (await text("[data-section=debtors]")).includes("Every order is paid."), "nobody owes anything");
    R.ck(!/NaN|Infinity/.test(await text("[data-reports]")), "no NaN or Infinity anywhere");
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
