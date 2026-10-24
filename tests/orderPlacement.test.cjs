// Placing an order (src/local/orderPlacement.ts): the draft is checked (alone, then against the shop's own rows), the order, its lines and the deposit are
// saved together or not at all, the prices are copied onto the lines, the number is counted up, and a prescription the order uses is frozen.
const { sandbox, runScript, recorder, ROOT } = require("./helpers/app.cjs");
const path = require("node:path");

const R = recorder();

// ---- the checks that need no database
const { validateOrderDraft } = require(path.join(ROOT, "dist", "local", "orderDraft.js"));
const bad = (draft) => validateOrderDraft(draft, new Date(2026, 9, 22)).errors ?? null;
const good = (draft) => validateOrderDraft(draft, new Date(2026, 9, 22)).draft ?? null;

R.section("the draft, checked alone");
R.ck(bad({})?.customerId && bad({})?.items, "an empty draft: the customer and something to sell are asked for");
R.ck(bad({ customerId: "c1" })?.items === "Choose something to sell: a frame, an accessory or a lens.", "a customer alone is not an order");
R.ck(good({ customerId: "c1", frameId: "f1" })?.depositCents === 0, "a frame alone is an order (no deposit = 0)");
R.ck(good({ customerId: "c1", frameId: "f1", deposit: "5000,50" })?.depositCents === 500050, "money is typed with a comma or a dot and kept in centimes");
R.ck(bad({ customerId: "c1", frameId: "f1", deposit: "12.345" })?.deposit && bad({ customerId: "c1", frameId: "f1", deposit: "-5" })?.deposit && bad({ customerId: "c1", frameId: "f1", deposit: "abc" })?.deposit, "more than 2 decimals, a minus sign or text is not an amount");
R.ck(bad({ customerId: "c1", frameId: "f1", deposit: 2000000 })?.deposit, "an amount above 1,000,000 is refused");
R.ck(bad({ customerId: "c1", lensId: "l1" })?.prescriptionId, "a lens from the list needs the prescription it is for");
R.ck(good({ customerId: "c1", lensId: "l1", prescriptionId: "rx1" }) !== null, "a lens with its prescription is fine");
R.ck(bad({ customerId: "c1", lensId: "l1", prescriptionId: "rx1", lensDescription: "x" })?.lensDescription, "a lens from the list and a description together are refused");
R.ck(bad({ customerId: "c1", lensDescription: "Progressive 1.6" })?.lensPrice, "a described lens needs its price");
R.ck(good({ customerId: "c1", lensDescription: "  Progressive   1.6  ", lensPrice: "14000" })?.lensDescription === "Progressive 1.6", "a described lens needs no prescription; spaces are tidied");
R.ck(bad({ customerId: "c1", lensDescription: "x".repeat(201), lensPrice: 1 })?.lensDescription, "a description over 200 characters is refused");
R.ck(bad({ customerId: "c1", frameId: "f1", pdRight: 31 })?.pdLeft && good({ customerId: "c1", frameId: "f1", pdRight: 31, pdLeft: "30,5" }) !== null, "the PD is given for both eyes or for neither");
R.ck(bad({ customerId: "c1", frameId: "f1", pdRight: 10, pdLeft: 31 })?.pdRight && bad({ customerId: "c1", frameId: "f1", fittingHeightRight: 50 })?.fittingHeightRight && bad({ customerId: "c1", frameId: "f1", fittingHeightLeft: 20.3 })?.fittingHeightLeft, "PD (15 to 45) and fitting height (5 to 45) are in range, in steps of 0.5");
R.ck(good({ customerId: "c1", frameId: "f1", promisedAt: "2026-10-22" })?.promisedAt === "2026-10-22" && bad({ customerId: "c1", frameId: "f1", promisedAt: "2026-10-21" })?.promisedAt && bad({ customerId: "c1", frameId: "f1", promisedAt: "2026-02-30" })?.promisedAt, "the promised day is a real date, today or later");

// ---- against a real local database
const box = sandbox("op-placeorder-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = (key) => ({ tenantKey: key, synced: true });
  await p.customer.create({ data: { id: 'c1', name: 'Amina', ...S('t1') } });
  await p.customer.create({ data: { id: 'c2', name: 'Karim', ...S('t1') } });
  const rx = (id, customerId, key) => p.prescription.create({ data: { id, customerId, prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, leftSphere: -1.5, ...S(key) } });
  await rx('rx1', 'c1', 't1');
  await rx('rx2', 'c2', 't1');
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S('t1') } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, price) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, price, currency: 'DZD', stock: 3, ...S('t1') } });
  await frame('f1', 'Aviator', 18500);
  await p.frame.update({ where: { id: 'f1' }, data: { costPrice: 12000 } });
  await frame('f2', 'No price', null);
  await p.accessory.create({ data: { id: 'a1', name: 'Hard case', description: 'case', price: 1200.5, costPrice: 800.25, currency: 'DZD', stock: 9, ...S('t1') } });
  const lens = (id, name, over) => p.lens.create({ data: { id, name, brand: 'Essilor', priceCents: 500000, ...over, ...S(over?.tenantKey ?? 't1') } });
  await lens('l1', 'Stock 1.5', { costCents: 300000 });
  await lens('l6', 'No cost entered', { priceCents: 200000 });
  await lens('l2', 'Retired', { isActive: false });
  await p.lens.create({ data: { id: 'l3', name: 'Other shop lens', priceCents: 100, ...S('t2') } });

  const L = require(ROOT + '/dist/local/index.js');
  const place = (d) => L.localOrderPlacementService.place(d);
  const counts = async () => ({ orders: await p.order.count(), items: await p.orderItem.count(), payments: await p.payment.count(), sequences: await p.numberSequence.count() });
  const out = {};

  const first = await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', accessoryId: 'a1', deposit: '5000', pdRight: 31, pdLeft: 30.5, fittingHeightRight: 22, fittingHeightLeft: 21.5, promisedAt: '2099-01-05', notes: ' call me ' });
  out.first = first.status === 'placed' ? { number: first.order.number, status: first.order.status, total: first.totalCents, lines: first.lines, deposit: first.depositCents, sent: first.sentToServer, notes: first.order.notes } : first;
  const o1 = await p.order.findFirst({ where: { id: first.order?.id } });
  out.stored = { customer: o1.customerId, rx: o1.prescriptionId, subtotal: o1.subtotalCents, discount: o1.discountCents, total: o1.totalCents, pdR: o1.pdRight, pdL: o1.pdLeft, fhR: o1.fittingHeightRight, fhL: o1.fittingHeightLeft, promised: o1.promisedAt?.toISOString(), synced: o1.synced, tenant: o1.tenantKey };
  const items = await p.orderItem.findMany({ where: { orderId: o1.id }, orderBy: { kind: 'asc' } });
  out.items = items.map((i) => [i.kind, i.description, i.eye, i.quantity, i.unitPriceCents, i.totalCents, i.frameId ?? i.lensId ?? i.accessoryId].join('|'));
  const pays = await p.payment.findMany({ where: { orderId: o1.id } });
  out.payments = pays.map((x) => [x.amountCents, x.customerId, x.chequeDueDate === null].join('|'));

  const second = await place({ customerId: 'c1', lensDescription: 'Progressive 1.6 with anti-reflective', lensPrice: '14000' });
  out.second = { number: second.order?.number, total: second.totalCents, lines: second.lines, payments: await p.payment.count({ where: { orderId: second.order.id } }) };
  const sItem = await p.orderItem.findFirst({ where: { orderId: second.order.id } });
  out.described = [sItem.kind, sItem.lensId, sItem.description, sItem.eye, sItem.unitPriceCents].join('|');

  const third = await place({ customerId: 'c1', prescriptionId: 'rx1', lensId: 'l1', lensPrice: '4500' });
  out.override = (await p.orderItem.findFirst({ where: { orderId: third.order.id } })).unitPriceCents;
  out.thirdNumber = third.order.number;

  await p.lens.update({ where: { id: 'l1' }, data: { priceCents: 999999 } });
  await p.frame.update({ where: { id: 'f1' }, data: { price: 99999 } });
  out.snapshotKept = (await p.orderItem.findMany({ where: { orderId: first.order.id }, orderBy: { kind: 'asc' } })).map((i) => i.unitPriceCents).join(',');

  // refusals: nothing is saved and no number is used
  const before = await counts();
  const refusals = {
    nothing: { customerId: 'c1' },
    noCustomer: { customerId: 'ghost', frameId: 'f1' },
    foreignRx: { customerId: 'c1', prescriptionId: 'rx2', frameId: 'f1' },
    missingRx: { customerId: 'c1', prescriptionId: 'ghost', frameId: 'f1' },
    noPriceFrame: { customerId: 'c1', frameId: 'f2' },
    ghostFrame: { customerId: 'c1', frameId: 'ghost' },
    ghostAccessory: { customerId: 'c1', accessoryId: 'ghost' },
    retired: { customerId: 'c1', prescriptionId: 'rx1', lensId: 'l2' },
    otherShopLens: { customerId: 'c1', prescriptionId: 'rx1', lensId: 'l3' },
    lensNoRx: { customerId: 'c1', lensId: 'l1' },
    depositTooBig: { customerId: 'c1', frameId: 'f1', deposit: 150000 },
    bothLenses: { customerId: 'c1', prescriptionId: 'rx1', lensId: 'l1', lensDescription: 'x' },
  };
  out.refused = {};
  for (const [name, draft] of Object.entries(refusals)) {
    const r = await place(draft);
    out.refused[name] = r.status === 'invalid' ? Object.keys(r.errors).join(',') : 'PLACED';
  }
  out.garbage = [];
  for (const g of [null, undefined, 42, 'x', []]) out.garbage.push((await place(g)).status);
  const after = await counts();
  out.unchanged = JSON.stringify(before) === JSON.stringify(after);
  out.countsAfter = after;

  // the exact deposit equal to the total is fine
  const exact = await place({ customerId: 'c2', frameId: 'f1', deposit: '99999' });
  out.exact = exact.status + ':' + (exact.status === 'placed' ? exact.totalCents + '/' + exact.depositCents : '');
  // nothing to make (no lens): delivered at once, with its delivery day; with a lens (from the list or in words) it waits for the lab
  const frameOnly = await p.order.findFirst({ where: { id: exact.order.id } });
  const accessoryOnly = await place({ customerId: 'c1', accessoryId: 'a1' });
  const withListLens = await p.order.findFirst({ where: { id: first.order.id } });
  const withDescribed = await p.order.findFirst({ where: { id: second.order.id } });
  out.delivery = {
    frameOnly: frameOnly.status + ':' + (frameOnly.deliveredAt !== null) + ':' + (Math.abs(frameOnly.deliveredAt - frameOnly.orderedAt) < 1000),
    accessoryOnly: accessoryOnly.order.status + ':' + (accessoryOnly.order.deliveredAt !== null),
    listLens: withListLens.status + ':' + (withListLens.deliveredAt === null),
    describedLens: withDescribed.status + ':' + (withDescribed.deliveredAt === null),
    onDetails: (await L.localOrderDetailsService.get(exact.order.id)).status,
    canPayWhenDelivered: (await L.localOrderDetailsService.get(accessoryOnly.order.id)).canPay,
  };

  // an order freezes its prescription
  out.frozen = await L.localPrescriptionService.update('rx1', { notes: 'changed' }).then(() => 'changed', (e) => e.kind);
  out.frozenEdit = await L.localPrescriptionService.edit('rx1', { customerId: 'c1', prescribedAt: '2026-01-10', rightSphere: '-3' }).then((r) => r.status, (e) => e.kind);

  // the order page reads what was placed
  const details = await L.localOrderDetailsService.get(first.order.id);
  out.details = { total: details.totalCents, paid: details.paidCents, left: details.remainingCents, items: details.items.length, canPay: details.canPay };
  // the COST of each line is copied on the day of the sale; a later change of a product's cost changes nothing
  const costsOf = async (orderId) => (await p.orderItem.findMany({ where: { orderId }, orderBy: { kind: 'asc' } })).map((i) => i.kind + ':' + i.unitCostCents).join(',');
  out.costs = { full: await costsOf(first.order.id) };
  const costOrder = await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', accessoryId: 'a1', lensId: 'l1' });
  out.costs.fresh = await costsOf(costOrder.order.id);
  await p.frame.update({ where: { id: 'f1' }, data: { costPrice: 99999 } });
  await p.lens.update({ where: { id: 'l1' }, data: { costCents: 888888 } });
  await p.accessory.update({ where: { id: 'a1' }, data: { costPrice: 5000 } });
  out.costs.afterChange = await costsOf(costOrder.order.id);
  out.costs.next = await costsOf((await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', accessoryId: 'a1', lensId: 'l1' })).order.id);
  out.costs.noCostLens = await costsOf((await place({ customerId: 'c1', prescriptionId: 'rx1', lensId: 'l6' })).order.id);
  out.costs.typedLens = await costsOf((await place({ customerId: 'c1', prescriptionId: 'rx1', lensId: 'l6', lensCost: '1500,50' })).order.id);
  out.costs.typedOverCatalogue = await costsOf((await place({ customerId: 'c1', prescriptionId: 'rx1', lensId: 'l1', lensCost: 100 })).order.id);
  out.costs.typedZero = await costsOf((await place({ customerId: 'c1', prescriptionId: 'rx1', lensId: 'l6', lensCost: '0' })).order.id);
  out.costs.described = await costsOf((await place({ customerId: 'c1', lensDescription: 'Progressive', lensPrice: 14000 })).order.id);
  out.costs.describedTyped = await costsOf((await place({ customerId: 'c1', lensDescription: 'Progressive', lensPrice: 14000, lensCost: 9000 })).order.id);
  await p.frame.update({ where: { id: 'f1' }, data: { costPrice: null } });
  out.costs.noCostFrame = await costsOf((await place({ customerId: 'c1', frameId: 'f1' })).order.id);

  // the FINAL PRICE: lower is a discount; the lines keep the prices they were sold at
  const money = async (orderId) => { const o = await p.order.findFirst({ where: { id: orderId } }); return [o.subtotalCents, o.discountCents, o.totalCents].join('/'); };
  const lineSum = async (orderId) => (await p.orderItem.findMany({ where: { orderId } })).reduce((s, i) => s + i.totalCents, 0);
  const none = await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1' });
  out.final = { none: await money(none.order.id) };
  const S0 = none.totalCents; // what the items add up to (in centimes); the prices below are made from it
  const dzd = (cents) => (cents / 100).toFixed(2);
  out.final.S0 = S0;
  const lower = await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', finalPrice: dzd(S0 - 100000) });
  out.final.lower = await money(lower.order.id);
  out.final.lowerLines = await lineSum(lower.order.id);
  out.final.lowerAnswer = lower.totalCents;
  out.final.equal = await money((await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', finalPrice: dzd(S0) })).order.id);
  out.final.zero = await money((await place({ customerId: 'c1', frameId: 'f1', finalPrice: '0' })).order.id);
  out.final.higher = (await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', finalPrice: dzd(S0 + 1) })).errors?.finalPrice;
  out.final.bad = [(await place({ customerId: 'c1', frameId: 'f1', finalPrice: 'abc' })).errors?.finalPrice, (await place({ customerId: 'c1', frameId: 'f1', finalPrice: -5 })).errors?.finalPrice];
  const depositOverFinal = await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', finalPrice: dzd(S0 - 100000), deposit: dzd(S0 - 100000 + 1) });
  out.final.depositOverFinal = depositOverFinal.errors?.deposit;
  const paidUp = await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', finalPrice: dzd(S0 - 100000), deposit: dzd(S0 - 100000) });
  out.final.paidUp = paidUp.status + ':' + paidUp.totalCents + '/' + paidUp.depositCents;
  const paidUpDetails = await L.localOrderDetailsService.get(paidUp.order.id);
  out.final.details = { total: paidUpDetails.totalCents, discount: paidUpDetails.discountCents, left: paidUpDetails.remainingCents };
  out.api = require(ROOT + '/dist/ipc/channels.js').API_METHODS.orderPlacement;
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("a full order");
R.ck(/^CMD-\d{4}-0001$/.test(r.first?.number ?? ""), "the order gets the next number (CMD-year-0001)", r.first?.number);
R.section("delivered at once when there is no lens");
R.ck(r.delivery?.frameOnly === "delivered:true:true", "a frame alone: delivered, with the delivery day set to the order's moment", r.delivery?.frameOnly);
R.ck(r.delivery?.accessoryOnly === "delivered:true", "an accessory alone: delivered too");
R.ck(r.delivery?.listLens === "confirmed:true" && r.delivery?.describedLens === "confirmed:true", "with a lens (from the list, or described) the order waits for the lab: confirmed, no delivery day");
R.ck(r.delivery?.onDetails === "delivered" && r.delivery?.canPayWhenDelivered === true, "its page shows delivered, and a balance can still be paid on it");
R.section("a full order");
R.ck(r.first?.status === "confirmed" && r.first?.lines === 3 && r.first?.deposit === 500000, "confirmed, three lines, the deposit");
R.ck(r.first?.total === 1850000 + 500000 + 120050, "the total is the frame + the lens + the accessory, in centimes (1200.50 -> 120050)", r.first?.total);
R.ck(r.first?.notes === "call me", "notes are trimmed");
R.ck(r.first?.sent === false && r.stored?.synced === false, "the server is not reachable here: it says so, and the order waits for the next sync");
R.ck(r.stored?.customer === "c1" && r.stored?.rx === "rx1" && r.stored?.tenant === "t1", "linked to its customer and prescription, in this shop");
R.ck(r.stored?.subtotal === r.stored?.total && r.stored?.discount === 0, "no discount: subtotal = total");
R.ck(r.stored?.pdR === 31 && r.stored?.pdL === 30.5 && r.stored?.fhR === 22 && r.stored?.fhL === 21.5, "the PD and the fitting heights of each eye are kept on the order");
R.ck(r.stored?.promised?.startsWith("2099-01-05"), "the promised day is kept");
R.ck(r.items?.join("~") === "accessory|Hard case||1|120050|120050|a1~frame|Ray-Ban Aviator||1|1850000|1850000|f1~lens|Essilor Stock 1.5|both|1|500000|500000|l1", "the lines carry what was sold, as printed: brand + name, the eye (both for the lens pair), the price", JSON.stringify(r.items));
R.ck(r.payments?.join() === "500000|c1|true", "the deposit is a payment of that order, for that customer, dated now");

R.section("the lens: from the list, described, or at another price");
R.ck(/^CMD-\d{4}-0002$/.test(r.second?.number ?? "") && r.second?.total === 1400000 && r.second?.lines === 1 && r.second?.payments === 0, "a described lens alone is an order (numbered 0002, no deposit, no payment)");
R.ck(r.described === "lens||Progressive 1.6 with anti-reflective|both|1400000", "its line has no linked lens, the words and the typed price", r.described);
R.ck(r.override === 450000, "a typed price replaces the catalogue price", r.override);
R.ck(/0003$/.test(r.thirdNumber ?? ""), "the numbers count up");
R.ck(r.snapshotKept === "120050,1850000,500000", "changing the catalogue afterwards does not change the order's prices", r.snapshotKept);

R.section("what is refused (and nothing is saved)");
const want = {
  nothing: "items", noCustomer: "customerId", foreignRx: "prescriptionId", missingRx: "prescriptionId", noPriceFrame: "frameId", ghostFrame: "frameId",
  ghostAccessory: "accessoryId", retired: "lensId", otherShopLens: "lensId", lensNoRx: "prescriptionId", depositTooBig: "deposit", bothLenses: "lensDescription",
};
for (const [name, field] of Object.entries(want)) R.ck(r.refused?.[name] === field, `${name}: refused on ${field}`, r.refused?.[name]);
R.ck(r.garbage?.every((s) => s === "invalid"), "null, undefined, a number, text or a list are refused as a draft");
R.ck(r.unchanged === true, "no order, line, payment or number was created by any refusal", JSON.stringify(r.countsAfter));
R.ck(r.exact === "placed:9999900/9999900", "a deposit equal to the total is fine (a paid-up order)", r.exact);

R.section("the cost of each line is copied on the day of the sale");
R.ck(r.costs?.full === "accessory:80025,frame:1200000,lens:300000", "the frame's, the accessory's and the lens's cost are saved on their lines (12 000, 800.25 and 3 000 in centimes)", r.costs?.full);
R.ck(r.costs?.afterChange === r.costs?.fresh && r.costs?.fresh === "accessory:80025,frame:1200000,lens:300000", "changing the products' costs afterwards changes nothing in the order already made", `${r.costs?.fresh} -> ${r.costs?.afterChange}`);
R.ck(r.costs?.next === "accessory:500000,frame:9999900,lens:888888", "and the next order takes the new costs", r.costs?.next);
R.ck(r.costs?.noCostLens === "lens:null", "a lens whose catalogue cost was never entered (0) has no known cost: null, not 0", r.costs?.noCostLens);
R.ck(r.costs?.typedLens === "lens:150050" && r.costs?.typedOverCatalogue === "lens:10000", "a lens cost typed with the order is used (it beats the catalogue's)", `${r.costs?.typedLens} ${r.costs?.typedOverCatalogue}`);
R.ck(r.costs?.typedZero === "lens:0", "a cost typed as 0 is a known cost of 0, not an unknown one");
R.ck(r.costs?.described === "lens:null" && r.costs?.describedTyped === "lens:900000", "a lens described in words has no known cost unless one is typed");
R.ck(r.costs?.noCostFrame === "frame:null", "a frame with no cost entered has a null cost");

R.section("the final price");
R.ck(/^(\d+)\/0\/\1$/.test(r.final?.none ?? ""), "with no final price the total is what the items add up to, with no discount", r.final?.none);
const [sub, disc, tot] = (r.final?.lower ?? "0/0/0").split("/").map(Number);
R.ck(sub === r.final?.S0 && tot === r.final?.S0 - 100000 && disc === 100000, "a lower final price becomes the total, and the difference the discount (subtotal / discount / total)", r.final?.lower);
R.ck(r.final?.lowerLines === r.final?.S0 && r.final?.lowerAnswer === tot, "the lines keep the prices they were sold at; the answer carries the final price");
R.ck(r.final?.equal === `${r.final?.S0}/0/${r.final?.S0}` && r.final?.zero.endsWith("/0") && r.final?.zero.split("/")[1] === r.final?.zero.split("/")[0], "a final price equal to the items is no discount; 0 is allowed (everything discounted)", `${r.final?.equal} ${r.final?.zero}`);
R.ck(/cannot be more than the items add up to/.test(r.final?.higher ?? ""), "a final price above what the items add up to is refused (to charge more, change a price)", r.final?.higher);
R.ck(r.final?.bad?.every((m) => /must be an amount/.test(m ?? "")), "text or a negative amount is not a price");
R.ck(r.final?.depositOverFinal === "The deposit cannot be more than the order's total.", "the deposit is checked against the FINAL price, not against the items");
R.ck(r.final?.paidUp?.startsWith("placed:") && r.final?.details?.left === 0 && r.final?.details?.discount === 100000 && r.final?.details?.total === r.final?.S0 - 100000, "a deposit equal to the final price pays the order up, and the order's page shows the final total and the discount", JSON.stringify(r.final?.details));

R.section("afterwards");
R.ck(r.frozen === "invalid-input" && r.frozenEdit === "invalid-input", "the prescription the order uses can no longer be changed or edited");
R.ck(r.details?.total === 2470050 && r.details?.paid === 500000 && r.details?.left === 1970050 && r.details?.items === 3 && r.details?.canPay === true, "the order's page shows it: total, paid, what is left, three lines, and it can take a payment", JSON.stringify(r.details));
R.ck(r.api?.join() === "place", "orderPlacement.place is on the list of what the window may call");
process.exit(R.done());
