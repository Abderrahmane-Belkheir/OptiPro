// Placing an order from the New order form, in the real window: the button waits for something to sell, the prescription's measurements start the boxes, the
// lens price starts from the list and can be changed, the total follows, Place order saves the order (and tells the page), and a mistake is said in the form with
// nothing saved.
const fs = require("node:fs");
const path = require("node:path");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-neworder-place-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina Benali', ...S } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, leftSphere: -1.5, pdRight: 31, pdLeft: 30.5, fittingHeightRight: 22, fittingHeightLeft: 21.5, ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator Classic', brandId: 'b1', categoryId: 1, price: 18500, costPrice: 12000, currency: 'DZD', stock: 10, code: 'abc-123', ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', brand: 'Essilor', priceCents: 500000, costCents: 300000, ...S } });
`,
);

let A;
const settle = () => sleep(450);
const text = (selector) => A.val(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const field = (key) => A.val(`document.querySelector('[data-field=${key}]')?.textContent.replace(/\\s+/g, ' ') ?? null`);
const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
const setValue = (selector, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const digits = (s) => String(s ?? "").replace(/[^\d.,-]/g, "");

(async () => {
  const docs = path.join(box.dir, "docs");
  A = await launchApp(box, { OPTIPRO_DOCUMENT_PDF_DIR: docs }); // (the papers are written as PDF files here instead of going to a printer)
  try {
    await A.until("typeof window.openNewOrderForm === 'function' && typeof window.electronAPI?.orderPlacement?.place === 'function'");
    await A.val("(() => { window.__placed = []; window.openNewOrderForm({ id: 'c1', name: 'Amina Benali' }, { onPlaced: (r) => window.__placed.push(r) }); return 1; })()");
    await A.until("!!document.querySelector('[data-new-order]')");

    R.section("before anything is chosen");
    R.ck(await A.val("document.querySelector('[data-action=place]').disabled"), "Place order waits: nothing to sell yet");
    R.ck(await A.val("document.querySelector('[data-new-order] .dialog__subtitle').textContent === 'For Amina Benali.'"), "the form no longer says nothing is saved");
    R.ck(await A.val("['pdRight','pdLeft','fittingHeightRight','fittingHeightLeft'].every((n) => document.getElementById('order-' + n))"), "the four measurement boxes are there");

    R.section("choosing");
    await setValue("[data-picker=frame]", "aviator");
    await settle();
    await click(".pick[data-kind=frame] .pick-result");
    R.ck(await A.val("!document.querySelector('[data-action=place]').disabled"), "a frame is something to sell: Place order is ready");
    R.ck((await field("total")) !== null && digits(await field("total")).replace(/[.,]/g, "") === "18500", "the total shows the frame", await field("total"));
    await click("#order-use-rx");
    await A.until("!!document.querySelector('input[name=prescription][value=rx1]')");
    await click("input[name=prescription][value=rx1]");
    R.ck(await A.val("['pdRight','pdLeft','fittingHeightRight','fittingHeightLeft'].map((n) => document.getElementById('order-' + n).value).join('|')") === "31|30.5|22|21.5", "the chosen prescription's PD and fitting heights start the measurement boxes");
    await setValue("#order-fittingHeightRight", "23");
    await click("input[name=prescription][value=rx1]");
    R.ck((await A.val("document.getElementById('order-fittingHeightRight').value")) === "23", "what was typed is not overwritten");
    await A.until("(document.querySelectorAll('[data-results=lens] .pick-result').length) === 1");
    await click("[data-results=lens] .pick-result");
    R.ck((await A.val("document.getElementById('order-lens-price').value")) === "5000" && !(await A.val("document.querySelector('[data-lens-price]').hidden")), "choosing a lens shows its price, starting from the list (5000)");
    R.ck(digits(await field("total")).replace(/[.,]/g, "") === "23500", "the total is the frame and the lens (23 500)", await field("total"));
    await setValue("#order-lens-price", "4500");
    R.ck(digits(await field("total")).replace(/[.,]/g, "") === "23000", "changing the lens price changes the total (23 000)", await field("total"));
    await setValue("#order-deposit", "8000");
    R.ck(digits(await field("left")).replace(/[.,]/g, "") === "15000", "the deposit leaves 15 000 to pay", await field("left"));

    R.section("placing");
    await click("[data-action=place]");
    await A.until("!document.querySelector('[data-new-order]')");
    R.ck(await A.val("window.__placed.length === 1 && window.__placed[0].status === 'placed'"), "the form closed and told the page (so its Orders tab can refresh)");
    const saved = await A.val(`(async () => { const orders = await window.electronAPI.orders.list(); const o = orders[0]; const items = await window.electronAPI.orderItems.list({ orderId: o.id }); const pays = await window.electronAPI.payments.list({ orderId: o.id }); return { count: orders.length, number: o.number, status: o.status, total: o.totalCents, rx: o.prescriptionId, pd: [o.pdRight, o.pdLeft, o.fittingHeightRight, o.fittingHeightLeft].join('|'), lines: items.map((i) => i.kind + ':' + i.unitPriceCents).sort().join(','), paid: pays.map((x) => x.amountCents).join(',') }; })()`);
    R.ck(saved.count === 1 && /^CMD-\d{4}-0001$/.test(saved.number) && saved.status === "confirmed", "one order was saved, numbered, confirmed", JSON.stringify(saved));
    R.ck(saved.total === 2300000 && saved.lines === "frame:1850000,lens:450000" && saved.paid === "800000", "with the frame, the lens at the typed price (4 500), and the 8 000 deposit as a payment", JSON.stringify(saved));
    R.ck(saved.rx === "rx1" && saved.pd === "31|30.5|23|21.5", "linked to the prescription, with the measurements as they were typed (fitting height 23)", saved.pd);

    R.section("the papers");
    await A.until("!!document.querySelector('[data-order-placed]')");
    R.ck(/^CMD-\d{4}-0001$/.test(await text("[data-placed-number]")), "the 'Order placed' box opens with the order's number", await text("[data-placed-number]"));
    R.ck(await A.val("![...document.querySelectorAll('[data-order-placed] .order-summary__row dt')].some((d) => /tracking/i.test(d.textContent))"), "the box shows no tracking code");
    R.ck(await A.val("[...document.querySelectorAll('[data-order-placed] [data-print]')].map((b) => b.dataset.print).join() === 'invoice'"), "the box has a button for the customer's invoice, and none for the lab sheet");
    R.ck(await A.val("!document.querySelector('[data-order-placed] [data-print-supplier]')"), "(nor one for the lenses supplier: that one is on the order's page)");
    await click("[data-order-placed] [data-print=invoice]");
    await A.until("document.querySelector('[data-order-placed] [data-print-status]').dataset.result");
    R.ck((await A.val("document.querySelector('[data-order-placed] [data-print-status]').dataset.result")) === "saved", "printing the invoice works (here it is saved as a PDF instead)", await text("[data-order-placed] [data-print-status]"));
    const files = fs.existsSync(docs) ? fs.readdirSync(docs).sort() : [];
    R.ck(files.length === 1 && /^invoice-FAC-\d{4}-0001\.pdf$/.test(files[0]), "one invoice PDF (FAC-year-0001) was written, and no lab sheet", files.join());
    R.ck(files.every((x) => fs.readFileSync(path.join(docs, x)).subarray(0, 5).toString() === "%PDF-" && fs.statSync(path.join(docs, x)).size > 3000), "and it is a real PDF file");
    R.ck((await A.val("window.electronAPI.orderDetails.get(window.__placed[0].order.id).then((o) => o.id)")) === (await A.val("window.__placed[0].order.id")), "(the order is the one just placed)");
    await click("[data-order-placed] [data-action=close-placed]");
    await A.until("!document.querySelector('[data-order-placed]')");

    R.section("an order with no lens");
    await A.val("(async () => { const r = await window.electronAPI.orderPlacement.place({ customerId: 'c1', frameId: 'f1' }); window.__noLens = r; window.showOrderPlaced(r); return 1; })()");
    await A.until("!!document.querySelector('[data-order-placed]')");
    R.ck((await A.val("window.__noLens.hasLens")) === false && (await A.val("window.__noLens.order.status")) === "delivered", "a frame alone: no lens, delivered");
    R.ck((await A.val("[...document.querySelectorAll('[data-order-placed] [data-print]')].map((b) => b.dataset.print).join()")) === "invoice", "its 'Order placed' box offers the invoice only: no lab sheet");
    await click("[data-order-placed] [data-action=close-placed]");
    await A.until("!document.querySelector('[data-order-placed]')");
    await A.val("(() => { location.hash = '#orders/' + window.__noLens.order.id; return 1; })()");
    await A.until("!!document.querySelector('[data-documents] [data-print]')");
    R.ck((await A.val("[...document.querySelectorAll('[data-documents] [data-print]')].map((b) => b.dataset.print).join()")) === "invoice", "and so does its page");
    await A.val("(() => { location.hash = '#orders/' + window.__placed[0].order.id; return 1; })()");
    await A.until("!!document.querySelector('[data-documents] [data-print=invoice]')");
    R.ck((await A.val("[...document.querySelectorAll('[data-documents] [data-print]')].map((b) => b.dataset.print).join()")) === "invoice" && !(await A.val("!!document.querySelector('[data-print=lab]')")), "an order with a lens has the invoice button, and no lab sheet button anywhere");

    R.section("the lenses supplier's PDF button");
    R.ck(await A.val("(() => { const b = document.querySelector('[data-documents] [data-print-supplier]'); return !!b && b.textContent.trim() === 'Print PDF for the lenses supplier'; })()"), "a confirmed order's page has the button 'Print PDF for the lenses supplier'");
    const dialogsBefore = await A.val("document.querySelectorAll('dialog[open]').length");
    await click("[data-documents] [data-print-supplier]");
    await sleep(300);
    R.ck((await A.val("document.querySelectorAll('dialog[open]').length")) === dialogsBefore && (await A.val("document.querySelector('[data-documents] [data-print-status]').textContent")) === "", "pressing it does nothing yet (no dialog, no message)");
    await A.val("window.electronAPI.orderDetails.setStatus(window.__placed[0].order.id, 'at_lab')");
    await A.val("(() => { location.hash = '#orders'; return 1; })()");
    await A.val("(() => { location.hash = '#orders/' + window.__placed[0].order.id; return 1; })()");
    await A.until("!!document.querySelector('[data-documents] [data-print=invoice]')");
    R.ck(await A.val("!document.querySelector('[data-documents] [data-print-supplier]')"), "once the order is no longer confirmed (at the lab) the button is gone");
    await A.val("window.electronAPI.orderDetails.setStatus(window.__placed[0].order.id, 'confirmed')");
    await A.val("(() => { location.hash = '#orders'; return 1; })()");
    await A.val("(() => { location.hash = '#orders/' + window.__placed[0].order.id; return 1; })()");
    await A.until("!!document.querySelector('[data-documents] [data-print=invoice]')");
    R.ck(await A.val("!!document.querySelector('[data-documents] [data-print-supplier]')"), "and it is back when the order is confirmed again and its page is opened");
    await A.val("(() => { location.hash = '#customers'; return 1; })()");

    R.section("a mistake");
    await A.val("(() => { window.openNewOrderForm({ id: 'c1', name: 'Amina Benali' }, { onPlaced: (r) => window.__placed.push(r) }); return 1; })()");
    await A.until("!!document.querySelector('[data-new-order]')");
    await click("#order-lens-describe");
    await setValue("#order-lens-description", "Progressive 1.6 with anti-reflective");
    R.ck(await A.val("!document.querySelector('[data-action=place]').disabled"), "a described lens is something to sell");
    await click("[data-action=place]");
    await A.until("!document.querySelector('[data-problems]').hidden");
    R.ck(/Give the price of the described lens/.test(await text("[data-problems]")), "no price: the form says so, at the top");
    R.ck(await A.val("document.getElementById('order-lens-price').getAttribute('aria-invalid') === 'true'"), "and the price box is marked");
    R.ck((await A.val("window.electronAPI.orders.list().then((l) => l.length)")) === 2, "nothing was saved");
    await setValue("#order-lens-price", "14000");
    R.ck(await A.val("!document.getElementById('order-lens-price').hasAttribute('aria-invalid')"), "typing in the marked box clears the mark");
    await setValue("#order-deposit", "20000");
    await click("[data-action=place]");
    await A.until("!document.querySelector('[data-problems]').hidden && /deposit/.test(document.querySelector('[data-problems]').textContent)");
    R.ck(/deposit cannot be more than/.test(await text("[data-problems]")), "a deposit above the total is refused, in words");
    await setValue("#order-deposit", "14000");
    await click("[data-action=place]");
    await A.until("!document.querySelector('[data-new-order]')");
    const second = await A.val(`(async () => { const orders = await window.electronAPI.orders.list(); const o = orders.find((x) => x.totalCents === 1400000); const items = await window.electronAPI.orderItems.list({ orderId: o.id }); return { count: orders.length, number: o.number, line: items.map((i) => [i.kind, i.lensId, i.description, i.unitPriceCents].join('|')).join(), pd: [o.pdRight, o.fittingHeightRight].join('|') }; })()`);
    R.ck((await A.val("window.electronAPI.orders.list().then((l) => l.find((o) => o.totalCents === 1400000).status)")) === "confirmed", "an order with a lens waits for the lab: confirmed");
    R.ck(second.count === 3 && /0003$/.test(second.number) && second.line === "lens||Progressive 1.6 with anti-reflective|1400000", "fixed and placed: the second order, a described lens with no linked lens", JSON.stringify(second));
    R.ck(second.pd === "|", "no prescription chosen: no measurements invented");

    R.section("the final price and the cost");
    const ordersBefore = await A.val("window.electronAPI.orders.list().then((l) => l.length)");
    await A.val("(() => { window.openNewOrderForm({ id: 'c1', name: 'Amina Benali' }, { onPlaced: (r) => window.__placed.push(r) }); return 1; })()");
    await A.until("!!document.querySelector('[data-new-order]')");
    const finalBox = () => A.val("document.getElementById('order-final-price').value");
    R.ck((await finalBox()) === "", "the final price is empty while there is nothing to sell");
    await setValue("[data-picker=frame]", "aviator");
    await settle();
    await click(".pick[data-kind=frame] .pick-result");
    R.ck((await finalBox()) === "18500", "choosing a frame fills the final price with the total (18500)", await finalBox());
    await click("#order-use-rx");
    await A.until("!!document.querySelector('input[name=prescription][value=rx1]')");
    await click("input[name=prescription][value=rx1]");
    await A.until("(document.querySelectorAll('[data-results=lens] .pick-result').length) === 1");
    await click("[data-results=lens] .pick-result");
    R.ck((await finalBox()) === "23500" && (await A.val("document.getElementById('order-lens-cost').value")) === "3000", "choosing a lens adds its price (the final price follows: 23500) and starts its cost from the list (3000)", await finalBox());
    await setValue("#order-lens-cost", "3500");
    R.ck((await finalBox()) === "23500", "the lens cost is not a price: the final price does not move");
    await setValue("#order-final-price", "20000");
    R.ck(digits(await field("discount")).replace(/[.,]/g, "") === "3500" && digits(await field("final")).replace(/[.,]/g, "") === "20000" && digits(await field("total")).replace(/[.,]/g, "") === "23500", "typing a lower final price shows the discount (3 500) and keeps the items total (23 500)", `${await field("discount")} ${await field("final")} ${await field("total")}`);
    await setValue("#order-deposit", "20000");
    R.ck(digits(await field("left")).replace(/[.,]/g, "") === "0", "what is left to pay is worked out from the final price: 0 after a deposit of 20 000", await field("left"));
    await setValue("#order-lens-price", "4000");
    R.ck((await finalBox()) === "20000" && digits(await field("total")).replace(/[.,]/g, "") === "22500" && digits(await field("discount")).replace(/[.,]/g, "") === "2500", "once typed the final price stays when the items change; the discount follows (2 500)");
    await setValue("#order-final-price", "30000");
    R.ck(/cannot be more than the items add up to/.test(await A.val("document.getElementById('order-final-price-error').textContent")) && (await A.val("document.getElementById('order-final-price').getAttribute('aria-invalid')")) === "true", "a final price above the items is refused under its box, at once");
    await setValue("#order-final-price", "abc");
    R.ck(/Enter an amount/.test(await A.val("document.getElementById('order-final-price-error').textContent")), "text is not an amount");
    await setValue("#order-final-price", "");
    R.ck((await finalBox()) === "22500" && (await A.val("document.getElementById('order-final-price-error').hidden")), "emptying the box brings the total of the items back");
    await setValue("#order-final-price", "20000");
    await click("[data-action=place]");
    await A.until("!document.querySelector('[data-new-order]')");
    const made = await A.val(`(async () => { const orders = await window.electronAPI.orders.list(); const o = orders.find((x) => x.totalCents === 2000000); const items = await window.electronAPI.orderItems.list({ orderId: o.id }); return { count: orders.length, subtotal: o.subtotalCents, discount: o.discountCents, total: o.totalCents, lines: items.map((i) => i.kind + ':' + i.unitPriceCents + ':' + i.unitCostCents).sort().join(',') }; })()`);
    R.ck(made.count === ordersBefore + 1 && made.subtotal === 2250000 && made.discount === 250000 && made.total === 2000000, "placing it saves the final price as the total, and the difference as the discount", JSON.stringify(made));
    R.ck(made.lines === "frame:1850000:1200000,lens:400000:350000", "the lines keep the prices they were sold at, with the costs of the day (the frame's from its record, the lens cost typed with the order)", made.lines);
    await click("[data-order-placed] [data-action=close-placed]");
    await A.until("!document.querySelector('[data-order-placed]')");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 700));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
