// The order page (#orders/<id>): the tracking code is shown, and the prices and costs can be corrected: the price and the cost of the lens, the cost of the other lines, the
// final price of the order. The items' total is worked out again; without a typed final price the discount stays; the final price cannot be more than the items add
// up to nor less than what was paid; the invoice already issued follows; the changes are marked to be sent to the server.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-orderedit-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator', brandId: 'b1', categoryId: 1, price: 18500, costPrice: 12000, currency: 'DZD', stock: 3, ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', priceCents: 500000, costCents: 0, ...S } });
  // o1: a frame (cost 12 000) and a lens (cost not known), discounted from 23 500 to 20 000; has a prescription and so a tracking code; 3 000 paid
  await p.order.create({ data: { id: 'o1', number: 'CMD-1', customerId: 'c1', prescriptionId: 'rx1', trackingCode: 123456, status: 'confirmed', subtotalCents: 2350000, discountCents: 350000, totalCents: 2000000, ...S } });
  await p.orderItem.create({ data: { id: 'i1', orderId: 'o1', kind: 'frame', frameId: 'f1', description: 'Ray-Ban Aviator', quantity: 1, unitPriceCents: 1850000, totalCents: 1850000, unitCostCents: 1200000, ...S } });
  await p.orderItem.create({ data: { id: 'i2', orderId: 'o1', kind: 'lens', lensId: 'l1', description: 'Stock 1.5', eye: 'both', quantity: 1, unitPriceCents: 500000, totalCents: 500000, unitCostCents: null, ...S } });
  await p.payment.create({ data: { id: 'p1', orderId: 'o1', customerId: 'c1', amountCents: 300000, ...S } });
  // o2: no prescription (no code), a frame only
  await p.order.create({ data: { id: 'o2', number: 'CMD-2', customerId: 'c1', status: 'delivered', subtotalCents: 1850000, discountCents: 0, totalCents: 1850000, ...S } });
  await p.orderItem.create({ data: { id: 'i3', orderId: 'o2', kind: 'frame', frameId: 'f1', description: 'Ray-Ban Aviator', quantity: 1, unitPriceCents: 1850000, totalCents: 1850000, unitCostCents: 1200000, ...S } });
  // the invoice of o1 is already issued
  const L = require(ROOT + '/dist/local/index.js');
  await L.localDocumentService.issueInvoice('o1');
`,
);

let A;
const svc = (expr) => A.val(expr);
const refuses = (call) => A.val(`${call}.then(() => 'accepted', (e) => String(e.message))`);
const go = async (hash) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await sleep(250);
  await A.until("document.querySelector('[data-order-page] [data-number]')");
};
const text = (selector) => A.val(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const money = (cents) => A.val(`new Intl.NumberFormat(undefined, { style: 'currency', currency: 'DZD', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(${cents} / 100)`);
const type = (selector, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
const tile = (key) => A.val(`document.querySelector('[data-tile=${key}] .summary__value')?.textContent ?? null`);

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.orderDetails?.edit === 'function'");

    R.section("what the page tells");
    const d0 = await svc("window.electronAPI.orderDetails.get('o1')");
    R.ck(d0.trackingCode === 123456, "the order's details carry its tracking code");
    R.ck(d0.costCents === null && d0.profitCents === null, "the cost and the profit are unknown while a line has no known cost");
    R.ck(d0.items.find((i) => i.id === "i1").unitCostCents === 1200000 && d0.items.find((i) => i.id === "i2").unitCostCents === null, "each line carries its cost");
    R.ck((await svc("window.electronAPI.orderDetails.get('o2')")).trackingCode === null, "an order with no prescription has no code");

    await go("orders/o1");
    R.ck((await tile("tracking")) === "123456" && (await text("[data-tile=tracking]")).includes("follows the order"), "the tracking code is shown on the order page");
    R.ck((await tile("cost")) === "—" && (await tile("profit")) === "—", "cost and profit show a dash while a cost is unknown");
    await go("orders/o2");
    R.ck(!(await A.val("!!document.querySelector('[data-tile=tracking]')")), "no tracking tile when the order has no code");
    R.ck((await tile("cost")) === (await money(1200000)) && (await tile("profit")) === (await money(650000)), "cost and profit when every cost is known");

    R.section("the service");
    const o = (id = "o1") => svc(`window.electronAPI.orderDetails.get('${id}')`);
    let d = await svc("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitCostCents: 300000 }] })");
    R.ck(d.costCents === 1500000 && d.profitCents === 500000 && d.totalCents === 2000000 && d.subtotalCents === 2350000, "the cost of the lens: the cost and the profit are known, the price does not move", JSON.stringify([d.costCents, d.profitCents, d.totalCents]));
    d = await svc("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i1', unitCostCents: 1300000 }] })");
    R.ck(d.costCents === 1600000 && d.items.find((i) => i.id === "i1").unitCostCents === 1300000, "the cost of another line can be corrected");
    d = await svc("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitPriceCents: 600000 }] })");
    R.ck(d.subtotalCents === 2450000 && d.discountCents === 350000 && d.totalCents === 2100000 && d.items.find((i) => i.id === "i2").totalCents === 600000, "a dearer lens: the discount stays, the total follows", JSON.stringify([d.subtotalCents, d.discountCents, d.totalCents]));
    R.ck(d.remainingCents === 1800000 && d.profitCents === 2100000 - 1600000, "what is left to pay and the profit follow");
    d = await svc("window.electronAPI.orderDetails.edit('o1', { finalPriceCents: 1800000 })");
    R.ck(d.totalCents === 1800000 && d.discountCents === 650000 && d.subtotalCents === 2450000, "the final price of the order: the discount is what is left", JSON.stringify([d.totalCents, d.discountCents]));
    d = await svc("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitPriceCents: 500000, unitCostCents: 300000 }], finalPriceCents: 1900000 })");
    R.ck(d.subtotalCents === 2350000 && d.totalCents === 1900000 && d.discountCents === 450000, "price, cost and final price together");
    d = await svc("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitCostCents: null }] })");
    R.ck(d.costCents === null && d.profitCents === null, "a cost can be cleared: it is unknown again");
    const same = await svc("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitCostCents: null }], finalPriceCents: 1900000 })");
    R.ck(same.totalCents === 1900000, "changing nothing changes nothing");

    R.section("what is refused");
    const bad = async (call, word) => { const r = await refuses(call); R.ck(r !== "accepted" && r.includes(word), `${word}: ${call.slice(38, 110)}`, r); };
    await bad("window.electronAPI.orderDetails.edit('o1', { finalPriceCents: 2400000 })", "cannot be more");
    await bad("window.electronAPI.orderDetails.edit('o1', { finalPriceCents: 200000 })", "already paid");
    await bad("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i1', unitPriceCents: 1 }] })", "only the price of a lens");
    await bad("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitPriceCents: -5 }] })", "0 or more");
    await bad("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitPriceCents: 10.5 }] })", "0 or more");
    await bad("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitCostCents: -1 }] })", "cost");
    await bad("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i3', unitCostCents: 1 }] })", "not on this order");
    await bad("window.electronAPI.orderDetails.edit('o1', { finalPriceCents: 'x' })", "0 or more");
    await bad("window.electronAPI.orderDetails.edit('nope', {})", "does not exist");
    await bad("window.electronAPI.orderDetails.edit('o1', { lines: [{ id: 'i2', unitPriceCents: 20000 }], finalPriceCents: 1900000 })", "cannot be more");
    R.ck((await o()).totalCents === 1900000, "nothing refused changed the order");

    R.section("the page");
    await go("orders/o1");
    R.ck(await A.until("!!document.querySelector('[data-edit-open]')"), "the Items section has an Edit button");
    await click("[data-edit-open]");
    R.ck(!!(await A.val("document.querySelector('[data-edit]')")), "the form opens");
    R.ck(!!(await A.val("document.querySelector('[data-edit-price=i2]')")) && !(await A.val("!!document.querySelector('[data-edit-price=i1]')")) && !!(await A.val("document.querySelector('[data-edit-cost=i1]') && document.querySelector('[data-edit-cost=i2]')")), "a lens has a price and a cost, a frame only a cost");
    R.ck((await A.val("document.querySelector('[data-edit-final]').value")) === "19000" && (await A.val("document.querySelector('[data-edit-cost=i2]').value")) === "", "the form starts with what is on the order (an unknown cost is empty)");
    await type("[data-edit-price=i2]", "6000");
    R.ck((await A.val("document.querySelector('[data-edit-final]').value")) === "20000" && (await text("[data-edit-hint]")).includes(await money(2450000)), "a dearer lens moves the final price (the discount stays) and the hint says what the items add up to", await text("[data-edit-hint]"));
    await type("[data-edit-final]", "18000");
    await type("[data-edit-price=i2]", "5500");
    R.ck((await A.val("document.querySelector('[data-edit-final]').value")) === "18000", "once the final price is typed, it stays");
    await type("[data-edit-price=i2]", "");
    await click("[data-edit-save]");
    R.ck(await A.until("!document.querySelector('[data-edit] [data-message]').hidden && document.querySelector('[data-edit] [data-message]').textContent !== ''"), "a wrong amount is said, and nothing is saved");
    R.ck((await o()).totalCents === 1900000 && (await A.val("document.querySelector('[data-edit-final]').value")) === "18000" && !!(await A.val("document.querySelector('[data-edit]')")), "(still the old total, and what was typed is still in the form)");
    await type("[data-edit-price=i2]", "5500");
    await type("[data-edit-final]", "30000");
    await click("[data-edit-save]");
    R.ck(await A.until("document.querySelector('[data-edit] [data-message]').textContent.includes('cannot be more')") && (await A.val("document.querySelector('[data-edit-price=i2]').value")) === "5500", "the server's refusal is said in the form, and what was typed stays");
    await type("[data-edit-final]", "18000");
    await type("[data-edit-price=i2]", "5500");
    await type("[data-edit-cost=i2]", "3500");
    await click("[data-edit-save]");
    R.ck(await A.until("!document.querySelector('[data-edit]') && document.querySelector('[data-tile=total] .summary__value')"), "saving closes the form");
    R.ck((await tile("total")) === (await money(1800000)) && (await tile("cost")) === (await money(1300000 + 350000)) && (await tile("profit")) === (await money(1800000 - 1650000)), "the tiles follow", `${await tile("total")} ${await tile("cost")} ${await tile("profit")}`);
    R.ck((await text("[data-item=i2] [data-cell=price]")) === (await money(550000)) && (await text("[data-item=i2] [data-cell=cost]")) === (await money(350000)), "the items table shows the new price and cost");
    await click("[data-edit-open]");
    await click("[data-edit-cancel]");
    R.ck(!(await A.val("!!document.querySelector('[data-edit]')")) && (await tile("total")) === (await money(1800000)), "Cancel closes the form and changes nothing");
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }

  R.section("what was saved");
  const saved = JSON.parse(
    runScript(
      box,
      `
    const o = await p.order.findFirst({ where: { id: 'o1' } });
    const items = await p.orderItem.findMany({ where: { orderId: 'o1' }, orderBy: { id: 'asc' } });
    const inv = await p.invoice.findFirst({ where: { orderId: 'o1' } });
    const invItems = await p.invoiceItem.findMany({ where: { invoiceId: inv.id } });
    console.log(JSON.stringify({ order: [o.subtotalCents, o.discountCents, o.totalCents, o.synced], items: items.map((i) => [i.id, i.unitPriceCents, i.totalCents, i.unitCostCents, i.synced]), invoice: [inv.number, inv.subtotalCents, inv.discountCents, inv.totalCents], invItems: invItems.map((i) => [i.description, i.unitPriceCents, i.totalCents]) }));
  `,
    ).trim().split("\n").pop(),
  );
  R.ck(saved.order[0] === 2400000 && saved.order[2] === 1800000 && saved.order[1] === saved.order[0] - 1800000 && saved.order[3] === false, "the order is saved and marked to be sent", JSON.stringify(saved.order));
  R.ck(saved.items.find((i) => i[0] === "i2")[1] === 550000 && saved.items.find((i) => i[0] === "i2")[3] === 350000 && saved.items.find((i) => i[0] === "i2")[4] === false, "the lens line is saved and marked to be sent", JSON.stringify(saved.items));
  R.ck(saved.invoice[3] === 1800000 && saved.invoice[1] === saved.order[0] && saved.invoice[2] === saved.order[1], "the invoice already issued follows (same number)", JSON.stringify(saved.invoice));
  R.ck(saved.invItems.find((i) => i[0] === "Stock 1.5")[1] === 550000 && saved.invItems.find((i) => i[0] === "Ray-Ban Aviator")[1] === 1850000, "its lines too: the lens one changed, the frame one did not", JSON.stringify(saved.invItems));
  process.exit(R.done());
})().catch(async (error) => {
  console.log("ERR", error.stack);
  try { await A?.stop(); } catch { /* gone */ }
  process.exit(1);
});
