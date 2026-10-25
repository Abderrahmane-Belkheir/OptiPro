// Placing an order takes the chosen frame out of the stock: one less, never below 0, and the frame is marked unsent so its new stock reaches the server.
// An order that is refused, or has no frame, leaves every stock alone.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-stockorder-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, leftSphere: -1.5, ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, stock) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock, ...S } });
  await frame('f1', 'Aviator', 3);
  await frame('f2', 'Last one', 1);
  await frame('f3', 'Sold out', 0);
  await frame('f4', 'Untouched', 5);
  await frame('f5', 'Waiting batch', 1);
  await frame('f6', 'Has stock', 3);
  await frame('f7', 'Two batches', 1);
  await frame('f8', 'Cancelled batch', 1);
  await frame('f9', 'Edited by hand', 4);
  await frame('f10', 'Raw update', 4);
  await frame('f11', 'Reopened order', 1);
  await frame('f12', 'Already at zero', 0);
  // supplier orders: lines waiting (used = false) for f5, f6, f7 (two of them) and f8 (in a cancelled order)
  await p.supplier.create({ data: { id: 's1', name: 'Optic Import', kinds: 'frames', ...S } });
  await p.supplierOrder.create({ data: { id: 'so1', supplierId: 's1', ...S } });
  await p.supplierOrder.create({ data: { id: 'so2', supplierId: 's1', status: 'cancelled', ...S } });
  const wait = (id, orderId, frameId, quantity, unitCostCents, at) => p.supplierOrderItem.create({ data: { id, supplierOrderId: orderId, frameId, quantity, unitCostCents, used: false, createdAt: new Date(at), ...S } });
  await wait('i5', 'so1', 'f5', 6, 800000, '2026-01-01T10:00:00Z');
  await wait('i6', 'so1', 'f6', 9, 700000, '2026-01-01T10:00:00Z');
  await wait('i7b', 'so1', 'f7', 20, 650000, '2026-02-01T10:00:00Z');
  await wait('i7a', 'so1', 'f7', 12, 600000, '2026-01-01T10:00:00Z');
  await wait('i8', 'so2', 'f8', 5, 500000, '2026-01-01T10:00:00Z');
  await p.accessory.create({ data: { id: 'a1', name: 'Hard case', description: 'case', price: 1200, currency: 'DZD', stock: 9, ...S } });
  await p.accessory.create({ data: { id: 'a2', name: 'Last case', description: 'case', price: 900, currency: 'DZD', stock: 1, ...S } });
  await p.accessory.create({ data: { id: 'a3', name: 'Cloth', description: 'cloth', price: 300, currency: 'DZD', stock: 2, ...S } });
  await p.supplierOrderItem.create({ data: { id: 'ia2', supplierOrderId: 'so1', accessoryId: 'a2', quantity: 5, unitCostCents: 40000, used: false, createdAt: new Date('2026-01-01T10:00:00Z'), ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Stock 1.5', brand: 'Essilor', priceCents: 500000, ...S } });

  const L = require(ROOT + '/dist/local/index.js');
  const place = (d) => L.localOrderPlacementService.place(d);
  const stock = async () => Object.fromEntries((await p.frame.findMany({ orderBy: { id: 'asc' } })).map((f) => [f.id, f.stock]));
  const out = { start: await stock() };

  await place({ customerId: 'c1', frameId: 'f1' });
  out.afterOne = await stock();
  const f1 = await p.frame.findFirst({ where: { id: 'f1' } });
  out.unsent = f1.synced === false; // (the server cannot be reached here, so the new stock waits to be sent)

  await place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f2', lensId: 'l1' });
  out.lastOne = (await stock()).f2;
  const again = await place({ customerId: 'c1', frameId: 'f2' });
  out.below = { status: again.status, stock: (await stock()).f2 }; // stock 0: the sale still goes through, the stock stays at 0
  const sold = await place({ customerId: 'c1', frameId: 'f3' });
  out.soldOut = { status: sold.status, stock: (await stock()).f3 };

  const refused = await place({ customerId: 'ghost', frameId: 'f4' });
  out.refused = { status: refused.status, stock: (await stock()).f4 };
  const tooBig = await place({ customerId: 'c1', frameId: 'f4', deposit: 99999999 });
  out.tooBig = { status: tooBig.status, stock: (await stock()).f4 };

  await place({ customerId: 'c1', accessoryId: 'a1' });
  out.noFrame = { frames: await stock(), accessory: (await p.accessory.findFirst({ where: { id: 'a1' } })).stock };
  // cancelling gives the frame back; leaving "cancelled" takes it again; asking for the same status twice moves nothing
  const D = L.localOrderDetailsService;
  const o4 = (await place({ customerId: 'c1', frameId: 'f4' })).order.id;
  const s4 = async () => (await stock()).f4;
  const cancel = { placed: await s4() };
  await D.setStatus(o4, 'cancelled');
  cancel.cancelled = await s4();
  cancel.unsent = (await p.frame.findFirst({ where: { id: 'f4' } })).synced === false;
  await D.setStatus(o4, 'cancelled');
  cancel.twice = await s4();
  await D.setStatus(o4, 'confirmed');
  cancel.reopened = await s4();
  await D.setStatus(o4, 'ready');
  cancel.moved = await s4(); // confirmed -> ready: not a cancellation
  await D.setStatus(o4, 'cancelled');
  await D.setStatus(o4, 'delivered');
  cancel.again = await s4();
  // a sold-out frame: cancelling gives it back, reopening takes it out again but never below 0
  const o3 = (await place({ customerId: 'c1', frameId: 'f3' })).order.id; // f3 was 0, still 0
  await D.setStatus(o3, 'cancelled');
  cancel.soldOutCancel = (await stock()).f3;
  await D.setStatus(o3, 'confirmed');
  cancel.soldOutReopen = (await stock()).f3;
  // an order with no frame: nothing moves
  const oa = (await place({ customerId: 'c1', accessoryId: 'a1' })).order.id;
  const before = JSON.stringify(await stock());
  await D.setStatus(oa, 'cancelled');
  cancel.noFrame = JSON.stringify(await stock()) === before;
  out.cancel = cancel;
  // the last frame is sold: the oldest waiting line becomes its stock and cost
  const fr = async (id) => { const x = await p.frame.findFirst({ where: { id } }); return [x.stock, x.costPrice, x.synced]; };
  const it = async (id) => { const x = await p.supplierOrderItem.findFirst({ where: { id } }); return [x.used, x.synced]; };
  const wait1 = {};
  await place({ customerId: 'c1', frameId: 'f5' });
  wait1.f5 = await fr('f5'); wait1.i5 = await it('i5');
  await place({ customerId: 'c1', frameId: 'f6' });
  wait1.f6 = await fr('f6'); wait1.i6 = await it('i6'); // still has stock: the waiting line stays waiting
  await place({ customerId: 'c1', frameId: 'f7' });
  wait1.f7 = await fr('f7'); wait1.i7a = await it('i7a'); wait1.i7b = await it('i7b'); // the OLDER line first
  await place({ customerId: 'c1', frameId: 'f8' });
  wait1.f8 = await fr('f8'); wait1.i8 = await it('i8'); // a line of a cancelled order is not applied
  // the second batch of f7 comes in when the first is sold out
  for (let i = 0; i < 12; i++) await place({ customerId: 'c1', frameId: 'f7' });
  wait1.f7after = await fr('f7'); wait1.i7bAfter = await it('i7b');
  out.wait = wait1;

  // ANY route to 0 applies the waiting line: the frame's own update (the form), a plain database update, and reopening a cancelled order
  const any = {};
  await wait('i9', 'so1', 'f9', 7, 700000, '2026-01-01T10:00:00Z');
  await wait('i10', 'so1', 'f10', 8, 750000, '2026-01-01T10:00:00Z');
  await wait('i12', 'so1', 'f12', 3, 300000, '2026-01-01T10:00:00Z');
  await L.localFrameService.update('f9', { stock: 0 });
  any.f9 = await fr('f9'); any.i9 = await it('i9');
  await p.frame.update({ where: { id: 'f10' }, data: { stock: 0 } });
  any.f10 = await fr('f10'); any.i10 = await it('i10');
  any.f12 = await fr('f12'); any.i12 = await it('i12'); // already at 0: nothing changed by itself
  await p.frame.update({ where: { id: 'f12' }, data: { stock: 0 } });
  any.f12again = await fr('f12'); // 0 -> 0 is not "becoming 0"
  const o11 = (await place({ customerId: 'c1', frameId: 'f11' })).order.id; // 1 -> 0, no line waiting yet
  await D.setStatus(o11, 'cancelled'); // back to 1
  await wait('i11', 'so1', 'f11', 5, 550000, '2026-01-01T10:00:00Z');
  await D.setStatus(o11, 'confirmed'); // taken out again: 1 -> 0
  any.f11 = await fr('f11'); any.i11 = await it('i11');
  out.any = any;
  // accessories: the same rules
  const ac = async (id) => { const x = await p.accessory.findFirst({ where: { id } }); return [x.stock, x.costPrice, x.synced]; };
  const acc = {};
  const oa2 = (await place({ customerId: 'c1', accessoryId: 'a2' })).order.id; // the last one: the waiting line comes in
  acc.a2 = await ac('a2'); acc.ia2 = (await p.supplierOrderItem.findFirst({ where: { id: 'ia2' } })).used;
  await D.setStatus(oa2, 'cancelled'); // gives a piece back
  acc.a2cancel = (await ac('a2'))[0];
  await D.setStatus(oa2, 'confirmed'); // takes it out again
  acc.a2reopen = (await ac('a2'))[0];
  const oa3 = (await place({ customerId: 'c1', accessoryId: 'a3' })).order.id;
  acc.a3 = await ac('a3');
  await D.setStatus(oa3, 'cancelled');
  acc.a3cancel = (await ac('a3'))[0];
  out.acc = acc;
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("the stock goes down with the order");
R.ck(JSON.stringify(r.start) === JSON.stringify({ f1: 3, f10: 4, f11: 1, f12: 0, f2: 1, f3: 0, f4: 5, f5: 1, f6: 3, f7: 1, f8: 1, f9: 4 }), "the frames start with their stock", JSON.stringify(r.start));
R.ck(r.afterOne?.f1 === 2 && r.afterOne?.f2 === 1 && r.afterOne?.f4 === 5, "an order with a frame takes one off that frame only (3 -> 2)", JSON.stringify(r.afterOne));
R.ck(r.unsent === true, "the frame is marked unsent, so its new stock is sent to the server");
R.ck(r.lastOne === 0, "the last one in stock goes to 0 (an order with a lens too)", String(r.lastOne));

R.section("never below 0, and nothing for a refused order");
R.ck(r.below?.status === "placed" && r.below?.stock === 0, "a frame at 0 can still be sold (the count may be wrong) and stays at 0", JSON.stringify(r.below));
R.ck(r.soldOut?.status === "placed" && r.soldOut?.stock === 0, "same for a frame that was at 0 from the start", JSON.stringify(r.soldOut));
R.ck(r.refused?.status === "invalid" && r.refused?.stock === 5, "an order that is refused (unknown customer) changes no stock", JSON.stringify(r.refused));
R.ck(r.tooBig?.status === "invalid" && r.tooBig?.stock === 5, "nor one with a deposit that is too big", JSON.stringify(r.tooBig));
R.ck(JSON.stringify(r.noFrame?.frames) === JSON.stringify({ f1: 2, f10: 4, f11: 1, f12: 0, f2: 0, f3: 0, f4: 5, f5: 1, f6: 3, f7: 1, f8: 1, f9: 4 }) && r.noFrame?.accessory === 8, "an order with no frame changes no frame's stock (the accessory's stock is not touched either)", JSON.stringify(r.noFrame));

R.section("cancelling an order gives the frame back");
R.ck(r.cancel?.placed === 4 && r.cancel?.cancelled === 5, "an order for a frame at 5 leaves 4; cancelling it puts it back to 5", JSON.stringify(r.cancel));
R.ck(r.cancel?.unsent === true, "the frame is marked unsent, so the stock reaches the server");
R.ck(r.cancel?.twice === 5, "asking for 'cancelled' again moves nothing");
R.ck(r.cancel?.reopened === 4 && r.cancel?.moved === 4, "taking the order out of 'cancelled' takes the frame out again; other changes of status move nothing");
R.ck(r.cancel?.again === 4, "cancelled and then delivered: the frame is out of the stock once");
R.ck(r.cancel?.soldOutCancel === 1 && r.cancel?.soldOutReopen === 0, "a frame that was at 0 gets 1 back on cancel and goes back to 0 (never below)", JSON.stringify([r.cancel?.soldOutCancel, r.cancel?.soldOutReopen]));
R.ck(r.cancel?.noFrame === true, "cancelling an order with no frame changes no stock");

R.section("the last frame is sold: the waiting supplier line is applied");
const w = r.wait ?? {};
R.ck(w.f5?.[0] === 6 && w.f5?.[1] === 8000 && w.i5?.[0] === true && w.i5?.[1] === false, "a frame at 1 is sold: its stock becomes the waiting line's 6, its cost 8 000, and the line is marked used (and unsent)", JSON.stringify([w.f5, w.i5]));
R.ck(w.f5?.[2] === false, "the frame is marked unsent so the server gets the new stock and cost");
R.ck(w.f6?.[0] === 2 && w.f6?.[1] === null && w.i6?.[0] === false, "a frame that still has stock after the sale (3 -> 2) leaves the waiting line waiting", JSON.stringify([w.f6, w.i6]));
R.ck(w.f7?.[0] === 12 && w.f7?.[1] === 6000 && w.i7a?.[0] === true && w.i7b?.[0] === false, "with two lines waiting the OLDER one is applied first (12 at 6 000), the newer waits", JSON.stringify([w.f7, w.i7a, w.i7b]));
R.ck(w.f7after?.[0] === 20 && w.f7after?.[1] === 6500 && w.i7bAfter?.[0] === true, "when that batch is sold out the next one comes in (20 at 6 500)", JSON.stringify([w.f7after, w.i7bAfter]));
R.ck(w.f8?.[0] === 0 && w.i8?.[0] === false, "a line of a cancelled supplier order is not applied (the frame goes to 0)", JSON.stringify([w.f8, w.i8]));

R.section("any route to 0 applies the waiting line");
const a = r.any ?? {};
R.ck(a.f9?.[0] === 7 && a.f9?.[1] === 7000 && a.i9?.[0] === true, "the stock typed as 0 in the frame's own update: the waiting line (7 at 7 000) comes in", JSON.stringify([a.f9, a.i9]));
R.ck(a.f10?.[0] === 8 && a.f10?.[1] === 7500 && a.i10?.[0] === true, "a plain database update to 0 does the same (8 at 7 500)", JSON.stringify([a.f10, a.i10]));
R.ck(a.f12?.[0] === 0 && a.i12?.[0] === false && a.f12again?.[0] === 0, "a frame already at 0 is not 'becoming' 0: its waiting line is not applied by an update that leaves it at 0", JSON.stringify([a.f12, a.i12, a.f12again]));
R.ck(a.f11?.[0] === 5 && a.f11?.[1] === 5500 && a.i11?.[0] === true, "reopening a cancelled order takes the frame to 0 and the waiting line comes in (5 at 5 500)", JSON.stringify([a.f11, a.i11]));
R.ck(a.f9?.[2] === false && a.i9?.[1] === false, "the frame and the line are marked unsent, so the server gets them");

R.section("accessories follow the same rules");
const q = r.acc ?? {};
R.ck(q.a3?.[0] === 1 && q.a3?.[2] === false, "an order with an accessory takes one off its stock (2 -> 1) and marks it unsent", JSON.stringify(q.a3));
R.ck(q.a3cancel === 2, "cancelling that order gives the piece back (1 -> 2)", String(q.a3cancel));
R.ck(q.a2?.[0] === 5 && q.a2?.[1] === 400 && q.ia2 === true, "selling the last accessory brings in its waiting line (5 at 400), which is marked used", JSON.stringify([q.a2, q.ia2]));
R.ck(q.a2cancel === 6 && q.a2reopen === 5, "cancelling then reopening moves the stock by one each way (5 -> 6 -> 5)", JSON.stringify([q.a2cancel, q.a2reopen]));

process.exit(R.done());
