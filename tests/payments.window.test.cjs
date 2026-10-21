// The Payments page in the real app window: the payments list, search, the day / month / year period with its Show button,
// totals (a cheque dated after today is "to collect"), customer links, empty states. Also checks the data service the page reads from.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-payments-");
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
  await p.order.create({ data: { id: 'o1', number: 'CMD-0001', status: 'confirmed', customerId: 'c1', totalCents: 100000, subtotalCents: 100000, ...S } });
  await p.order.create({ data: { id: 'o2', number: 'CMD-0002', status: 'ready', customerId: 'c2', totalCents: 50000, subtotalCents: 50000, ...S } });
  const pay = (id, o) => p.payment.create({ data: { id, ...o, ...S } });
  await pay('p1', { orderId: 'o1', amountCents: 30000, paidAt: day(0) });
  await pay('p2', { orderId: 'o2', amountCents: 20000, paidAt: day(-1) });
  await pay('p3', { orderId: 'o1', customerId: 'c1', amountCents: 10000, chequeDueDate: day(-2), paidAt: day(-2) });
  await pay('pf', { orderId: 'o1', amountCents: 99000, chequeDueDate: day(10), paidAt: day(0) });
  await pay('p4', { orderId: 'o2', amountCents: 5000, chequeDueDate: day(-1), paidAt: day(-3) });
  await pay('p5', { customerId: 'c2', amountCents: 7000, paidAt: day(-40) });
`,
);

let A;
const pick = (name, v) => A.val(`(() => { const e = document.querySelector('[data-period=${name}]'); e.value = '${v}'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
const confirm = () => A.val("(() => { document.querySelector('[data-apply]').click(); return 1; })()");
const ready = "document.querySelector('[data-payments]')?.dataset.status === 'ready'";
// The page opens on today; most checks want every payment, so go() blanks the year unless told to keep the period.
const go = async (hash, keepPeriod = false) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await sleep(150);
  await A.until(ready);
  if (!keepPeriod && (await A.val("document.querySelector('[data-period=year]').value")) !== "") {
    await pick("year", "");
    await confirm();
    await sleep(150);
    await A.until(ready);
  }
};

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.paymentsView?.list === 'function'");
    const rows = () => A.val("[...document.querySelectorAll('[data-payments] tbody tr')].map((r) => r.dataset.id).join()");
    const cell = (id, c) => A.val(`document.querySelector('tr[data-id=${id}] [data-cell=${c}]').textContent`);
    const type = (value) => A.val(`(() => { const e = document.querySelector('[data-search]'); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    const svc = (f) => A.val(`window.electronAPI.paymentsView.list(${JSON.stringify(f)})`);
    const ids = async (f) => (await svc(f)).rows.map((r) => r.id).join();

    R.section("service");
    const all = await svc({});
    R.ck(all.rows.map((r) => r.id).join() === "p1,p2,p3,p4,p5", "all payments, newest first", all.rows.map((r) => r.id).join());
    R.ck(!all.rows.some((r) => r.id === "pf") && all.totals.payments === 5 && all.totals.collectedCents === 72000, "a cheque dated after today is not money in: it is left out of the list and the totals", JSON.stringify(all.totals));
    const byId = Object.fromEntries(all.rows.map((r) => [r.id, r]));
    R.ck(byId.p1.customerName === "Amina Benali" && byId.p1.orderNumber === "CMD-0001", "the customer comes from the order when the payment has none");
    R.ck(byId.p5.orderNumber === null && byId.p5.customerName === "Karim Haddad", "a payment with no order keeps its customer");
    R.ck((await ids({ query: "amina" })) === "p1,p3", "search by customer name");
    R.ck((await ids({ query: "cmd-0002" })) === "p2,p4", "search by order number");
    R.ck((await svc({ limit: 2 })).shown === 2, "limit");
    R.ck(await A.val("window.electronAPI.paymentsView.list({ month: 3 }).then(() => false, () => true)"), "a month without a year is refused");
    const parts = (r) => { const d = new Date(r.paidAt); return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }; };
    const t0 = parts(byId.p1);
    const sameDay = all.rows.filter((r) => { const q = parts(r); return q.y === t0.y && q.m === t0.m && q.d === t0.d; }).map((r) => r.id).join();
    const sameMonth = all.rows.filter((r) => { const q = parts(r); return q.y === t0.y && q.m === t0.m; }).map((r) => r.id).join();
    const sameYear = all.rows.filter((r) => parts(r).y === t0.y).map((r) => r.id).join();
    R.ck((await ids({ year: t0.y, month: t0.m, day: t0.d })) === sameDay, "period: one day");
    R.ck((await ids({ year: t0.y, month: t0.m })) === sameMonth, "period: one month");
    R.ck((await ids({ year: t0.y })) === sameYear, "period: one year");
    R.ck((await ids({ year: 2001 })) === "", "period: a year with no payment is empty");
    R.ck(all.years.includes(t0.y) && all.years.every((y, i, a) => i === 0 || a[i - 1] > y), "years that have payments, newest first");

    R.section("page");
    await go("payments", true);
    const now = new Date();
    R.ck(await A.val(`['year', 'month', 'day'].map((n) => document.querySelector('[data-period=' + n + ']').value).join() === '${now.getFullYear()},${now.getMonth() + 1},${now.getDate()}'`), "the page opens on today");
    R.ck((await rows()).split(",")[0] === "p1" && (await rows()).split(",").includes("p1"), "and shows today's payment");
    await go("payments");
    R.ck((await rows()) === "p1,p2,p3,p4,p5", "with no period the table lists every payment");
    R.ck(await A.val("/720/.test(document.querySelector('[data-tile=collected] .summary__value').textContent) && !document.querySelector('[data-tile=pending]')"), "the totals strip shows only the money in (720)");
    R.ck(await A.val("document.querySelector('tr[data-id=p1] [data-cell=customer] a').getAttribute('href') === '#customers/c1'"), "the customer name links to the customer");
    R.ck((await cell("p1", "order")) === "CMD-0001", "the order number is shown");
    R.ck((await cell("p3", "cheque")).startsWith("Dated") && !(await A.val("!!document.querySelector('tr[data-id=pf]')")), "a cheque shows its date, and the future one is not listed");
    R.ck((await cell("p1", "cheque")) === "—", "no cheque date for cash");

    await A.until(`${ready} && document.querySelectorAll('[data-payments] tbody tr').length === 2`);

    await go("payments");
    await type("haddad");
    await A.until("document.querySelectorAll('[data-payments] tbody tr').length === 2");
    R.ck((await rows()) === "p2,p4,p5", "search narrows the table", await rows());
    await type("zzzz");
    await A.until("document.querySelector('[data-state=empty]')");
    R.ck(await A.val("/No payment matches/.test(document.querySelector('[data-state=empty]').textContent)"), "no match shows an empty state");
    await type("");
    await sleep(450);

    await go("payments");
    await pick("year", t0.y);
    await sleep(200);
    R.ck((await rows()).split(",").length === 5 || sameYear.split(",").length === 5, "choosing in a list does not search until Show payments is pressed");
    await confirm();
    await A.until(`document.querySelectorAll('[data-payments] tbody tr').length === ${sameYear.split(",").length}`);
    R.ck((await rows()) === sameYear, "choosing a year shows that year");
    await pick("month", t0.m);
    await confirm();
    await A.until(`document.querySelectorAll('[data-payments] tbody tr').length === ${sameMonth.split(",").length}`);
    R.ck((await rows()) === sameMonth, "choosing a month narrows it");
    await pick("day", t0.d);
    await confirm();
    await A.until(`document.querySelectorAll('[data-payments] tbody tr').length === ${sameDay.split(",").length}`);
    R.ck((await rows()) === sameDay, "choosing a day narrows it again");


    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
