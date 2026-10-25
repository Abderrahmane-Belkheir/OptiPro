// The order page in the real app window: the customer, the money (total / paid / left), the payments with their date and extra, the items, switching
// the status, and taking a payment while something is left. Also checks the data service the page uses.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-order-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  const day = (n) => new Date(Date.now() + n * 86400000);
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina Benali', phone: '0550 11 22 33', ...S } });
  await p.order.create({ data: { id: 'o1', number: 'CMD-0001', status: 'confirmed', customerId: 'c1', orderedAt: day(-5), promisedAt: day(-1), totalCents: 100000, subtotalCents: 110000, discountCents: 10000, notes: 'Call before delivery', ...S } });
  await p.orderItem.create({ data: { id: 'i1', orderId: 'o1', kind: 'frame', description: 'Aviator Classic', quantity: 1, unitPriceCents: 60000, totalCents: 60000, ...S } });
  await p.orderItem.create({ data: { id: 'i2', orderId: 'o1', kind: 'lens', description: 'Progressive 1.6', eye: 'both', quantity: 2, unitPriceCents: 25000, totalCents: 50000, ...S } });
  await p.payment.create({ data: { id: 'p1', orderId: 'o1', customerId: 'c1', amountCents: 30000, paidAt: day(-5), notes: 'Deposit', ...S } });
  await p.payment.create({ data: { id: 'p2', orderId: 'o1', customerId: 'c1', amountCents: 20000, paidAt: day(-2), chequeDueDate: day(-1), ...S } });
  await p.order.create({ data: { id: 'o2', number: 'CMD-0002', status: 'delivered', customerId: null, orderedAt: day(-9), deliveredAt: day(-8), totalCents: 40000, subtotalCents: 40000, ...S } });
  await p.payment.create({ data: { id: 'p3', orderId: 'o2', amountCents: 40000, paidAt: day(-9), ...S } });
`,
);

let A;
const open = async (id) => {
  await A.val(`(() => { location.hash = 'orders/${id}'; return 1; })()`);
  await A.until(`document.querySelector('[data-order-page]')?.dataset.id === '${id}' || document.querySelector('[data-error]')`);
};
const text = (sel) => A.val(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.orderDetails?.get === 'function'");
    const svc = (call) => A.val(call);
    const fails = (call) => A.val(`(${call}).then(() => false, (e) => String(e.message))`);

    R.section("service");
    const o1 = await svc("window.electronAPI.orderDetails.get('o1')");
    R.ck(o1.totalCents === 100000 && o1.paidCents === 50000 && o1.remainingCents === 50000 && o1.canPay === true, "money: total, paid, left", JSON.stringify([o1.totalCents, o1.paidCents, o1.remainingCents]));
    R.ck(o1.customer.name === "Amina Benali" && o1.items.length === 2 && o1.payments.length === 2, "customer, 2 items, 2 payments");
    R.ck(o1.payments[0].id === "p2" && o1.payments[1].notes === "Deposit", "payments newest first, with their notes");
    R.ck(o1.overdue === true, "promised yesterday and still open: overdue");
    const o2 = await svc("window.electronAPI.orderDetails.get('o2')");
    R.ck(o2.remainingCents === 0 && o2.canPay === false && o2.customer === null, "a paid order has nothing left to pay (and no customer: walk-in)");
    R.ck(/does not exist/.test(await fails("window.electronAPI.orderDetails.get('nope')")), "unknown order is a clear error");
    R.ck(/above 0/.test(await fails("window.electronAPI.orderDetails.pay('o1', { amountCents: 0 })")) && /above 0/.test(await fails("window.electronAPI.orderDetails.pay('o1', { amountCents: 1.5 })")), "the amount must be a whole number above 0");
    R.ck(/more than what is left/.test(await fails("window.electronAPI.orderDetails.pay('o1', { amountCents: 50001 })")), "more than what is left is refused");
    R.ck(/nothing is left/.test(await fails("window.electronAPI.orderDetails.pay('o2', { amountCents: 100 })")), "nothing is taken on a paid order");
    R.ck(/must be one of/.test(await fails("window.electronAPI.orderDetails.setStatus('o1', 'lost')")), "unknown status is refused");

    R.section("page");
    await A.val("(() => { location.hash = 'orders'; return 1; })()");
    await A.until("document.querySelector('[data-sales]')?.dataset.status === 'ready'");
    await A.val("(() => { document.querySelector('[data-period=year]').value = ''; document.querySelector('[data-period=year]').dispatchEvent(new Event('change')); document.querySelector('[data-apply]').click(); return 1; })()");
    await A.until("document.querySelector('tr[data-id=o1]')");
    await A.val("document.querySelector('tr[data-id=o1] [data-cell=number]').click()");
    await A.until("document.querySelector('[data-order-page]')?.dataset.id === 'o1'");
    R.ck((await A.val("location.hash")) === "#orders/o1", "the order number in the list opens the order");
    R.ck((await text("[data-number]")) === "CMD-0001", "shows the order number");
    R.ck(await A.val("/Amina Benali/.test(document.querySelector('[data-customer]').textContent) && /0550 11 22 33/.test(document.querySelector('[data-customer]').textContent) && document.querySelector('[data-customer] a').getAttribute('href') === '#customers/c1'"), "shows the customer (a link) and phone");
    R.ck(await A.val("!!document.querySelector('[data-overdue]')"), "marks it overdue");
    R.ck(await A.val("/1[\\s,.\\u202f\\u00a0]?000/.test(document.querySelector('[data-tile=total] .summary__value').textContent) && /500/.test(document.querySelector('[data-tile=paid] .summary__value').textContent) && /500/.test(document.querySelector('[data-tile=left] .summary__value').textContent)"), "shows total 1000, paid 500, left 500");
    R.ck(await A.val("document.querySelector('[data-order-page] [data-status]').dataset.status === 'confirmed' && document.querySelector('[data-set-status=confirmed]').getAttribute('aria-pressed') === 'true'"), "shows the status, pressed in the switch");
    R.ck((await A.val("document.querySelectorAll('[data-payments-table] tbody tr').length")) === 2 && (await A.val("document.querySelector('tr[data-payment=p1] [data-cell=extra]').textContent")) === "Deposit" && (await A.val("/^Cheque dated/.test(document.querySelector('tr[data-payment=p2] [data-cell=extra]').textContent)")), "lists the payments with date and extra (note, or cheque date)");
    R.ck((await A.val("document.querySelectorAll('[data-items-table] tbody tr').length")) === 2 && (await text("[data-discount]")).includes("100"), "lists the items and the discount");
    R.ck((await text("[data-notes]")) === "Call before delivery", "shows the order's notes");

    R.section("take a payment");
    const type = (sel, v) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; return 1; })()`);
    R.ck((await A.val("document.querySelector('[data-pay-amount]').value")) === "500", "the form offers what is left to pay");
    await type("[data-pay-amount]", "600");
    await A.val("document.querySelector('[data-pay-submit]').click()");
    await A.until("document.querySelector('[data-message]')");
    R.ck(await A.val("/more than what is left/.test(document.querySelector('[data-message]').textContent)"), "more than what is left: refused with a message");
    R.ck((await A.val("document.querySelectorAll('[data-payments-table] tbody tr').length")) === 2, "and nothing was taken");
    await type("[data-pay-amount]", "200");
    await type("[data-pay-note]", "Second installment");
    await A.val("document.querySelector('[data-pay-submit]').click()");
    await A.until("!!document.querySelector('[data-pay-confirm]')");
    await sleep(700);
    await A.val("document.querySelector('[data-pay-confirm-yes]').click()");
    await A.until("document.querySelectorAll('[data-payments-table] tbody tr').length === 3");
    R.ck(await A.val("/700/.test(document.querySelector('[data-tile=paid] .summary__value').textContent) && /300/.test(document.querySelector('[data-tile=left] .summary__value').textContent)"), "paying 200 makes paid 700 and left 300");
    R.ck(await A.val("[...document.querySelectorAll('[data-payments-table] [data-cell=extra]')].some((c) => c.textContent === 'Second installment')"), "the new payment is listed with its note");
    R.ck(await A.val("!document.querySelector('[data-message]') && !!document.querySelector('[data-pay]')"), "the form stays while something is left");
    await type("[data-pay-amount]", "300");
    await A.val("document.querySelector('[data-pay-submit]').click()");
    await A.until("!!document.querySelector('[data-pay-confirm]')");
    await sleep(700);
    await A.val("document.querySelector('[data-pay-confirm-yes]').click()");
    await A.until("!document.querySelector('[data-pay]') && !document.querySelector('[data-pay-confirm]')");
    R.ck(await A.val("/1[\\s,.\\u202f\\u00a0]?000/.test(document.querySelector('[data-tile=paid] .summary__value').textContent) && document.querySelector('[data-tile=left]').classList.contains('summary__tile--due') === false"), "paying the rest: paid 1000, nothing left");
    R.ck(await A.val("!document.querySelector('[data-pay]')"), "and the payment form is gone");
    const payments = await svc("window.electronAPI.paymentsView.list({})");
    R.ck(payments.rows.filter((r) => r.orderId === "o1").length === 4, "the payments also show on the Payments page");

    R.section("status");
    await A.val("document.querySelector('[data-set-status=ready]').click()");
    R.ck(await A.val("document.querySelector('[data-set-status=ready]').getAttribute('aria-pressed') === 'true' && document.querySelector('[data-order-page] [data-status]').dataset.status === 'confirmed' && !!document.querySelector('[data-confirm-status]')"), "choosing a status does not change the order: Confirm and Cancel appear");
    R.ck(await A.val("(() => { const row = document.querySelector('[data-status-switch]').getBoundingClientRect(); const ok = document.querySelector('[data-confirm-status]').getBoundingClientRect(); return Math.abs((row.top + row.bottom) / 2 - (ok.top + ok.bottom) / 2) < 20 && ok.left >= row.right - 2; })()"), "on the same line as the options, after them");
    R.ck(await A.val("!document.querySelector('.od-section [data-status-change]') && !/\\?/.test(document.querySelector('[data-status-confirm]').textContent)"), "with no question");
    R.ck((await svc("window.electronAPI.orderDetails.get('o1')")).status === "confirmed", "nothing was saved yet");
    await A.val("document.querySelector('[data-cancel-status]').click()");
    R.ck(await A.val("!document.querySelector('[data-status-confirm]') && document.querySelector('[data-set-status=confirmed]').getAttribute('aria-pressed') === 'true'"), "Cancel puts the choice back");
    await A.val("document.querySelector('[data-set-status=ready]').click()");
    await A.val("document.querySelector('[data-set-status=confirmed]').click()");
    R.ck(await A.val("!document.querySelector('[data-status-confirm]')"), "choosing the current status again asks for nothing");
    await A.val("document.querySelector('[data-set-status=at_lab]').click()");
    await A.val("document.querySelector('[data-confirm-status]').click()"); // choosing is not enough: Confirm applies it
    await A.until("document.querySelector('[data-order-page] [data-status]').dataset.status === 'at_lab'");
    R.ck(await A.val("document.querySelector('[data-set-status=at_lab]').getAttribute('aria-pressed') === 'true' && document.querySelector('[data-set-status=confirmed]').getAttribute('aria-pressed') === 'false'"), "switching to At the lab");
    await A.val("document.querySelector('[data-set-status=delivered]').click()");
    await A.val("document.querySelector('[data-confirm-status]').click()"); // choosing is not enough: Confirm applies it
    await A.until("document.querySelector('[data-order-page] [data-status]').dataset.status === 'delivered'");
    R.ck(await A.val("/Delivered/.test(document.querySelector('[data-customer]').textContent) && !document.querySelector('[data-overdue]')"), "delivered shows the delivery day and is no longer overdue");
    const afterDelivered = await svc("window.electronAPI.orderDetails.get('o1')");
    R.ck(afterDelivered.deliveredAt !== null && afterDelivered.status === "delivered", "delivered stamps the delivery day");
    await A.val("document.querySelector('[data-set-status=ready]').click()");
    await A.val("document.querySelector('[data-confirm-status]').click()"); // choosing is not enough: Confirm applies it
    await A.until("document.querySelector('[data-order-page] [data-status]').dataset.status === 'ready'");
    R.ck((await svc("window.electronAPI.orderDetails.get('o1')")).deliveredAt === null, "leaving delivered clears the delivery day");

    R.section("cancelled and paid orders");
    await A.val("document.querySelector('[data-set-status=cancelled]').click()");
    await A.val("document.querySelector('[data-confirm-status]').click()"); // choosing is not enough: Confirm applies it
    await A.until("document.querySelector('[data-order-page] [data-status]').dataset.status === 'cancelled'");
    R.ck(await A.val("document.querySelector('[data-tile=left] .summary__value').textContent === '—'"), "a cancelled order shows nothing left");
    await open("o2");
    R.ck(await A.val("!document.querySelector('[data-pay]') && !!document.querySelector('[data-no-items]') && /Walk-in customer/.test(document.querySelector('[data-customer]').textContent)"), "a fully paid walk-in order: no payment form, no items message, walk-in customer");
    await open("nope");
    R.ck(await A.val("!!document.querySelector('[data-error]') && /does not exist/.test(document.querySelector('[data-error]').textContent)"), "an unknown order shows an error with a way back");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
