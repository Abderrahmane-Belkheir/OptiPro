// Placing an order with a supplier (src/local/supplierOrderPlacement.ts): the order and its lines are saved with the supplier, each frame's stock goes UP by the
// quantity bought and its cost becomes what one cost (a price for each frame, or the batch price shared over the frames bought) ONLY for a frame whose stock is 0;
// a frame that still has stock keeps its stock and its cost (its line is saved all the same). All or nothing.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-supplierorderplace-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = (key) => ({ tenantKey: key, synced: true });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S('t1') } });
  await p.brand.create({ data: { id: 'b2', name: 'Other brand', ...S('t2') } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, stock, key = 't1', brandId = 'b1') => p.frame.create({ data: { id, name, brandId, categoryId: 1, price: 18500, currency: 'DZD', stock, ...S(key) } });
  await frame('f1', 'Aviator', 0);
  await frame('f2', 'Wayfarer', 2);
  await frame('f3', 'Holbrook', 0);
  await frame('f4', 'Clubmaster', 6);
  await frame('fx', 'Other shop frame', 0, 't2', 'b2');
  await p.frame.update({ where: { id: 'f2' }, data: { costPrice: 5000 } });
  const acc = (id, name, stock) => p.accessory.create({ data: { id, name, description: 'x', price: 1500, currency: 'DZD', stock, ...S('t1') } });
  await acc('a1', 'Hard case', 0);
  await acc('a2', 'Cleaning cloth', 3);
  await acc('a3', 'Chain', 0);
  await acc('a4', 'Spray', 0);
  await p.supplier.create({ data: { id: 's1', name: 'Optic Import', kinds: 'frames', ...S('t1') } });
  await p.supplier.create({ data: { id: 's2', name: 'Retired', kinds: 'frames', isActive: false, ...S('t1') } });
  await p.supplier.create({ data: { id: 'sx', name: 'Other shop supplier', kinds: 'frames', ...S('t2') } });

  const L = require(ROOT + '/dist/local/index.js');
  const place = (d) => L.localSupplierOrderPlacementService.place(d);
  const PS0 = require(ROOT + '/dist/local/productSearch.js');
  const frames = async () => Object.fromEntries((await p.frame.findMany({ orderBy: { id: 'asc' } })).map((f) => [f.id, [f.stock, f.costPrice, f.synced]]));
  const counts = async () => ({ orders: await p.supplierOrder.count(), items: await p.supplierOrderItem.count() });
  const out = { start: await frames() };

  // a price for each frame
  const unit = await place({ supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f1', quantity: 10, unitCost: '9500' }, { frameId: 'f2', quantity: '5', unitCost: '11000,50' }] });
  out.unit = { status: unit.status, lines: unit.lines, updated: unit.updatedLines, added: unit.addedQuantity, quantity: unit.quantity, total: unit.totalCents, sent: unit.sentToServer };
  out.afterUnit = await frames();
  const o1 = await p.supplierOrder.findFirst({ where: { id: unit.orderId } });
  out.order1 = { supplier: o1.supplierId, mode: o1.priceMode, total: o1.totalCents, status: o1.status, tenant: o1.tenantKey, synced: o1.synced };
  out.items1 = (await p.supplierOrderItem.findMany({ where: { supplierOrderId: unit.orderId }, orderBy: { createdAt: 'asc' } })).map((i) => [i.frameId, i.quantity, i.unitCostCents, i.used].join('|'));

  // the price of the whole batch, shared over the frames bought (rounded to the centime)
  const batch = await place({ supplierId: 's1', priceMode: 'batch', batchTotal: '100000', lines: [{ frameId: 'f1', quantity: 1 }, { frameId: 'f3', quantity: 2 }] });
  out.batch = { status: batch.status, quantity: batch.quantity, updated: batch.updatedLines, added: batch.addedQuantity, total: batch.totalCents };
  const f = await frames();
  out.afterBatch = { f1: f.f1, f3: f.f3 }; // 100 000 / 3 frames = 33 333.33 each
  out.items2 = (await p.supplierOrderItem.findMany({ where: { supplierOrderId: batch.orderId }, orderBy: { createdAt: 'asc' } })).map((i) => [i.frameId, i.quantity, i.unitCostCents, i.used].join('|'));
  out.order2 = (await p.supplierOrder.findFirst({ where: { id: batch.orderId } })).totalCents;

  // frames and accessories in ONE order: a price for each line, then a price for the whole batch shared over all the pieces
  const acc1 = await place({ supplierId: 's1', priceMode: 'unit', lines: [{ accessoryId: 'a1', quantity: 4, unitCost: '1200' }, { accessoryId: 'a2', quantity: 2, unitCost: '800' }, { frameId: 'f4', quantity: 1, unitCost: '5000' }] });
  const accStock = async () => Object.fromEntries((await p.accessory.findMany({ orderBy: { id: 'asc' } })).map((a) => [a.id, [a.stock, a.costPrice, a.synced]]));
  out.mixed = { status: acc1.status, lines: acc1.lines, updated: acc1.updatedLines, added: acc1.addedQuantity, quantity: acc1.quantity, total: acc1.totalCents };
  out.mixedAcc = await accStock();
  out.mixedF4 = (await frames()).f4;
  const waitAcc = await place({ supplierId: 's1', priceMode: 'unit', lines: [{ accessoryId: 'a2', quantity: 1, unitCost: '10' }] });
  out.waitingAcc = waitAcc.status === 'invalid' ? Object.keys(waitAcc.errors).join(',') : waitAcc.status;
  out.mixedItems = (await p.supplierOrderItem.findMany({ where: { supplierOrderId: acc1.orderId }, orderBy: { createdAt: 'asc' } })).map((i) => [i.frameId ?? '-', i.accessoryId ?? '-', i.quantity, i.unitCostCents, i.used].join('|'));
  const acc2 = await place({ supplierId: 's1', priceMode: 'batch', batchTotal: '10000', lines: [{ accessoryId: 'a3', quantity: 3 }, { accessoryId: 'a4', quantity: 1 }] });
  out.mixedBatch = { status: acc2.status, total: acc2.totalCents, quantity: acc2.quantity, updated: acc2.updatedLines };
  out.mixedBatchAcc = await accStock();
  out.mixedBatchItems = (await p.supplierOrderItem.findMany({ where: { supplierOrderId: acc2.orderId }, orderBy: { createdAt: 'asc' } })).map((i) => [i.accessoryId, i.quantity, i.unitCostCents, i.used].join('|'));
  // the search lists frames AND accessories, without those that have a line waiting (a2, f3 and the frames with a waiting line)
  const found = await PS0.searchSupplierProducts('', 'model', { accessoriesOnly: true });
  out.accSearch = found.products.map((x) => x.kind + ':' + x.id);
  out.frameSearch = (await PS0.searchSupplierProducts('', 'model', { categoryId: 1 })).products.map((x) => x.kind + ':' + x.id);
  // the stock of the waiting accessory becomes 0 by a plain update: the waiting line comes in
  await p.accessory.update({ where: { id: 'a2' }, data: { stock: 0 } });
  out.a2 = (await accStock()).a2;
  out.a2line = (await p.supplierOrderItem.findFirst({ where: { accessoryId: 'a2' } })).used;

  // the search for a new supplier order leaves out a frame that has a line waiting (used = false)
  const PS = require(ROOT + '/dist/local/productSearch.js');
  const ids = async (filter) => (await PS.searchFrameIds('', 'model', { categoryId: 1, ...filter })).sort().join();
  out.search = { all: await ids({}), notOrdered: await ids({ notOrdered: true }), both: await ids({ notOrdered: true, outOfStock: true }), stock0: await ids({ outOfStock: true }) };

  // refused: nothing is saved, nothing changes
  const before = JSON.stringify(await frames());
  const beforeCounts = JSON.stringify(await counts());
  const bad = {
    noSupplier: { priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: '10' }] },
    retired: { supplierId: 's2', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: '10' }] },
    otherShopSupplier: { supplierId: 'sx', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: '10' }] },
    noMode: { supplierId: 's1', lines: [{ frameId: 'f3', quantity: 1, unitCost: '10' }] },
    noLines: { supplierId: 's1', priceMode: 'unit', lines: [] },
    otherShopFrame: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'fx', quantity: 1, unitCost: '10' }] },
    twice: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: '10' }, { frameId: 'f3', quantity: 1, unitCost: '10' }] },
    qty0: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 0, unitCost: '10' }] },
    qtyText: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 'two', unitCost: '10' }] },
    qtyHuge: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 10000, unitCost: '10' }] },
    noPrice: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1 }] },
    textPrice: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: 'abc' }] },
    zeroPrice: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: '0' }] },
    negativePrice: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 1, unitCost: '-5' }] },
    noBatch: { supplierId: 's1', priceMode: 'batch', lines: [{ frameId: 'f3', quantity: 1 }] },
    textBatch: { supplierId: 's1', priceMode: 'batch', batchTotal: '10000,333', lines: [{ frameId: 'f3', quantity: 1 }] },
    tinyBatch: { supplierId: 's1', priceMode: 'batch', batchTotal: '0.01', lines: [{ frameId: 'f3', quantity: 9999 }] },
    hugePrice: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', quantity: 9999, unitCost: '9999999' }] },
    waiting: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f2', quantity: 1, unitCost: '10' }] },
    ghostAcc: { supplierId: 's1', priceMode: 'unit', lines: [{ accessoryId: 'ghost', quantity: 1, unitCost: '10' }] },
    both: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'f3', accessoryId: 'a3', quantity: 1, unitCost: '10' }] },
    ghostFrame: { supplierId: 's1', priceMode: 'unit', lines: [{ frameId: 'ghost', quantity: 1, unitCost: '10' }] },
  };
  out.bad = {};
  for (const [name, draft] of Object.entries(bad)) { const r = await place(draft); out.bad[name] = r.status === 'invalid' ? Object.keys(r.errors).join(',') : r.status; }
  out.nothingChanged = JSON.stringify(await frames()) === before && JSON.stringify(await counts()) === beforeCounts;
  out.nothingAtAll = [await place(undefined), await place(null), await place({ supplierId: 's1', priceMode: 'unit', lines: 'x' })].map((r) => r.status);
  out.api = Object.keys(L.localSupplierOrderPlacementService);

  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("a price for each frame (only the frame that was at 0 changes)");
R.ck(JSON.stringify(r.start) === JSON.stringify({ f1: [0, null, true], f2: [2, 5000, true], f3: [0, null, true], f4: [6, null, true], fx: [0, null, true] }), "the frames start as set", JSON.stringify(r.start));
R.ck(r.unit?.status === "placed" && r.unit?.lines === 2 && r.unit?.quantity === 15 && r.unit?.total === 15000250, "placed: 2 frames, 15 bought", JSON.stringify(r.unit));
R.ck(r.afterUnit?.f1?.[0] === 10 && r.afterUnit?.f1?.[1] === 9500 && r.afterUnit?.f1?.[2] === false, "the Aviator: stock 0 -> 10, cost 9 500, marked unsent so the server gets it", JSON.stringify(r.afterUnit?.f1));
R.ck(JSON.stringify(r.afterUnit?.f2) === JSON.stringify([2, 5000, true]) && r.unit?.updated === 1 && r.unit?.added === 10, "the Wayfarer already had stock (2): its stock and cost stay (2 and 5 000) and it is not marked unsent; one frame was updated, 10 added", JSON.stringify([r.afterUnit?.f2, r.unit?.updated, r.unit?.added]));
R.ck(JSON.stringify(r.afterUnit?.f3) === JSON.stringify(r.start?.f3) && JSON.stringify(r.afterUnit?.fx) === JSON.stringify(r.start?.fx), "the other frames are untouched, and so is the other shop's");
R.ck(r.order1?.supplier === "s1" && r.order1?.mode === "unit" && r.order1?.status === "received" && r.order1?.tenant === "t1" && r.order1?.total === 950000 * 10 + 1100050 * 5, "the order keeps its supplier, how the price was given and its total (10 x 9 500 + 5 x 11 000.50)", JSON.stringify(r.order1));
R.ck(JSON.stringify(r.items1) === JSON.stringify(["f1|10|950000|true", "f2|5|1100050|false"]), "and a line for each frame: the frame, the quantity, what ONE cost, and 'used' (true for the Aviator that was at 0, false for the Wayfarer that had stock)", JSON.stringify(r.items1));
R.ck(r.unit?.sent === false, "it waits for the server (not reachable here)");

R.section("the price of the whole batch");
R.ck(r.batch?.status === "placed" && r.batch?.quantity === 3 && r.batch?.total === 10000000 && r.order2 === 10000000, "the order's total is the batch price as typed (100 000)", JSON.stringify(r.batch));
R.ck(JSON.stringify(r.items2) === JSON.stringify(["f1|1|3333333|false", "f3|2|3333333|true"]), "shared over the 3 frames bought: 33 333.33 each (rounded to the centime), on every line", JSON.stringify(r.items2));
R.ck(r.afterBatch?.f3?.[0] === 2 && r.afterBatch?.f3?.[1] === 33333.33 && r.batch?.updated === 1 && r.batch?.added === 2, "the Holbrook (at 0) gets stock 2 and cost 33 333.33", JSON.stringify(r.afterBatch?.f3));
R.ck(r.afterBatch?.f1?.[0] === 10 && r.afterBatch?.f1?.[1] === 9500, "the Aviator now has stock (10): it keeps its stock and its cost of 9 500, although its line is in the order", JSON.stringify(r.afterBatch?.f1));

R.section("frames and accessories in one order");
R.ck(r.mixed?.status === "placed" && r.mixed?.lines === 3 && r.mixed?.quantity === 7 && r.mixed?.total === 1140000, "an order with 2 accessories and a frame: 3 lines, 7 pieces, a total of 11 400 (4 x 1 200 + 2 x 800 + 1 x 5 000)", JSON.stringify(r.mixed));
R.ck(r.mixed?.updated === 1 && r.mixed?.added === 4 && JSON.stringify(r.mixedAcc?.a1) === JSON.stringify([4, 1200, false]) && JSON.stringify(r.mixedAcc?.a2) === JSON.stringify([3, null, true]), "the accessory that was at 0 (the case) gets stock 4 and cost 1 200; the one that had stock (the cloth, 3) keeps its stock and cost", JSON.stringify([r.mixedAcc?.a1, r.mixedAcc?.a2]));
R.ck(r.mixedF4?.[0] === 6 && r.mixedF4?.[2] === true, "the frame in the same order had stock (6): it is unchanged", JSON.stringify(r.mixedF4));
R.ck(JSON.stringify(r.mixedItems) === JSON.stringify(["-|a1|4|120000|true", "-|a2|2|80000|false", "f4|-|1|500000|false"]), "the lines hold the frame or the accessory, the quantity, what one cost, and used", JSON.stringify(r.mixedItems));
R.ck(r.mixedBatch?.total === 1000000 && r.mixedBatch?.quantity === 4 && r.mixedBatch?.updated === 2 && JSON.stringify(r.mixedBatchItems) === JSON.stringify(["a3|3|250000|true", "a4|1|250000|true"]), "a batch price of 10 000 over 4 accessories: 2 500 each, total 10 000", JSON.stringify([r.mixedBatch, r.mixedBatchItems]));
R.ck(r.mixedBatchAcc?.a3?.[0] === 3 && r.mixedBatchAcc?.a3?.[1] === 2500 && r.mixedBatchAcc?.a4?.[0] === 1 && r.mixedBatchAcc?.a4?.[1] === 2500, "and both get their stock and the cost of 2 500", JSON.stringify([r.mixedBatchAcc?.a3, r.mixedBatchAcc?.a4]));
R.ck(r.a2?.[0] === 2 && r.a2?.[1] === 800 && r.a2line === true, "when the cloth's stock becomes 0 the waiting line comes in (2 at 800), like a frame's", JSON.stringify([r.a2, r.a2line]));
R.ck(r.accSearch?.join() === "accessory:a3,accessory:a1,accessory:a4", "the search lists the accessories (Chain, Hard case, Spray) without the cloth, which has a line waiting", JSON.stringify(r.accSearch));
R.ck(r.frameSearch?.join() === "frame:f3", "and the frames of a category without the ones that have a line waiting (only the Holbrook is left)", JSON.stringify(r.frameSearch));

R.section("a frame with a line waiting is not offered for a new order");
R.ck(r.search?.all === "f1,f2,f3,f4" && r.search?.notOrdered === "f3", "f1, f2 and f4 (a line with used = false) are left out, f3 (its line is used) stays; the other shop's frame is never there", JSON.stringify(r.search));
R.ck(r.search?.both === "" && r.search?.stock0 === "", "combined with 'out of stock' (f3 has stock 2 now) nothing is left");

R.section("refused: nothing is saved and nothing changes");
const b = r.bad ?? {};
R.ck(b.noSupplier === "supplierId" && b.retired === "supplierId" && b.otherShopSupplier === "supplierId", "no supplier, a retired one, or another shop's supplier", JSON.stringify([b.noSupplier, b.retired, b.otherShopSupplier]));
R.ck(r.waitingAcc === "a2.waiting", "an accessory that already has a line waiting (the cloth) can not be ordered again", String(r.waitingAcc));
R.ck(b.ghostAcc === "lines" && b.both === "lines", "an accessory that does not exist, or a line with both a frame and an accessory, is refused", JSON.stringify([b.ghostAcc, b.both]));
R.ck(b.waiting === "f2.waiting", "a frame that already has a line waiting (the Wayfarer: stock 2, its line not used) can not be ordered again", String(b.waiting));
R.ck(b.noMode === "priceMode" && b.noLines === "lines", "no way of giving the price, or no frame");
R.ck(b.otherShopFrame === "lines" && b.ghostFrame === "lines" && b.twice === "lines", "another shop's frame, a frame that does not exist, or the same frame twice", JSON.stringify([b.otherShopFrame, b.ghostFrame, b.twice]));
R.ck(b.qty0 === "f3.quantity" && b.qtyText === "f3.quantity" && b.qtyHuge === "f3.quantity", "a quantity that is 0, text, or above 9 999 (named on its line)", JSON.stringify([b.qty0, b.qtyText, b.qtyHuge]));
R.ck(b.noPrice === "f3.unitCost" && b.textPrice === "f3.unitCost" && b.zeroPrice === "f3.unitCost" && b.negativePrice === "f3.unitCost", "a missing, text, zero or negative price for a frame", JSON.stringify([b.noPrice, b.textPrice, b.zeroPrice, b.negativePrice]));
R.ck(b.noBatch === "batchTotal" && b.textBatch === "batchTotal" && b.tinyBatch === "batchTotal", "a missing, wrong or too small batch price", JSON.stringify([b.noBatch, b.textBatch, b.tinyBatch]));
R.ck(b.hugePrice === "f3.unitCost", "a price that makes the line too large for the database", String(b.hugePrice));
R.ck(r.nothingChanged === true, "after all of those no order, line or stock was changed");
R.ck(JSON.stringify(r.nothingAtAll) === JSON.stringify(["invalid", "invalid", "invalid"]), "nothing at all, or lines that are not a list, is refused without a crash", JSON.stringify(r.nothingAtAll));
R.ck(r.api?.join() === "place", "supplierOrders.place is what the window may call");

process.exit(R.done());
