// A bad day for the connection. The shop keeps working while the server is down, slow or failing: every action works here, comes back quickly, and is kept; nothing is lost or
// sent twice; and when the server is back (the next start of the app, or the next sync pass) the whole backlog goes up, parents first, deletions included, numbering intact.
//   1. a normal start, a little data on the server
//   2. the server is DOWN: customer, prescription, orders with lens and deposit, payment, status changes, a frame edit, a new frame, a deletion, the shop's details; the app stays quick
//   3. the server SLOW: a save comes back after the short wait, the push goes on in the background
//   4. the server FAILS (500) and a CAPTIVE PORTAL answers 401 without the server's code: nothing is lost, the licence is NOT taken away
//   5. the server is back: the next start sends everything; the server then holds exactly what this computer holds; a second start sends nothing and changes nothing
const fs = require("node:fs");
const { sandbox, launchApp, recorder, sleep } = require("./helpers/app.cjs");
const { startFakeServer } = require("./helpers/fakeServer.cjs");
const { dumpLocal, reconcile } = require("./helpers/reconcile.cjs");

const R = recorder();
const KEY = "shop-key-offline";
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

(async () => {
  const fake = await startFakeServer({ keys: { [KEY]: { expiry: "2099-12-31" } } });
  const box = sandbox("op-e2e-off-");
  box.writeConfig([`tenant.key=${KEY}`, `server.url=${fake.url}`]);
  let A = await launchApp(box);
  const api = (path, ...args) => A.val(`window.electronAPI.${path}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
  const timed = async (fn) => { const t = Date.now(); const value = await fn(); return { value, ms: Date.now() - t }; };
  const unsynced = async () => (await api("dashboard.syncStatus")).unsyncedCount;
  const settle = (label, ms = 25000) => A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", ms).then((ok) => R.ck(ok, `${label}: nothing is left waiting`));

  try {
    await A.until("typeof window.electronAPI?.orderPlacement?.place === 'function'", 20000);

    // ------------------------------------------------------------------------------------------------ 1
    R.section("a normal start");
    const brand = await api("brands.insert", { name: "Ray-Ban" });
    const frame = (await api("frames.create", { currency: "DZD", name: "Aviator", brandId: brand.id, categoryId: 1, price: "18500", costPrice: "12000", stock: "10" })).frame;
    const spare = (await api("frames.create", { currency: "DZD", name: "Spare frame", brandId: brand.id, categoryId: 1, price: "9000", stock: "1" })).frame;
    const lens = (await api("lenses.create", { name: "Stock 1.5", design: "single_vision", material: "organic", price: "5000", cost: "3000" })).lens;
    const first = await api("customers.insert", { yearOfBirth: 1990, name: "Early customer", phone: "0550 00 00 01" });
    await sleep(1500);
    await A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 15000);
    R.ck(fake.count("frames") === 2 && fake.count("customers") === 1 && fake.count("lenses") === 1, "the morning's data is on the server", fake.writes().join());
    R.ck((await api("dashboard.syncStatus")).reachable === true, "the app says the server is reachable");

    // ------------------------------------------------------------------------------------------------ 2
    R.section("the server is down");
    fake.setMode("down");
    fake.clearRequests();
    const nadia = await timed(() => api("customers.insert", { yearOfBirth: 1990, name: "Nadia Cherif", phone: "0770 10 20 30" }));
    R.ck(nadia.value.id && nadia.ms < 6000, "a customer is saved at once, with no connection", `${nadia.ms} ms`);
    const rx = await api("prescriptions.create", { customerId: nadia.value.id, prescribedAt: day(-2), rightSphere: "-1", leftSphere: "-1.25", pd: "62" });
    R.ck(rx.status === "created" && rx.sentToServer === false, "her prescription is saved here, not yet sent", JSON.stringify([rx.status, rx.sentToServer]));
    const o1 = await timed(() => api("orderPlacement.place", { customerId: nadia.value.id, prescriptionId: rx.prescription.id, frameId: frame.id, lensId: lens.id, deposit: "8000", promisedAt: day(5) }));
    R.ck(o1.value.status === "placed" && o1.value.sentToServer === false && o1.ms < 6000, "an order with a lens and a deposit is placed (numbered) and kept", `${o1.value.order?.number} ${o1.ms} ms`);
    const o2 = await api("orderPlacement.place", { customerId: first.id, frameId: spare.id, deposit: "9000" });
    R.ck(o2.status === "placed" && o2.order.status === "delivered", "a counter sale is placed too (the last spare frame)");
    R.ck(/0002$/.test(o2.order.number) && /0001$/.test(o1.value.order.number), "the numbers follow one another with no connection: 0001, 0002", `${o1.value.order.number} ${o2.order.number}`);
    await api("orderDetails.setStatus", o1.value.order.id, "at_lab");
    await api("orderDetails.setStatus", o1.value.order.id, "ready");
    const pay = await api("orderDetails.pay", o1.value.order.id, { amountCents: 1000000, notes: "second payment" });
    R.ck(pay.paidCents === 1800000 && pay.remainingCents === 550000, "a payment is taken: 8 000 + 10 000 paid, 5 500 left", JSON.stringify([pay.paidCents, pay.remainingCents]));
    const edit = await api("frames.edit", frame.id, { currency: "DZD", name: "Aviator", brandId: brand.id, categoryId: 1, price: "19500", costPrice: "12500", stock: "9" });
    R.ck(edit.status === "updated" && edit.sentToServer === false, "a frame's price is changed here, not yet sent", JSON.stringify([edit.status, edit.sentToServer]));
    const added = (await api("frames.create", { currency: "DZD", name: "New in town", brandId: brand.id, categoryId: 3, price: "12000", stock: "4" })).frame;
    const supplier = await api("suppliers.create", { name: "Offline supplier", kinds: "frames" });
    const refused = await api("frames.delete", spare.id).then((r) => "deleted", (e) => e.message);
    R.ck(refused !== "deleted", "a frame an order was made with cannot be deleted (the order keeps pointing at it)", String(refused).slice(0, 100));
    const gone = (await api("frames.create", { currency: "DZD", name: "Mistake", brandId: brand.id, categoryId: 1, price: "1000", stock: "1" })).frame;
    // (it never reached the server: deleting it only has to be forgotten)
    const mistake = await api("frames.delete", gone.id);
    R.ck(mistake.status === "deleted", "a frame made by mistake is deleted here", JSON.stringify(mistake).slice(0, 120));
    R.ck((await api("dashboard.syncStatus")).unsyncedCount > 0, "(its deletion waits in the outbox for the server)");
    const shop = await api("shopInfo.save", { phone: "+213 550 99 99 99" });
    R.ck(shop.status === "saved" && shop.sentToServer === false, "the shop's phone is edited in the settings: saved here, not sent", JSON.stringify([shop.status, shop.sentToServer]));
    const status = await api("dashboard.syncStatus");
    R.ck(status.reachable === false && status.unsyncedCount > 8, "the app says the server cannot be reached, and counts what waits", JSON.stringify(status));
    R.ck(fake.count("orders") === 0 && fake.count("customers") === 1, "the server received nothing meanwhile");
    // the pages still work
    R.ck(await A.val("(async () => { location.hash = 'orders'; await new Promise((r) => setTimeout(r, 900)); return document.querySelectorAll('[data-sales] tbody tr').length >= 1; })()"), "the orders page lists the orders made offline");
    const dash = await api("dashboard.month");
    R.ck(dash.orders === 2 && dash.salesCents === 2350000 + 900000, "and the dashboard counts them (2 orders, 23 500 + 9 000)", JSON.stringify([dash.orders, dash.salesCents]));
    const owed = await api("dashboard.owed");
    R.ck(owed.owedCents === 550000, "and what Nadia still owes (5 500)", JSON.stringify(owed.owedCents));
    R.ck(A.problems.length === 0, "no error in the window while offline", A.problems.join(" | "));

    // ------------------------------------------------------------------------------------------------ 3
    R.section("the server is slow");
    fake.setMode("slow", 4000);
    await api("dashboard.syncStatus");
    const slow = await timed(() => api("customers.insert", { yearOfBirth: 1990, name: "Slow server customer" }));
    R.ck(slow.ms < 3500, "a save while the server takes 4 s comes back after the short wait, not after the server", `${slow.ms} ms`);
    fake.setMode("ok");

    // ------------------------------------------------------------------------------------------------ 4
    R.section("the server fails, a portal answers");
    fake.setMode("error");
    const failing = await api("customers.insert", { yearOfBirth: 1990, name: "While the server fails" });
    R.ck(failing.id, "a save while the server answers 500 works");
    fake.setMode("portal");
    const portalSave = await api("customers.insert", { yearOfBirth: 1990, name: "Behind a Wi-Fi portal" });
    R.ck(portalSave.id, "a save behind a captive portal (401 without the server's code) works");
    await sleep(800);
    R.ck(fs.existsSync(box.config) && !fs.existsSync(box.config + ".expired"), "and the licence was NOT taken away: the settings file is where it was");
    R.ck(await A.val("typeof window.electronAPI?.dashboard?.month === 'function'"), "the app is still the app (no expired page)");
    fake.setMode("ok");

    // ------------------------------------------------------------------------------------------------ 5
    R.section("the server is back: the next start");
    const before = { customers: fake.count("customers"), orders: fake.count("orders") };
    await A.stop();
    fake.clearRequests();
    A = await launchApp(box);
    await A.until("typeof window.electronAPI?.dashboard?.syncStatus === 'function'", 20000);
    await settle("after the restart", 40000);
    {
      const status = await api("dashboard.syncStatus");
      if (status.unsyncedCount !== 0) {
        console.log("   (what waits: " + JSON.stringify(status) + ")");
        console.log("   (shop info here: " + JSON.stringify(await api("shopInfo.get")) + ")");
        console.log("   (requests to /api/infos: " + JSON.stringify(fake.state.requests.filter((r) => r.path === "/api/infos").map((r) => r.status)) + ")");
        await A.stop();
        const left = dumpLocal(box);
        console.log("   (unsynced rows: " + Object.entries(left).filter(([t]) => !t.startsWith("_")).flatMap(([t, rows]) => rows.filter((r) => !r.synced).map((r) => t + " " + r.id)).join("; ") + ")");
        console.log("   (deletions waiting: " + JSON.stringify(left._pendingDeletions) + ")");
        A = await launchApp(box);
        await A.until("typeof window.electronAPI?.dashboard?.syncStatus === 'function'", 20000);
      }
    }
    const refusedAfter = fake.state.requests.filter((r) => r.status >= 400);
    R.ck(refusedAfter.length === 0, "the server refused nothing: the backlog went up parents first (customer, prescription, order, lines, payments)", refusedAfter.slice(0, 5).map((r) => `${r.table}:${r.action} ${r.status} ${r.code}`).join("; "));
    R.ck(fake.count("orders") === 2 && fake.count("payments") === 3 && fake.count("customers") === 5, "the server has the 2 orders, the 3 payments (8 000 + 10 000 + 9 000) and the 5 customers", JSON.stringify([fake.count("orders"), fake.count("payments"), fake.count("customers")]));
    R.ck(fake.row("frames", frame.id)?.price === 19500 && fake.row("frames", frame.id)?.stock === 9 && fake.row("frames", frame.id)?.costPrice === 12500, "the frame's new price, cost and stock arrived");
    R.ck(fake.row("frames", added.id) !== null, "the frame added offline arrived");
    R.ck(fake.row("frames", gone.id) === null, "the frame made by mistake and deleted offline never reached the server (and is not there)");
    R.ck(fake.row("orders", o1.value.order.id)?.status === "ready", "Nadia's order arrived with its status");
    R.ck(fake.state.keys.get(KEY).shop?.phone === "+213 550 99 99 99", "the shop's new phone arrived");
    R.ck(fake.rows("suppliers").some((s) => s.id === supplier.supplier.id), "the supplier arrived");
    const numbers = fake.rows("number_sequences").filter((n) => n.kind === "order");
    R.ck(numbers.length === 1 && numbers[0].lastNumber === 2, "the numbering on the server: the last order number is 2", JSON.stringify(numbers));
    R.ck(await unsynced() === 0 && (await api("dashboard.syncStatus")).reachable === true, "the app counts nothing waiting and says the server is reachable");

    await A.stop();
    const local = dumpLocal(box);
    reconcile(R, fake, local, "after recovery: ");
    const counts = Object.fromEntries(Object.entries(local).map(([t, rows]) => [t, rows.length]));

    R.section("a second start changes nothing");
    fake.clearRequests();
    A = await launchApp(box);
    await A.until("typeof window.electronAPI?.dashboard?.syncStatus === 'function'", 20000);
    await sleep(2500);
    R.ck(fake.writes().length === 0, "nothing is sent again (no duplicate, no re-send)", fake.writes().join());
    await A.stop();
    const again = dumpLocal(box);
    R.ck(JSON.stringify(Object.fromEntries(Object.entries(again).map(([t, rows]) => [t, rows.length]))) === JSON.stringify(counts), "and this computer holds the same number of rows");
    await fake.close();
  } catch (error) {
    console.log("ERR", error.stack);
    R.ck(false, "the scenario ran to its end", String(error.message));
    try { await A.stop(); await fake.close(); } catch { /* gone */ }
  }
  process.exit(R.done());
})();
