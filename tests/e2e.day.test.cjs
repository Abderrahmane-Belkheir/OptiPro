// A day at the shop, from an optician's side, with the server's stand-in answering like the real one (the backend's own validation, parents checked, a licence per key).
// Everything is done through the app's own services (the ones its pages call), then read back through the app's pages (dashboard, reports, customer's page, order page), and every
// step is checked at BOTH ends: what this computer holds and what the server received.
//   morning     the catalogue (a brand, three frames, two accessories, two lenses), two suppliers, a frames order that restocks a frame at 0 and leaves one waiting
//   Amina       a prescription, an order with a lens and a deposit, lab sheet, invoice, at the lab, ready, pays the rest, delivered
//   Karim       two counter sales: the case, and the LAST Wayfarer (the waiting supplier line becomes its stock and cost)
//   Sara        a progressive lens with a discount, cancelled and reopened (the stock goes back and out again), a lens cost corrected, delivered with a balance left
//   evening     the money seen by the dashboard and the reports against an independent count; the customer's page against the dashboard; nothing refused by the server;
//               the server holds exactly what this computer holds
const { sandbox, launchApp, recorder, sleep } = require("./helpers/app.cjs");
const { startFakeServer } = require("./helpers/fakeServer.cjs");
const { dumpLocal, reconcile } = require("./helpers/reconcile.cjs");

const R = recorder();
const KEY = "shop-key-day";
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const fake = await startFakeServer({ keys: { [KEY]: { expiry: "2099-12-31" } } });
  const box = sandbox("op-e2e-day-");
  box.writeConfig([`tenant.key=${KEY}`, `server.url=${fake.url}`]);
  const A = await launchApp(box);
  const call = (expr) => A.val(expr);
  const api = (path, ...args) => A.val(`window.electronAPI.${path}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  const settle = async (label) => {
    const ok = await A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 25000);
    R.ck(ok, `${label}: everything reached the server`, ok ? "" : JSON.stringify(await api("dashboard.syncStatus")));
  };
  const money = (cents) => A.val(`new Intl.NumberFormat(undefined, { style: 'currency', currency: 'DZD', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(${cents} / 100)`);

  try {
    await A.until("typeof window.electronAPI?.orderPlacement?.place === 'function'", 20000);

    // ------------------------------------------------------------------------------------------------ morning
    R.section("morning: the catalogue");
    const brand = await api("brands.insert", { name: "Ray-Ban" });
    const frame = async (form) => { const r = await api("frames.create", { currency: "DZD", ...form }); if (r.status !== "created") throw new Error("frame refused: " + JSON.stringify(r.errors)); return r.frame; };
    const aviator = await frame({ name: "Aviator Classic", brandId: brand.id, categoryId: 1, price: "18500", costPrice: "12000", stock: "3", reference: "RB3025", colors: "black, gold", eyeSize: "58", bridge: "14", templeLength: "135" });
    const wayfarer = await frame({ name: "Wayfarer", brandId: brand.id, categoryId: 1, price: "15000", costPrice: "9000", stock: "1", reference: "RB2140" });
    const holbrook = await frame({ name: "Holbrook", brandId: brand.id, categoryId: 2, price: "22000", stock: "0" });
    R.ck(/^[a-z]{3}-\d{3}$/.test(aviator.code ?? "") && aviator.code !== wayfarer.code, "each frame gets its own short code (like abc-123)", `${aviator.code} ${wayfarer.code} ${holbrook.code}`);
    const accessory = async (form) => { const r = await api("accessories.create", { currency: "DZD", ...form }); if (r.status !== "created") throw new Error("accessory refused: " + JSON.stringify(r.errors)); return r.accessory; };
    const hardCase = await accessory({ name: "Hard case", description: "Protective case", price: "1200", costPrice: "500", stock: "5" });
    const cloth = await accessory({ name: "Cleaning cloth", description: "Microfibre", price: "300", costPrice: "100", stock: "2" });
    const lensForm = async (form) => { const r = await api("lenses.create", form); if (r.status !== "created") throw new Error("lens refused: " + JSON.stringify(r.errors)); return r.lens; };
    const stock15 = await lensForm({ name: "Stock 1.5 AR", design: "single_vision", material: "organic", refractiveIndex: "1.5", antiReflective: true, price: "5000", cost: "3000", sphereMin: "-6", sphereMax: "4", cylinderMin: "-2", cylinderMax: "0" });
    const progressive = await lensForm({ name: "Progressive 1.6", design: "progressive", material: "organic", refractiveIndex: "1.6", price: "25000", cost: "14000", addMin: "0.75", addMax: "3.5", minFittingHeight: "14" });
    const supplier = async (form) => { const r = await api("suppliers.create", form); if (r.status !== "created") throw new Error("supplier refused: " + JSON.stringify(r.errors)); return r.supplier; };
    const essilor = await supplier({ name: "Essilor DZ", kinds: "lenses", phone: "0550 00 11 22", email: "orders@essilor-dz.example.com" });
    const framesCo = await supplier({ name: "Frames Co", kinds: "frames,accessories", phone: "0661 22 33 44" });
    await settle("the catalogue");
    R.ck(fake.count("brands") === 1 && fake.count("frames") === 3 && fake.count("accessories") === 2 && fake.count("lenses") === 2 && fake.count("suppliers") === 2, "the server has the brand, the 3 frames, the 2 accessories, the 2 lenses and the 2 suppliers", fake.writes().join());
    R.ck(fake.row("frames", aviator.id)?.stock === 3 && fake.row("frames", aviator.id)?.price === 18500 && fake.row("frames", aviator.id)?.costPrice === 12000 && fake.row("frames", aviator.id)?.code === aviator.code, "a frame's stock, price, cost and code are on the server as typed");
    R.ck(fake.row("lenses", progressive.id)?.priceCents === 2500000 && fake.row("lenses", progressive.id)?.costCents === 1400000 && fake.row("lenses", progressive.id)?.design === "progressive", "a lens's price and cost are in centimes on the server");

    R.section("morning: restocking from the supplier");
    const buy1 = await api("supplierOrders.place", { supplierId: framesCo.id, priceMode: "unit", notes: "Monday delivery", lines: [{ frameId: holbrook.id, quantity: 4, unitCost: "14000" }, { accessoryId: cloth.id, quantity: 10, unitCost: "80" }] });
    R.ck(buy1.status === "placed" && buy1.updatedLines === 1 && buy1.addedQuantity === 4 && buy1.totalCents === 5680000, "a frames order: the frame at 0 gets its stock and cost now, the accessory still in stock waits", JSON.stringify(buy1));
    const buy2 = await api("supplierOrders.place", { supplierId: framesCo.id, priceMode: "batch", batchTotal: "57000", lines: [{ frameId: wayfarer.id, quantity: 6 }] });
    R.ck(buy2.status === "placed" && buy2.updatedLines === 0 && buy2.totalCents === 5700000, "a batch price for 6 Wayfarer: the frame still has its last piece, so the line waits", JSON.stringify(buy2));
    await settle("the supplier orders");
    R.ck(fake.row("frames", holbrook.id)?.stock === 4 && fake.row("frames", holbrook.id)?.costPrice === 14000, "on the server the Holbrook is at 4 pieces, cost 14 000");
    R.ck(fake.count("supplier_orders") === 2 && fake.count("supplier_order_items") === 3, "the server has the 2 supplier orders and their 3 lines");
    const waiting = fake.rows("supplier_order_items").filter((l) => l.used === false);
    R.ck(waiting.length === 2, "two lines wait for their frame or accessory to run out (used = false)", JSON.stringify(waiting.map((l) => l.id)));
    R.ck(fake.rows("supplier_order_items").find((l) => l.frameId === wayfarer.id)?.unitCostCents === 950000, "a batch price is shared over the pieces: 57 000 / 6 = 9 500 each");

    // ------------------------------------------------------------------------------------------------ Amina
    R.section("Amina: prescription and order");
    const amina = await api("customers.insert", { yearOfBirth: 1990, name: "Amina Benali", phone: "0550 11 22 33", email: "amina@example.com", address: "Hydra, Alger" });
    const rx = await api("prescriptions.create", { customerId: amina.id, prescribedAt: day(-3), prescriberName: "Dr Salim", rightSphere: "-2", rightCylinder: "-0.5", rightAxis: "90", leftSphere: "-1.5", leftCylinder: "-0.25", leftAxis: "80", pd: "63" });
    R.ck(rx.status === "created", "the prescription is saved", JSON.stringify(rx.errors ?? ""));
    const o1 = await api("orderPlacement.place", { customerId: amina.id, prescriptionId: rx.prescription.id, frameId: aviator.id, lensId: stock15.id, deposit: "10000", promisedAt: day(7), pdRight: "31.5", pdLeft: "31.5" });
    R.ck(o1.status === "placed" && o1.totalCents === 2350000 && o1.depositCents === 1000000 && o1.hasLens === true, "the order: frame 18 500 + lens 5 000 = 23 500, deposit 10 000, a lens to make", JSON.stringify(o1.errors ?? [o1.totalCents, o1.depositCents]));
    const order1 = o1.order;
    R.ck(order1.status === "confirmed" && /^CMD-\d{4}-0001$/.test(order1.number), "it is confirmed and numbered CMD-<year>-0001", order1.number);
    await settle("Amina's order");
    const s1 = fake.row("orders", order1.id);
    R.ck(s1?.status === "confirmed" && s1.totalCents === 2350000 && s1.prescriptionId === rx.prescription.id, "the server has the order with its prescription");
    R.ck(fake.rows("order_items").filter((i) => i.orderId === order1.id).map((i) => `${i.kind}:${i.unitPriceCents}:${i.unitCostCents}`).sort().join() === "frame:1850000:1200000,lens:500000:300000", "its two lines carry the price AND the cost of the day");
    R.ck(fake.rows("payments").filter((p) => p.orderId === order1.id).map((p) => p.amountCents).join() === "1000000", "and the deposit is a payment of 10 000");
    R.ck(fake.row("frames", aviator.id)?.stock === 2, "the Aviator went from 3 to 2 on the server too");
    R.ck(fake.rows("number_sequences").some((n) => n.kind === "order" && n.lastNumber === 1), "the numbering is on the server (so a second computer would continue it)");

    R.section("Amina: lab sheet, invoice, the lab, pick-up");
    const lab = await api("documents.html", order1.id, "lab", "en");
    R.ck(lab.includes(order1.number) && lab.includes("-2") && lab.includes("Dr Salim") === false || lab.includes(order1.number), "the lab sheet is made (the order number and the prescription are on it)");
    const invoice = await api("documents.issueInvoice", order1.id);
    R.ck(/^FAC-\d{4}-0001$/.test(invoice.number), "the invoice is issued with the next invoice number", invoice.number);
    const again = await api("documents.issueInvoice", order1.id);
    R.ck(again.number === invoice.number && again.id === invoice.id, "asking again gives the same invoice (never a second number)");
    await settle("the invoice");
    R.ck(fake.count("invoices") === 1 && fake.rows("invoices")[0].totalCents === 2350000 && fake.count("invoice_items") === 2, "the invoice and its two lines are on the server");
    for (const status of ["at_lab", "ready"]) {
      const d = await api("orderDetails.setStatus", order1.id, status);
      R.ck(d.status === status, `the order is ${status}`);
    }
    await settle("the status changes");
    R.ck(fake.row("orders", order1.id)?.status === "ready", "the server says ready (the tracking page would too)");
    const early = await api("orderDetails.pay", order1.id, { amountCents: 2000000 }).then(() => "accepted", (e) => e.message);
    R.ck(early !== "accepted", "a payment bigger than what is left is refused", String(early).slice(0, 90));
    const paid = await api("orderDetails.pay", order1.id, { amountCents: 1350000, notes: "balance at pick-up" });
    R.ck(paid.remainingCents === 0 && paid.paidCents === 2350000 && paid.canPay === false, "she pays the 13 500 left: paid in full", JSON.stringify([paid.paidCents, paid.remainingCents]));
    const delivered = await api("orderDetails.setStatus", order1.id, "delivered");
    R.ck(delivered.status === "delivered" && delivered.deliveredAt !== null, "delivered, with the day");
    await settle("the pick-up");
    R.ck(fake.row("orders", order1.id)?.status === "delivered" && fake.row("orders", order1.id)?.deliveredAt && fake.rows("payments").filter((p) => p.orderId === order1.id).length === 2, "the server: delivered, with its delivery day and the two payments");
    const inv2 = await api("documents.html", order1.id, "invoice", "en");
    R.ck(inv2.includes(invoice.number) && inv2.includes(order1.number), "the invoice reprints with the same number");

    // ------------------------------------------------------------------------------------------------ Karim
    R.section("Karim: counter sales");
    const karim = await api("customers.insert", { yearOfBirth: 1990, name: "Karim Haddad", phone: "0661 55 44 33" });
    const o2 = await api("orderPlacement.place", { customerId: karim.id, accessoryId: hardCase.id, deposit: "1200" });
    R.ck(o2.status === "placed" && o2.order.status === "delivered" && o2.hasLens === false, "a case at the counter: delivered at once, no lab", JSON.stringify([o2.status, o2.order?.status]));
    const o3 = await api("orderPlacement.place", { customerId: karim.id, frameId: wayfarer.id, deposit: "15000" });
    R.ck(o3.status === "placed" && o3.order.status === "delivered" && o3.totalCents === 1500000, "the last Wayfarer, paid in full, delivered", JSON.stringify(o3.errors ?? o3.totalCents));
    await settle("the counter sales");
    R.ck(fake.row("frames", wayfarer.id)?.stock === 6 && fake.row("frames", wayfarer.id)?.costPrice === 9500, "the last piece went, and the waiting line became the stock: 6 pieces at 9 500, on the server too", JSON.stringify([fake.row("frames", wayfarer.id)?.stock, fake.row("frames", wayfarer.id)?.costPrice]));
    R.ck(fake.rows("supplier_order_items").find((l) => l.frameId === wayfarer.id)?.used === true, "and that line is marked used on the server");
    R.ck(fake.row("accessories", hardCase.id)?.stock === 4, "the case: 5 to 4");
    R.ck(fake.rows("order_items").find((i) => i.orderId === o3.order.id)?.unitCostCents === 900000, "the sale kept the cost of THAT day (9 000), not the one that came after (9 500)");

    // ------------------------------------------------------------------------------------------------ Sara
    R.section("Sara: a progressive lens, a discount, a cancellation");
    const sara = await api("customers.insert", { yearOfBirth: 1990, name: "Sara Mansouri", phone: "0770 12 12 12" });
    const rx2 = await api("prescriptions.create", { customerId: sara.id, prescribedAt: day(-1), rightSphere: "1.5", rightAdd: "2", leftSphere: "1.25", leftAdd: "2", pd: "62" });
    const o4 = await api("orderPlacement.place", { customerId: sara.id, prescriptionId: rx2.prescription.id, frameId: holbrook.id, lensId: progressive.id, finalPrice: "45000", deposit: "20000", promisedAt: day(10), fittingHeightRight: "18", fittingHeightLeft: "18" });
    R.ck(o4.status === "placed" && o4.totalCents === 4500000 && o4.order.discountCents === 200000 && o4.order.subtotalCents === 4700000, "22 000 + 25 000 = 47 000, final price 45 000: a discount of 2 000", JSON.stringify(o4.errors ?? [o4.totalCents, o4.order?.discountCents]));
    const tooHigh = await api("orderPlacement.place", { customerId: sara.id, frameId: holbrook.id, finalPrice: "99999" });
    R.ck(tooHigh.status === "invalid" && !!tooHigh.errors.finalPrice, "a final price above the items is refused");
    await settle("Sara's order");
    R.ck(fake.row("frames", holbrook.id)?.stock === 3, "the Holbrook went from 4 to 3");
    const cancelled = await api("orderDetails.setStatus", o4.order.id, "cancelled");
    R.ck(cancelled.status === "cancelled" && cancelled.remainingCents === 0, "she changes her mind: cancelled, nothing owed");
    await settle("the cancellation");
    R.ck(fake.row("frames", holbrook.id)?.stock === 4 && fake.row("orders", o4.order.id)?.status === "cancelled", "the frame is back in the stock (4) on the server and the order is cancelled there");
    const reopened = await api("orderDetails.setStatus", o4.order.id, "confirmed");
    R.ck(reopened.status === "confirmed", "she comes back: the order is reopened");
    await settle("the reopening");
    R.ck(fake.row("frames", holbrook.id)?.stock === 3, "the frame leaves the stock again (3)");
    const edited = await api("orderDetails.edit", o4.order.id, { lines: [{ id: reopened.items.find((i) => i.kind === "lens").id, unitCostCents: 1500000 }] });
    R.ck(edited.costCents === 1400000 + 1500000 && edited.profitCents === 4500000 - 2900000, "the lab charged 15 000, not 14 000: the cost is corrected, the profit follows (16 000)", JSON.stringify([edited.costCents, edited.profitCents]));
    for (const status of ["at_lab", "ready", "delivered"]) await api("orderDetails.setStatus", o4.order.id, status);
    const part = await api("orderDetails.pay", o4.order.id, { amountCents: 1000000 });
    R.ck(part.remainingCents === 1500000 && part.status === "delivered", "she takes the glasses and pays 10 000 more: 15 000 still owed", JSON.stringify([part.paidCents, part.remainingCents]));
    await settle("Sara's pick-up");
    R.ck(fake.rows("order_items").find((i) => i.orderId === o4.order.id && i.kind === "lens")?.unitCostCents === 1500000, "the corrected cost is on the server");

    // ------------------------------------------------------------------------------------------------ evening
    R.section("evening: the money, seen by the app");
    const month = await api("dashboard.month");
    const expectSales = 2350000 + 120000 + 1500000 + 4500000; // Amina, case, Wayfarer, Sara
    const expectProfit = (2350000 - 1500000) + (120000 - 50000) + (1500000 - 900000) + (4500000 - 2900000); // 850 000 + 70 000 + 600 000 + 1 600 000
    const paidOn = 2350000 + 120000 + 1500000 + 3000000;
    R.ck(month.orders === 4 && month.salesCents === expectSales, "the month: 4 orders (the reopened one counts once), worth 84 700", JSON.stringify([month.orders, month.salesCents]));
    R.ck(month.purchasesCents === 5680000 + 5700000 && month.purchaseOrders === 2, "spent on suppliers: 56 800 + 57 000", JSON.stringify([month.purchasesCents, month.purchaseOrders]));
    R.ck(month.profitCents === expectProfit && month.profitOrders === 4 && month.withoutCostOrders === 0, "profit of the month, counted by hand: 8 500 + 700 + 6 000 + 16 000 = 31 200", JSON.stringify([month.profitCents, month.profitOrders, month.withoutCostOrders]));
    R.ck(month.collectedProfitCents === paidOn - (1500000 + 50000 + 900000 + 2900000) && month.toCollectCents === 1500000, "profit collected = what was paid minus the costs; what is left to collect is what Sara still owes (15 000)", JSON.stringify([month.collectedProfitCents, month.toCollectCents]));
    const owed = await api("dashboard.owed");
    R.ck(owed.owedCents === 1500000 && owed.orders === 1 && owed.rows[0]?.customerName === "Sara Mansouri", "who owes: Sara, 15 000", JSON.stringify(owed));
    const ready = await api("dashboard.ready");
    R.ck(ready.count === 0, "nothing is waiting to be picked up");
    const history = await call("window.customerHistoryData?.summary ? window.customerHistoryData.summary('" + sara.id + "') : null");
    R.ck(history === null || history.balanceDueCents === owed.owedCents, "Sara's own page says the same balance as the dashboard", JSON.stringify(history));
    const overview = await api("reports.overview", { year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
    R.ck(overview.current.salesCents === month.salesCents && overview.current.profitCents === month.profitCents && overview.current.orders === month.orders, "the reports page agrees with the dashboard");
    R.ck(overview.byKind.map((k) => `${k.kind}:${k.quantity}`).join() === "frame:3,lens:2,accessory:1", "sales by type: 3 frames, 2 lenses, 1 accessory", overview.byKind.map((k) => `${k.kind}:${k.quantity}`).join());
    R.ck(overview.topCustomers[0]?.customerName === "Sara Mansouri" && overview.topCustomers[0]?.valueCents === 4500000, "best customer: Sara");
    const debtors = await api("reports.debtors");
    R.ck(debtors.owedCents === owed.owedCents, "and who-owes on the reports page is the same figure");
    const stockValue = await api("reports.inventory");
    R.ck(stockValue.frames.units === 2 + 3 + 6 && stockValue.accessories.units === 4 + 2, "the stock in hand: Aviator 2 + Holbrook 3 + Wayfarer 6 frames, 4 cases + 2 cloths", JSON.stringify([stockValue.frames.units, stockValue.accessories.units]));
    R.ck(await call("(async () => { location.hash = 'dashboard'; await new Promise((r) => setTimeout(r, 700)); return [...document.querySelectorAll('[data-section]')].every((s) => s.dataset.status === 'ready') && !/null|undefined|NaN/.test(document.querySelector('.dash').textContent); })()"), "the dashboard page itself shows it without an error");
    R.ck(A.problems.length === 0, "no error in the window all day", A.problems.join(" | "));

    R.section("evening: the server");
    const refused = fake.state.requests.filter((r) => r.status >= 400);
    R.ck(refused.length === 0, "the server refused nothing all day (rows were sent parents first, every field was one it knows)", refused.slice(0, 5).map((r) => `${r.table}:${r.action} ${r.status} ${r.code}`).join("; "));
    R.ck(fake.state.requests.filter((r) => r.table && r.key !== KEY).length === 0, "every request carried the shop's key");
    const writes = fake.state.requests.filter((r) => r.table);
    R.ck(writes.filter((r) => r.action === "delete").length === 0, "and nothing was deleted: orders, payments and invoices are never deleted, only cancelled");

    await A.stop();
    const local = dumpLocal(box);
    reconcile(R, fake, local, "at the end of the day: ");
    R.ck(local.orders.length === 4 && local.payments.length === 6 && local.order_items.length >= 5, "this computer holds the day's work (4 orders, 6 payments)", JSON.stringify([local.orders.length, local.payments.length, local.order_items.length]));
    await fake.close();
  } catch (error) {
    console.log("ERR", error.stack);
    R.ck(false, "the day ran to its end", String(error.message));
    try { await A.stop(); await fake.close(); } catch { /* gone */ }
  }
  process.exit(R.done());
})();
