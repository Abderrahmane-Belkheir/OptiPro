// The Orders page in the real app window: the orders list, status chips with counts, search, totals, overdue marking, customer links, empty states.
// Also checks the data service (window.electronAPI.sales.list) the page reads from.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-sales-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  const day = (n) => new Date(Date.now() + n * 86400000);
  await p.customer.create({ data: { id: 'c1', name: 'Amina Benali', ...S } });
  await p.customer.create({ data: { id: 'c2', name: 'Karim Haddad', ...S } });
  const order = (id, number, status, customerId, ordered, promised, total, extra = {}) => p.order.create({ data: { id, number, status, customerId, orderedAt: day(ordered), promisedAt: promised === null ? null : day(promised), totalCents: total, subtotalCents: total, ...extra, ...S } });
  await order('o1', 'CMD-0001', 'delivered', 'c1', -30, -25, 100000, { deliveredAt: day(-24) });
  await order('o2', 'CMD-0002', 'at_lab', 'c1', -10, -3, 80000);
  await order('o3', 'CMD-0003', 'ready', 'c2', -5, 5, 60000);
  await order('o4', 'CMD-0004', 'confirmed', null, -1, 7, 20000);
  await order('o5', 'CMD-0005', 'cancelled', 'c2', -2, 3, 50000);
  const pay = (id, orderId, amountCents) => p.payment.create({ data: { id, orderId, amountCents, ...S } });
  await pay('p1', 'o1', 100000);
  await pay('p2', 'o2', 30000);
  await pay('p3', 'o3', 10000);
  await pay('p4', 'o3', 5000);
  await pay('p5', 'o5', 20000);
`,
);

let A;
// Choosing in a list only changes the draft; confirm() presses the button that applies it.
const pick = (name, v) => A.val(`(() => { const e = document.querySelector('[data-period=${name}]'); e.value = '${v}'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
const confirm = () => A.val("(() => { document.querySelector('[data-apply]').click(); return 1; })()");
// The page opens on today; most checks want every order, so go() blanks the year unless told to keep the period.
const go = async (hash, keepPeriod = false) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await sleep(150);
  await A.until("document.querySelector('[data-sales]')?.dataset.status === 'ready'");
  if (!keepPeriod && (await A.val("document.querySelector('[data-period=year]').value")) !== "") {
    await pick("year", "");
    await confirm();
    await sleep(150);
    await A.until("document.querySelector('[data-sales]')?.dataset.status === 'ready'");
  }
};

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.sales?.list === 'function'");
    const rows = () => A.val("[...document.querySelectorAll('[data-sales] tbody tr')].map((r) => r.dataset.id).join()");
    const cell = (id, c) => A.val(`document.querySelector('tr[data-id=${id}] [data-cell=${c}]').textContent`);
    const type = (value) => A.val(`(() => { const e = document.querySelector('[data-search]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);

    R.section("service");
    const all = await A.val("window.electronAPI.sales.list({})");
    R.ck(all.rows.map((r) => r.id).join() === "o4,o5,o3,o2,o1", "all orders, newest first", all.rows.map((r) => r.id).join());
    R.ck(JSON.stringify(all.counts) === JSON.stringify({ all: 5, confirmed: 1, at_lab: 1, ready: 1, delivered: 1, cancelled: 1 }), "counts per status", JSON.stringify(all.counts));
    R.ck(all.totals.orders === 4 && all.totals.valueCents === 260000 && all.totals.paidCents === 145000 && all.totals.remainingCents === 115000, "totals leave the cancelled order out", JSON.stringify(all.totals));
    const byId = Object.fromEntries(all.rows.map((r) => [r.id, r]));
    R.ck(byId.o3.paidCents === 15000 && byId.o3.remainingCents === 45000, "payments on one order are added up");
    R.ck(byId.o5.remainingCents === 0, "a cancelled order owes nothing");
    R.ck(byId.o2.overdue === true && byId.o1.overdue === false && byId.o3.overdue === false && byId.o5.overdue === false, "overdue = promised day passed and still open");
    R.ck(byId.o4.customerName === "Walk-in customer" && byId.o1.customerName === "Amina Benali", "walk-in customer name");
    R.ck((await A.val("window.electronAPI.sales.list({ status: 'ready' })")).rows.map((r) => r.id).join() === "o3", "status filter");
    R.ck((await A.val("window.electronAPI.sales.list({ query: 'amina' })")).rows.map((r) => r.id).join() === "o2,o1", "search by customer name");
    R.ck((await A.val("window.electronAPI.sales.list({ query: 'cmd-0004' })")).rows.map((r) => r.id).join() === "o4", "search by order number");
    R.ck((await A.val("window.electronAPI.sales.list({ limit: 2 })")).shown === 2, "limit");
    R.ck(await A.val("window.electronAPI.sales.list({ status: 'bogus' }).then(() => false, () => true)"), "unknown status is refused");

    const parts = (r) => { const d = new Date(r.orderedAt); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; };
    const o4 = parts(byId.o4);
    const sameDay = all.rows.filter((r) => { const p = parts(r); return p.y === o4.y && p.m === o4.m && p.d === o4.d; }).map((r) => r.id).join();
    const sameMonth = all.rows.filter((r) => { const p = parts(r); return p.y === o4.y && p.m === o4.m; }).map((r) => r.id).join();
    const sameYear = all.rows.filter((r) => parts(r).y === o4.y).map((r) => r.id).join();
    const ids = async (f) => (await A.val(`window.electronAPI.sales.list(${JSON.stringify(f)})`)).rows.map((r) => r.id).join();
    R.ck((await ids({ year: o4.y, month: o4.m, day: o4.d })) === sameDay, "period: one day");
    R.ck((await ids({ year: o4.y, month: o4.m })) === sameMonth, "period: one month");
    R.ck((await ids({ year: o4.y })) === sameYear, "period: one year");
    R.ck((await ids({ year: 2001 })) === "", "period: a year with no order is empty");
    R.ck(all.years.includes(o4.y) && all.years.every((y, i, a) => i === 0 || a[i - 1] > y), "years that have orders, newest first");
    R.ck(await A.val("window.electronAPI.sales.list({ month: 3 }).then(() => false, () => true)"), "a month without a year is refused");
    R.ck((await A.val(`window.electronAPI.sales.list({ year: ${o4.y}, month: ${o4.m} })`)).totals.orders <= 4, "totals follow the period");

    R.section("page");
    await go("orders", true);
    const now = new Date();
    R.ck(await A.val(`['year', 'month', 'day'].map((n) => document.querySelector('[data-period=' + n + ']').value).join() === '${now.getFullYear()},${now.getMonth() + 1},${now.getDate()}'`), "the page opens on today (year, month and day)");
    R.ck(await A.val("document.querySelectorAll('[data-period=month] option').length === 13 && document.querySelector('[data-period=month] option').value === ''"), "the month list has the 12 months and a blank one that says Whole year");
    R.ck(await A.val("document.querySelector('[data-period=month] option').textContent === 'Whole year' && document.querySelector('[data-period=day] option').textContent === 'Whole month' && document.querySelector('[data-period=year] option').textContent === 'All years'"), "the blank entries say what they mean");
    R.ck(await A.val(`document.querySelectorAll('[data-period=day] option').length === ${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() + 1} && document.querySelector('[data-period=day] option').value === ''`), "the day list has the month's days and a blank one");
    await pick("day", "");
    await confirm();
    await sleep(200);
    R.ck(await A.val("document.querySelector('[data-period=day]').value === '' && document.querySelector('[data-period=month]').value !== ''"), "a blank day shows the whole month");
    await pick("month", "");
    await confirm();
    await sleep(200);
    R.ck(await A.val("document.querySelector('[data-period=month]').value === '' && document.querySelector('[data-period=day]').disabled && document.querySelector('[data-period=year]').value !== ''"), "a blank month shows the whole year (and the day list is empty)");
    await go("orders");
    R.ck((await rows()) === "o4,o5,o3,o2,o1", "the table lists the orders");
    R.ck(await A.val("[...document.querySelectorAll('[data-chips] .chip')].map((c) => c.textContent).join('|') === 'All5|Confirmed1|At the lab1|Ready1|Delivered1|Cancelled1'"), "chips show the counts");
    R.ck(await A.val("/1[\\s,.\\u202f\\u00a0]?150/.test(document.querySelector('[data-tile=left] .summary__value').textContent)"), "the totals strip shows what is left to pay (1150)");
    R.ck((await cell("o4", "customer")) === "Walk-in customer", "walk-in order");
    R.ck(await A.val("document.querySelector('tr[data-id=o2] [data-cell=customer] a').getAttribute('href') === '#customers/c1'"), "the customer name links to the customer");
    R.ck(await A.val("!!document.querySelector('tr[data-id=o2] [data-overdue]') && !document.querySelector('tr[data-id=o3] [data-overdue]')"), "overdue marked on the late order only");
    R.ck((await cell("o5", "left")) === "\u2014", "cancelled order shows no amount left");

    await A.val("document.querySelector('[data-chips] [data-status=ready]').click()");
    await A.until("location.hash === '#orders/ready'");
    await A.until("document.querySelector('[data-sales]')?.dataset.status === 'ready' && document.querySelectorAll('[data-sales] tbody tr').length === 1");
    R.ck((await rows()) === "o3", "a chip filters by status through the address");
    R.ck(await A.val("document.querySelector('[data-chips] [data-status=ready]').getAttribute('aria-pressed') === 'true'"), "and is pressed");

    await go("orders");
    await type("haddad");
    await A.until("document.querySelectorAll('[data-sales] tbody tr').length === 2");
    R.ck((await rows()) === "o5,o3", "search narrows the table");
    await type("zzzz");
    await A.until("document.querySelector('[data-state=empty]')");
    R.ck(await A.val("/No order matches/.test(document.querySelector('[data-state=empty]').textContent)"), "no match shows an empty state");

    await type("");
    await sleep(450);
    await go("orders");
    R.ck(await A.val("document.querySelector('[data-period=month]').disabled && document.querySelector('[data-period=day]').disabled"), "month and day wait for the year / month");
    await pick("year", o4.y);
    await sleep(200);
    R.ck((await rows()).split(',').length === 5, "choosing in a list does not search until Show orders is pressed");
    await confirm();
    await A.until(`document.querySelectorAll('[data-sales] tbody tr').length === ${sameYear.split(',').length}`);
    R.ck((await rows()) === sameYear, "choosing a year shows that year's orders");
    await pick("month", o4.m);
    await confirm();
    await A.until(`document.querySelectorAll('[data-sales] tbody tr').length === ${sameMonth.split(',').length}`);
    R.ck((await rows()) === sameMonth, "choosing a month narrows it");
    await pick("day", o4.d);
    await confirm();
    await A.until(`document.querySelectorAll('[data-sales] tbody tr').length === ${sameDay.split(',').length}`);
    R.ck((await rows()) === sameDay, "choosing a day narrows it again");
    await pick("year", "");
    await confirm();
    await A.until("document.querySelectorAll('[data-sales] tbody tr').length === 5");
    R.ck(await A.val("document.querySelector('[data-period=month]').disabled && document.querySelector('[data-period=month]').value === ''"), "clearing the year clears month and day");

    await go("orders/delivered");
    R.ck((await rows()) === "o1", "deep link to a status works");
    R.ck((await cell("o1", "promised")).startsWith("Delivered"), "a delivered order shows its delivery date");

    await go("orders/nope").catch(() => {});
    R.ck(await A.val("!document.querySelector('[data-sales]')"), "an unknown status is not this page");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
