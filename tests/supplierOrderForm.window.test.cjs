// The New supplier order form in the real window: the button on the Supplier orders page, the supplier chooser, the frame search (by model or by code,
// narrowed by a category), several frames added with a quantity, the price given per frame or for the whole batch (shared over the frames bought), and the fact that
// saving it: the stock of the frames goes up and their cost is set.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-supplierorder-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  for (const [id, name] of [[1, 'Optical Frames'], [2, 'Sunglasses'], [3, 'Kids']]) await p.category.upsert({ where: { id }, create: { id, name, imageUrl: 'u' }, update: {} });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.brand.create({ data: { id: 'b2', name: 'Oakley', ...S } });
  const frame = (id, name, brandId, categoryId, code, stock) => p.frame.create({ data: { id, name, brandId, categoryId, code, price: 18500, currency: 'DZD', stock, ...S } });
  await frame('f1', 'Aviator Classic', 'b1', 1, 'abc-123', 0);
  await frame('f2', 'Wayfarer', 'b1', 2, 'def-456', 0);
  await frame('f3', 'Holbrook', 'b2', 2, 'ghi-789', 0);
  await frame('f4', 'Zeta Stocked', 'b2', 3, 'zzz-999', 5); // in stock: a supplier order restocks, so it is not offered
  await p.accessory.create({ data: { id: 'a1', name: 'Lens wipe', description: 'wipe', price: 400, currency: 'DZD', stock: 0, ...S } });
  await p.supplier.create({ data: { id: 's1', name: 'Optic Import', kinds: 'frames', ...S } });
  await p.supplier.create({ data: { id: 's2', name: 'Essilor Algérie', kinds: 'lenses', ...S } });
  await p.supplier.create({ data: { id: 's3', name: 'Old Supplier', kinds: 'frames', isActive: false, ...S } });
  // a frame out of stock that is already waiting for a supplier order (a line with used = false): it is never offered
  await frame('f5', 'Pending Pair', 'b2', 2, 'mno-345', 0);
  await p.supplierOrder.create({ data: { id: 'so1', supplierId: 's3', ...S } });
  await p.supplierOrderItem.create({ data: { supplierOrderId: 'so1', frameId: 'f5', quantity: 4, unitCostCents: 900000, used: false, ...S } });
`,
);

let A;
const settle = () => sleep(500);
const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
const setValue = (selector, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const found = () => A.val("[...document.querySelectorAll('[data-results=supplier-frames] .pick-result__name')].map((e) => e.textContent).join('|')");
const field = (key) => A.val(`document.querySelector('[data-supplier-order-form] [data-field=${key}]')?.textContent.replace(/\\s+/g, ' ') ?? null`);
const num = (s) => Number(String(s).replace(/[^\d.-]/g, ""));
const add = (id) => click(`[data-results=supplier-frames] .pick-result[data-id=${id}] [data-action=add-frame]`);

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.openSupplierOrderForm === 'function'");
    await A.val("(() => { location.hash = '#supplier-orders'; return 1; })()");
    await A.until("!!document.getElementById('new-supplier-order')");

    R.section("the button and the form");
    R.ck((await A.val("document.getElementById('new-supplier-order').textContent.trim()")) === "New supplier order", "the Supplier orders page has a 'New supplier order' button");
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]') && document.querySelectorAll('[data-supplier-select] option').length > 1");
    R.ck((await A.val("[...document.querySelectorAll('[data-supplier-select] option')].map((o) => o.textContent).join('|')")) === "Choose a supplier|Essilor Algérie|Optic Import", "the supplier chooser lists the active suppliers by name (not the retired one)");
    R.ck(await A.val("/Saving sets the stock and the cost/.test(document.querySelector('[data-supplier-order-form] .dialog__subtitle').textContent) && !!document.querySelector('[data-action=save-supplier-order]')"), "it says that saving sets the stock and cost of the frames that were out of stock, and has a Save order button");
    R.ck(await A.val("/No item added yet/.test(document.querySelector('[data-lines-empty]').textContent) && document.querySelector('[data-lines]').closest('.table-scroll').hidden"), "no frame is in the order at first");

    R.section("finding frames");
    await setValue("[data-picker=supplier-frames]", "pending");
    await settle();
    R.ck((await found()) === "" && !(await A.val("!!document.querySelector('.pick-result[data-id=f5]')")), "a frame out of stock that already has a line waiting in a supplier order (Pending Pair) is not offered");
    await setValue("[data-picker=supplier-frames]", "");
    await settle();
    R.ck(await A.val("/An item with no stock gets its stock and cost from this order now/.test(document.querySelector('[data-stock-note]').textContent)"), "a note says what happens to a frame with no stock and to one that still has stock");
    R.ck(await A.val("document.querySelector('[data-results=supplier-frames]').hidden && /Type a model or a code/.test(document.querySelector('[data-hint=supplier-frames]').textContent)"), "the list starts empty, with a hint (like the other searches)");
    { const cats = await A.val("[...document.querySelectorAll('[data-categories] .chip')].map((b) => b.textContent).join('|')"); R.ck(cats === "All categories|Kids|Optical Frames|Sunglasses|Accessories", "the categories are chips, with 'All categories' first", cats); }
    await setValue("[data-picker=supplier-frames]", "ray");
    await settle();
    R.ck((await found()) === "Aviator Classic|Wayfarer", "by model, the brand is found too: the two Ray-Ban frames", await found());
    R.ck(await A.val("(() => { const r = document.querySelector('.pick-result[data-id=f2]'); return /Out of stock/.test(r.textContent); })()"), "each result shows its stock (the Wayfarer is out of stock)");
    await setValue("[data-picker=supplier-frames]", "zeta");
    await settle();
    R.ck((await found()) === "Zeta Stocked" && /5 in stock|In stock|5/.test(await A.val("document.querySelector('.pick-result[data-id=f4]').textContent")), "a frame that still has stock (Zeta Stocked, 5) IS offered: it can be ordered, as long as no order of it is waiting");
    await setValue("[data-picker=supplier-frames]", "ray");
    await settle();
    await click("[data-categories] [data-category='2']");
    await settle();
    R.ck((await found()) === "Wayfarer", "choosing a category narrows the search (Sunglasses: the Wayfarer only)", await found());
    await setValue("[data-picker=supplier-frames]", "");
    await settle();
    R.ck((await found()) === "Holbrook|Wayfarer", "with no text, a category lists its frames", await found());
    await click("[data-categories] [data-category=all]");
    await click("[data-modes] [data-mode=code]");
    await setValue("[data-picker=supplier-frames]", "ghi");
    await settle();
    R.ck((await found()) === "Holbrook", "by code, a code in part finds the frame");
    await setValue("[data-picker=supplier-frames]", "holbrook");
    await settle();
    R.ck(await A.val("/3 letters, a dash and 3 digits/.test(document.querySelector('[data-hint=supplier-frames]').textContent) && document.querySelector('[data-results=supplier-frames]').hidden"), "a model name is not a code: the line under the box says what a code looks like");
    await click("[data-modes] [data-mode=model]");
    await settle();

    R.section("adding several frames, with a price for each");
    await setValue("[data-picker=supplier-frames]", "o");
    await settle();
    await add("f3");
    R.ck(await A.val("document.querySelector('.pick-result[data-id=f3]').dataset.added === 'true' && !document.querySelector('.pick-result[data-id=f3] [data-action=add-frame]')"), "a frame that is added is marked Added in the list, and cannot be added twice");
    await add("f1");
    await A.until("document.querySelectorAll('[data-line]').length === 2");
    R.ck((await A.val("[...document.querySelectorAll('[data-line] .cell-name__text')].map((e) => e.textContent).join('|')")) === "Holbrook|Aviator Classic" && (await A.val("document.querySelector('[data-line=f3] .cell-name__sub').textContent")) === "Oakley · ghi-789", "the order lists them in the order they were added, with their brand and code");
    R.ck((await A.val("document.querySelector('[data-qty=f3]').value")) === "1" && (await A.val("document.querySelector('[data-unit-head]').textContent")) === "Price per item (DZD)", "each has a quantity (1) and a price box");
    await setValue("[data-qty=f3]", "10");
    await setValue("[data-unit=f3]", "9500");
    await setValue("[data-qty=f1]", "5");
    await setValue("[data-unit=f1]", "11000,50");
    R.ck((await A.val("document.querySelector('[data-line=f3] [data-cell=total]').textContent")).replace(/\D/g, "") === "95000", "each line's total is quantity x price (10 x 9 500 = 95 000)", await A.val("document.querySelector('[data-line=f3] [data-cell=total]').textContent"));
    R.ck((await field("frames")) === "15" && (await A.val("document.querySelector('[data-supplier-order-form] [data-field=total]').textContent")).replace(/[^\d]/g, "") === "15000250", "the summary counts the frames bought (15) and adds the lines (95 000 + 55 002.50)", await field("total"));
    R.ck((await field("kinds")) === "2", "and the different frames (2)");
    await setValue("[data-qty=f1]", "0");
    R.ck((await A.val("document.querySelector('[data-qty=f1]').getAttribute('aria-invalid')")) === "true" && (await field("total")) === "—", "a quantity of 0 is marked wrong and the total waits");
    await setValue("[data-qty=f1]", "5");
    await setValue("[data-unit=f1]", "abc");
    R.ck((await A.val("document.querySelector('[data-unit=f1]').getAttribute('aria-invalid')")) === "true" && (await field("total")) === "—", "a price that is not an amount is marked wrong");
    await setValue("[data-unit=f1]", "11000");

    R.section("quantity and price typed in the result itself");
    await click("[data-line=f3] [data-action=remove-line]");
    await click("[data-line=f1] [data-action=remove-line]");
    R.ck(await A.val("document.querySelector('[data-batch-total]').disabled"), "in 'Price per frame' the whole-batch box is disabled");
    R.ck(await A.val("!!document.querySelector('.pick-result[data-id=f3] [data-draft-qty=f3]') && !document.querySelector('[data-draft-unit=f3]').disabled"), "each result has its own quantity and price boxes, the price enabled");
    await setValue("[data-draft-qty=f3]", "4");
    await setValue("[data-draft-unit=f3]", "abc");
    await add("f3");
    R.ck(await A.val("document.querySelectorAll('[data-line]').length === 0 && document.querySelector('[data-draft-unit=f3]').getAttribute('aria-invalid') === 'true'"), "a wrong price in the result is marked and nothing is added");
    await setValue("[data-draft-unit=f3]", "9000");
    await add("f3");
    R.ck((await A.val("document.querySelector('[data-qty=f3]').value")) === "4" && (await A.val("document.querySelector('[data-unit=f3]').value")) === "9000" && (await field("total")).replace(/\D/g, "") === "36000", "Add takes the quantity and price typed in the result (4 x 9 000 = 36 000)", await field("total"));
    await click("[data-line=f3] [data-action=remove-line]");
    await click("[data-price-modes] [data-price-mode=batch]");
    R.ck(await A.val("document.querySelector('[data-draft-unit=f3]').disabled && !document.querySelector('[data-batch-total]').disabled"), "in 'Price of the whole batch' the price boxes of the results are disabled and the batch box is enabled");
    await click("[data-price-modes] [data-price-mode=unit]");
    await add("f3");
    await add("f1");
    await A.until("document.querySelectorAll('[data-line]').length === 2");
    await setValue("[data-qty=f3]", "10");
    await setValue("[data-qty=f1]", "5");
    await setValue("[data-unit=f3]", "9500");
    await setValue("[data-unit=f1]", "11000");

    R.section("the price of the whole batch");
    await click("[data-price-modes] [data-price-mode=batch]");
    R.ck(await A.val("!document.querySelector('[data-batch-total]').disabled && [...document.querySelectorAll('[data-unit]')].length === 0"), "choosing 'Price of the whole batch' enables the box for the whole batch");
    R.ck(await A.val("document.querySelectorAll('[data-line] input[data-unit]').length === 0 && document.querySelector('[data-line=f1] [data-cell=unit]').textContent === '—'"), "the lines no longer ask for a price each; they wait for the batch price");
    await setValue("[data-batch-total]", "150000");
    R.ck((await A.val("document.querySelector('[data-line=f3] [data-cell=unit]').textContent")).replace(/\D/g, "") === "10000" && (await A.val("document.querySelector('[data-line=f1] [data-cell=unit]').textContent")).replace(/\D/g, "") === "10000", "150 000 shared over the 15 frames bought: 10 000 each, on every line", await A.val("document.querySelector('[data-line=f3] [data-cell=unit]').textContent"));
    R.ck((await A.val("document.querySelector('[data-line=f3] [data-cell=total]').textContent")).replace(/\D/g, "") === "100000" && (await A.val("document.querySelector('[data-line=f1] [data-cell=total]').textContent")).replace(/\D/g, "") === "50000", "line totals follow the quantities (100 000 and 50 000)");
    R.ck((await field("total")).replace(/\D/g, "") === "150000", "the order's total is the batch price");
    await setValue("[data-qty=f1]", "10");
    R.ck((await A.val("document.querySelector('[data-line=f1] [data-cell=unit]').textContent")).replace(/\D/g, "") === "7500", "changing a quantity shares the batch again (20 frames: 7 500 each)", await A.val("document.querySelector('[data-line=f1] [data-cell=unit]').textContent"));
    await setValue("[data-batch-total]", "10000,333");
    R.ck(/Enter an amount/.test(await A.val("document.querySelector('[data-batch] .field__error').textContent")) && (await A.val("document.querySelector('[data-line=f1] [data-cell=unit]').textContent")) === "—", "a batch price that is not an amount is refused under its box");
    await setValue("[data-batch-total]", "150000");
    await click("[data-price-modes] [data-price-mode=unit]");
    R.ck((await A.val("document.querySelector('[data-unit=f1]').value")) === "11000" && (await A.val("document.querySelector('[data-batch-total]').disabled && !!document.querySelector('[data-batch]')")), "going back to a price per frame keeps what was typed for each and disables the whole-batch box (still shown)");

    R.section("removing a frame");
    await click("[data-line=f3] [data-action=remove-line]");
    R.ck((await A.val("document.querySelectorAll('[data-line]').length")) === 1 && (await A.val("!!document.querySelector('.pick-result[data-id=f3] [data-action=add-frame]')")), "removing a line takes it out, and the frame can be added again");
    const stocks = () => A.val("window.electronAPI.frames.list().then((l) => JSON.stringify(Object.fromEntries(l.map((f) => [f.id, [f.stock, f.costPrice]]))))").then(JSON.parse);
    const before = await stocks();

    R.section("saving: what is missing is refused and nothing changes");
    await click("[data-action=save-supplier-order]");
    await A.until("!document.querySelector('[data-save-error]').hidden");
    R.ck(/Choose the supplier/.test(await A.val("document.querySelector('[data-save-error]').textContent")) && !!(await A.val("!!document.querySelector('[data-supplier-order-form]')")), "without a supplier the order is refused, and the form says why");
    await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); s.value = 's1'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    await setValue("[data-unit=f1]", "abc");
    await click("[data-action=save-supplier-order]");
    await A.until("/price of one/i.test(document.querySelector('[data-save-error]').textContent)");
    R.ck(await A.val("document.querySelector('[data-unit=f1]').getAttribute('aria-invalid') === 'true'"), "a price that is not an amount is marked on its line");
    R.ck(JSON.stringify(await stocks()) === JSON.stringify(before), "and no frame's stock or cost changed");
    await setValue("[data-unit=f1]", "11000");

    R.section("saving a price per frame");
    await click("[data-action=save-supplier-order]");
    await A.until("!!document.querySelector('[data-saved]')");
    R.ck(await A.val("document.querySelector('[data-supplier-order-form] .dialog__title').textContent === 'Order saved' && /10 items \\(1 different\\) bought for/.test(document.querySelector('[data-saved]').textContent) && /10 added to your stock/.test(document.querySelector('[data-stock-set]').textContent) && !document.querySelector('[data-stock-kept]') && document.querySelector('[data-saved]').textContent.replace(/\\D/g, '').includes('110000')"), "the form says what was done: 10 items bought for 110 000, 10 added to the stock");
    const afterOne = await stocks();
    R.ck(afterOne.f1[0] === 10 && afterOne.f1[1] === 11000 && JSON.stringify(afterOne.f2) === JSON.stringify(before.f2) && JSON.stringify(afterOne.f4) === JSON.stringify(before.f4), "the frame's stock went from 0 to 10 and its cost is 11 000; the other frames are untouched", JSON.stringify(afterOne));
    await click("[data-action=close-saved]");
    await A.until("!document.querySelector('[data-supplier-order-form]')");

    R.section("saving a price for the whole batch");
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]') && document.querySelectorAll('[data-supplier-select] option').length > 1");
    await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); s.value = 's2'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    await setValue("[data-picker=supplier-frames]", "r");
    await settle();
    R.ck((await found()) === "Aviator Classic|Holbrook|Wayfarer", "the Aviator (stock 10, its earlier line is used) is offered again with the others", await found());
    await add("f3");
    await add("f2");
    await A.until("document.querySelectorAll('[data-line]').length === 2");
    await setValue("[data-qty=f3]", "3");
    await setValue("[data-qty=f2]", "2");
    await click("[data-price-modes] [data-price-mode=batch]");
    await setValue("[data-batch-total]", "100000");
    await click("[data-action=save-supplier-order]");
    await A.until("!!document.querySelector('[data-saved]')");
    const afterTwo = await stocks();
    R.ck(afterTwo.f3[0] === 3 && afterTwo.f2[0] === 2 && afterTwo.f3[1] === 20000 && afterTwo.f2[1] === 20000 && afterTwo.f1[0] === 10, "100 000 shared over the 5 frames bought: 20 000 each, and the stock goes up by what was bought (3 and 2)", JSON.stringify(afterTwo));
    await click("[data-action=close-saved]");
    await A.until("!document.querySelector('[data-supplier-order-form]')");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));

    R.section("a frame that still has stock: the order waits");
    const beforeZeta = (await stocks()).f4;
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]') && document.querySelectorAll('[data-supplier-select] option').length > 1");
    await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); s.value = 's1'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    await setValue("[data-picker=supplier-frames]", "zeta");
    await settle();
    await setValue("[data-draft-qty=f4]", "8");
    await setValue("[data-draft-unit=f4]", "7000");
    await add("f4");
    await A.until("document.querySelectorAll('[data-line]').length === 1");
    await click("[data-action=save-supplier-order]");
    await A.until("!!document.querySelector('[data-saved]')");
    R.ck(await A.val("!!document.querySelector('[data-stock-kept]') && !document.querySelector('[data-stock-set]')"), "the form says the frame still had stock, so its stock and cost were not changed");
    R.ck(JSON.stringify((await stocks()).f4) === JSON.stringify(beforeZeta) && beforeZeta[0] === 5, "its stock (5) and cost are untouched", JSON.stringify([beforeZeta, (await stocks()).f4]));
    await click("[data-action=close-saved]");
    await A.until("!document.querySelector('[data-supplier-order-form]')");
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]')");
    await setValue("[data-picker=supplier-frames]", "zeta");
    await settle();
    R.ck((await found()) === "", "and it is not offered again while that order waits");
    await click("[data-supplier-order-form] .dialog__footer .btn--secondary");
    await A.until("!document.querySelector('[data-supplier-order-form]')");

    R.section("frames and accessories in the same order");
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]') && document.querySelectorAll('[data-supplier-select] option').length > 1");
    await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); s.value = 's1'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    await click("[data-categories] [data-category=accessories]");
    await settle();
    R.ck((await found()) === "Lens wipe", "the Accessories chip lists the accessories (and no frame)", await found());
    await setValue("[data-draft-qty=a1]", "5");
    await setValue("[data-draft-unit=a1]", "200");
    await add("a1");
    await click("[data-categories] [data-category=all]");
    await setValue("[data-picker=supplier-frames]", "aviator");
    await settle();
    await setValue("[data-draft-qty=f1]", "2");
    await setValue("[data-draft-unit=f1]", "9000");
    await add("f1");
    await A.until("document.querySelectorAll('[data-line]').length === 2");
    R.ck((await field("frames")) === "7" && (await field("kinds")) === "2" && (await field("total")).replace(/[^\d]/g, "") === "19000", "the summary counts 7 pieces of 2 different items and adds them: 5 x 200 + 2 x 9 000 = 19 000", await field("total"));
    await click("[data-price-modes] [data-price-mode=batch]");
    await setValue("[data-batch-total]", "14000");
    R.ck((await field("total")).replace(/[^\d]/g, "") === "14000" && (await A.val("document.querySelector('[data-line=a1] [data-cell=unit]').textContent")).replace(/\D/g, "") === "2000", "with a price for the whole batch the total is that price (14 000) and each piece costs 14 000 / 7 = 2 000");
    await click("[data-price-modes] [data-price-mode=unit]");
    const stockBefore = await A.val("window.electronAPI.frames.get('f1').then((f) => f.stock)");
    await click("[data-action=save-supplier-order]");
    await A.until("!!document.querySelector('[data-saved]')");
    R.ck(await A.val("/7 items \\(2 different\\) bought for/.test(document.querySelector('[data-saved]').textContent) && /5 added to your stock; the cost of 1 item was updated/.test(document.querySelector('[data-stock-set]').textContent) && /1 of the 2 items still had stock/.test(document.querySelector('[data-stock-kept]').textContent)"), "saved: 7 items bought, the accessory (at 0) got its stock and cost, the frame (with stock) is waiting");
    const accessory = await A.val("window.electronAPI.accessories.list().then((l) => l.filter((a) => a.id === 'a1').map((a) => [a.stock, a.costPrice]))");
    R.ck(JSON.stringify(accessory) === "[[5,200]]" && (await A.val("window.electronAPI.frames.get('f1').then((f) => f.stock)")) === stockBefore, "the accessory's stock is 5 and its cost 200; the frame's stock did not change", JSON.stringify(accessory));
    await click("[data-action=close-saved]");
    await A.until("!document.querySelector('[data-supplier-order-form]')");
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]')");
    await setValue("[data-picker=supplier-frames]", "wipe");
    await settle();
    R.ck((await found()) === "Lens wipe", "an accessory whose line was used is offered again (nothing is waiting)", await found());
    await click("[data-supplier-order-form] .dialog__footer .btn--secondary");
    await A.until("!document.querySelector('[data-supplier-order-form]')");

    R.section("French");
    await A.val("window.electronAPI.frames.update('f1', { stock: 0 }).then(() => 1)"); // (the Aviator is out of stock again, so it is offered)
    await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
    await sleep(900);
    await A.val("(() => { location.hash = '#dashboard'; return 1; })()");
    await A.val("(() => { location.hash = '#supplier-orders'; return 1; })()");
    await A.until("!!document.getElementById('new-supplier-order')");
    await sleep(300);
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]')");
    await setValue("[data-picker=supplier-frames]", "aviator");
    await settle();
    await add("f1");
    await sleep(300);
    R.ck((await A.val("document.querySelector('[data-supplier-order-form] .dialog__title').textContent")) === "Nouvelle commande fournisseur" && (await A.val("document.querySelector('[data-action=save-supplier-order]').textContent")) === "Enregistrer la commande", "the form is translated");
    const missing = await A.val("[...window.i18n.missing].filter((s) => !/^(Optic|Aviator|Old Supplier|Pending Pair)/.test(s) && !/^\\d|^DZD/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s))");
    R.ck(missing.length === 0, "every text has a translation", JSON.stringify(missing));
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 700));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
