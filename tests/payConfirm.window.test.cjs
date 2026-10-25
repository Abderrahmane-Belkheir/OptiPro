// Taking a payment asks first: "Take 2 000 for order CMD-0001?" with what will be left. Nothing is taken until the person says yes; Back returns to the form with what was typed;
// a double click on "Take payment" does not answer the question by itself.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-payconfirm-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  await p.order.create({ data: { id: 'o1', number: 'CMD-0001', customerId: 'c1', status: 'ready', subtotalCents: 1000000, totalCents: 1000000, ...S } });
  await p.payment.create({ data: { id: 'p1', orderId: 'o1', customerId: 'c1', amountCents: 300000, ...S } });
`,
);

let A;
const type = (sel, v) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const count = () => A.val("window.electronAPI.orderDetails.get('o1').then((o) => o.payments.length)");
const paid = () => A.val("window.electronAPI.orderDetails.get('o1').then((o) => o.paidCents)");
const submit = () => A.val("document.querySelector('[data-pay-submit]').click()");
const text = (sel) => A.val(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.orderDetails?.pay === 'function'", 20000);
    await A.val("(() => { location.hash = 'orders/o1'; return 1; })()");
    await A.until("!!document.querySelector('[data-pay]')");

    R.section("the question");
    await type("[data-pay-amount]", "2000");
    await type("[data-pay-note]", "second installment");
    await submit();
    R.ck(await A.until("!!document.querySelector('[data-pay-confirm]')"), "Take payment asks for confirmation");
    const sentence = await text("[data-pay-sentence]");
    R.ck(/2\D?000/.test(sentence) && sentence.includes("CMD-0001"), "it says how much is taken and for which order", sentence);
    R.ck(/5\D?000/.test(await text("[data-pay-after]")), "and how much will be left (7 000 - 2 000 = 5 000)", await text("[data-pay-after]"));
    R.ck((await text("[data-pay-confirm]")).includes("second installment"), "and the note");
    R.ck(!(await A.val("!!document.querySelector('[data-pay-amount]')")), "the form is replaced by the question");
    R.ck((await count()) === 1 && (await paid()) === 300000, "nothing has been taken yet");

    R.section("a hurried second click");
    await A.val("document.querySelector('[data-pay-confirm-yes]').click()");
    await sleep(300);
    R.ck((await count()) === 1 && !!(await A.val("!!document.querySelector('[data-pay-confirm]')")), "Yes clicked at once (a double click) does nothing: the question is still there and nothing was taken");

    R.section("Back");
    await A.val("document.querySelector('[data-pay-confirm-back]').click()");
    R.ck(await A.until("!!document.querySelector('[data-pay-amount]') && !document.querySelector('[data-pay-confirm]')"), "Back returns to the form");
    R.ck((await A.val("document.querySelector('[data-pay-amount]').value")) === "2000" && (await A.val("document.querySelector('[data-pay-note]').value")) === "second installment", "with the amount and the note as they were typed");
    R.ck((await count()) === 1, "and nothing was taken");

    R.section("Yes");
    await submit();
    await A.until("!!document.querySelector('[data-pay-confirm]')");
    await sleep(700);
    await A.val("document.querySelector('[data-pay-confirm-yes]').click()");
    R.ck(await A.until("document.querySelectorAll('[data-payments-table] tbody tr').length === 2"), "after Yes the payment is taken and listed");
    R.ck((await paid()) === 500000 && (await count()) === 2, "once: paid 3 000 + 2 000 = 5 000");
    R.ck(await A.val("!document.querySelector('[data-pay-confirm]') && !!document.querySelector('[data-pay-amount]')"), "the form is back, ready for another payment");
    R.ck((await A.val("document.querySelector('[data-pay-amount]').value")) === "5000" && (await A.val("document.querySelector('[data-pay-note]').value")) === "", "offering what is left (5 000), the note empty again");

    R.section("the last payment");
    await submit();
    await A.until("!!document.querySelector('[data-pay-confirm]')");
    R.ck((await text("[data-pay-after]")) === "The order will be paid in full.", "when the amount is all that is left the question says the order will be paid in full");
    await sleep(700);
    await A.val("document.querySelector('[data-pay-confirm-yes]').click()");
    R.ck(await A.until("!document.querySelector('[data-pay]') && !document.querySelector('[data-pay-confirm]')"), "paid in full: the payment form is gone");
    R.ck((await paid()) === 1000000, "the order is paid up (10 000)");
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
