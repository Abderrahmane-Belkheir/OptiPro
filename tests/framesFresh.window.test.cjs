// The stock shown on the Frames page is what the database holds NOW. A sale, a supplier order or an edit changes a frame's stock on another page; coming back to the Frames page (with the
// same brand and category chosen, or a search made) shows the new stock, not the list kept from the earlier visit.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-framesfresh-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.category.upsert({ where: { id: 1 }, create: { id: 1, name: 'Optical Frames', imageUrl: 'u' }, update: {} });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.supplier.create({ data: { id: 's1', name: 'Frames Co', ...S } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  const frame = (id, name, stock, code) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, code, price: 18500, costPrice: 9000, currency: 'DZD', stock, ...S } });
  await frame('f1', 'Aviator', 3, 'avi-111');
  await frame('f2', 'Wayfarer', 0, 'way-222');
`,
);

let A;
const chip = (group, label) => A.val(`(() => { [...document.querySelectorAll('.chips[aria-labelledby=frames-${group}-title] .chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}).click(); return 1; })()`);
const stockOf = (name) => A.val(`(() => { const c = [...document.querySelectorAll('.results .frame-card')].find((x) => x.querySelector('.frame-card__name').textContent === ${JSON.stringify(name)}); return c ? c.querySelector('.stock').textContent.trim() : null; })()`);
const go = async (hash) => { await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`); await sleep(500); };

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.frames?.create === 'function'", 20000);
    await go("inventory/frames");
    await A.until("document.querySelectorAll('.chips[aria-labelledby=frames-brand-title] .chip').length === 1");
    await chip("category", "Optical Frames");
    await chip("brand", "Ray-Ban");
    await A.until("document.querySelectorAll('.results .frame-card').length === 2");
    const first = { aviator: await stockOf("Aviator"), wayfarer: await stockOf("Wayfarer") };
    R.ck(/3/.test(first.aviator) && /out/i.test(first.wayfarer), "the list shows the stock as it is: Aviator 3, Wayfarer out of stock", JSON.stringify(first));

    // the stock changes elsewhere: a supplier order restocks the Wayfarer, a sale takes one Aviator
    const bought = await A.val("window.electronAPI.supplierOrders.place({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f2', quantity: 6, unitCost: '11000' }] })");
    const sold = await A.val("window.electronAPI.orderPlacement.place({ customerId: 'c1', frameId: 'f1', deposit: '18500' })");
    R.ck(bought.status === "placed" && sold.status === "placed", "a supplier order and a sale are made on other pages");

    await go("customers");
    await go("inventory/frames");
    await A.until("document.querySelectorAll('.results .frame-card').length === 2");
    await sleep(300);
    const second = { aviator: await stockOf("Aviator"), wayfarer: await stockOf("Wayfarer") };
    R.ck(/\b2\b/.test(second.aviator) && !/\b3\b/.test(second.aviator), "back on the Frames page the Aviator shows 2 (it was sold)", JSON.stringify(second));
    R.ck(/\b6\b/.test(second.wayfarer) && !/out/i.test(second.wayfarer), "and the Wayfarer shows 6 (it was restocked)", JSON.stringify(second));

    // the same with a search that was made
    await A.val("(() => { const e = document.getElementById('frames-search'); e.focus(); e.value = 'wayfarer'; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
    await A.until("document.querySelectorAll('.results .frame-card').length === 1");
    await A.val("window.electronAPI.orderPlacement.place({ customerId: 'c1', frameId: 'f2', deposit: '18500' })");
    await go("customers");
    await go("inventory/frames");
    await A.until("document.getElementById('frames-search').value === 'wayfarer'");
    R.ck((await A.val("document.getElementById('frames-search').value")) === "wayfarer", "a search made before leaving is still in the box");
    await A.until("document.querySelectorAll('.results .frame-card').length === 1");
    await sleep(300);
    R.ck(/\b5\b/.test(await stockOf("Wayfarer")), "and its results show the stock now (5: one was sold meanwhile)", await stockOf("Wayfarer"));
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
