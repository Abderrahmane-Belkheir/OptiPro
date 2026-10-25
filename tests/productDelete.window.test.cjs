// A frame or an accessory that an order or a supplier order was made with cannot be deleted: its Edit card does not offer Delete (it says why instead), the service refuses too, and
// one that was never used still can be deleted from the card.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-productdelete-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.category.upsert({ where: { id: 1 }, create: { id: 1, name: 'Optical Frames', imageUrl: 'u' }, update: {} });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  const frame = (id, name, code) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, code, price: 18500, currency: 'DZD', stock: 3, ...S } });
  await frame('f-sold', 'Sold frame', 'sld-111');
  await frame('f-bought', 'Bought frame', 'bgt-222');
  await frame('f-free', 'Never used frame', 'fre-333');
  const acc = (id, name, code) => p.accessory.create({ data: { id, name, description: name, code, price: 1200, currency: 'DZD', stock: 5, ...S } });
  await acc('a-sold', 'Sold case', 'sca-111');
  await acc('a-bought', 'Bought cloth', 'bcl-222');
  await acc('a-free', 'Never used case', 'fca-333');
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  await p.order.create({ data: { id: 'o1', number: 'CMD-1', customerId: 'c1', status: 'delivered', subtotalCents: 2000000, totalCents: 2000000, ...S } });
  await p.orderItem.create({ data: { id: 'i1', orderId: 'o1', kind: 'frame', frameId: 'f-sold', description: 'Sold frame', quantity: 1, unitPriceCents: 1850000, totalCents: 1850000, ...S } });
  await p.orderItem.create({ data: { id: 'i2', orderId: 'o1', kind: 'accessory', accessoryId: 'a-sold', description: 'Sold case', quantity: 1, unitPriceCents: 120000, totalCents: 120000, ...S } });
  await p.supplier.create({ data: { id: 's1', name: 'Frames Co', ...S } });
  await p.supplierOrder.create({ data: { id: 'so1', supplierId: 's1', totalCents: 100000, ...S } });
  await p.supplierOrderItem.create({ data: { id: 'l1', supplierOrderId: 'so1', frameId: 'f-bought', quantity: 2, unitCostCents: 50000, ...S } });
  await p.supplierOrderItem.create({ data: { id: 'l2', supplierOrderId: 'so1', accessoryId: 'a-bought', quantity: 2, unitCostCents: 5000, ...S } });
`,
);

let A;
const openCard = async (kind, id) => {
  await A.val(`(async () => {
    const api = window.electronAPI.${kind === "frame" ? "frames" : "accessories"};
    const catalog = await window.electronAPI.catalog.getCategoriesAndBrands();
    const found = ${kind === "frame" ? "(await api.searchWithPhotos('', 'model', {})).frames" : "(await api.listWithPhotos())"}.find((x) => x.id === ${JSON.stringify(id)});
    window.openEditCard({ kind: ${JSON.stringify(kind)}, item: found, brands: catalog.brands, categories: catalog.categories, onUpdated() {}, onDeleted() { window.__deleted = ${JSON.stringify(id)}; } });
    return 1;
  })()`);
  await A.until("!!document.querySelector('dialog[open] [data-action=save]')");
  await sleep(400); // (the card asks whether the product was used)
};
const state = () => A.val("(() => { const d = document.querySelector('dialog[open]'); const del = d.querySelector('[data-action=delete]'); const kept = d.querySelector('[data-kept]'); return { delete: !!del && !del.hidden, kept: !!kept && !kept.hidden, keptText: kept && !kept.hidden ? kept.textContent : '' }; })()");
const closeCard = () => A.val("(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); return 1; })()");

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.openEditCard === 'function' && typeof window.electronAPI?.frames?.usage === 'function'", 20000);

    R.section("the service");
    R.ck((await A.val("window.electronAPI.frames.usage('f-sold')")) === 1 && (await A.val("window.electronAPI.frames.usage('f-bought')")) === 1 && (await A.val("window.electronAPI.frames.usage('f-free')")) === 0, "a frame on an order or on a supplier order is used once; a free one is not used");
    R.ck((await A.val("window.electronAPI.accessories.usage('a-sold')")) === 1 && (await A.val("window.electronAPI.accessories.usage('a-bought')")) === 1 && (await A.val("window.electronAPI.accessories.usage('a-free')")) === 0, "the same for accessories");
    for (const [kind, id] of [["frames", "f-sold"], ["frames", "f-bought"], ["accessories", "a-sold"], ["accessories", "a-bought"]]) {
      const refused = await A.val(`window.electronAPI.${kind}.delete(${JSON.stringify(id)}).then(() => 'deleted', (e) => e.message)`);
      R.ck(refused !== "deleted" && /cannot be deleted/.test(refused), `${id}: deleting it is refused`, String(refused).slice(0, 90));
    }

    R.section("the Edit card");
    for (const [kind, id, used] of [["frame", "f-sold", true], ["frame", "f-bought", true], ["accessory", "a-sold", true], ["accessory", "a-bought", true], ["frame", "f-free", false], ["accessory", "a-free", false]]) {
      await openCard(kind, id);
      const s = await state();
      R.ck(s.delete === !used && s.kept === used, `${id}: ${used ? "no Delete, a note says why" : "Delete is offered"}`, JSON.stringify(s));
      if (used) R.ck(s.keptText.includes(kind === "frame" ? "This frame is on orders" : "This accessory is on orders"), `${id}: the note names the product kind`, s.keptText);
      await closeCard();
    }

    R.section("a product that was never used");
    await openCard("frame", "f-free");
    await A.val("document.querySelector('dialog[open] [data-action=delete]').click()");
    await A.until("!!document.querySelector('dialog[open] [data-action=confirm-delete]')");
    await A.val("document.querySelector('dialog[open] [data-action=confirm-delete]').click()");
    R.ck(await A.until("window.__deleted === 'f-free'", 10000), "it is deleted from the card");
    R.ck((await A.val("window.electronAPI.frames.get('f-free')")) === null, "and it is gone");
    R.ck((await A.val("window.electronAPI.frames.get('f-sold')")) !== null && (await A.val("window.electronAPI.accessories.get('a-sold')")) !== null, "the used ones are untouched");
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
