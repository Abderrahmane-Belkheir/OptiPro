// The life of a licence, from the shop's side: activation, a licence that ends (at start, or while the shop is working), the page that says so, the way back when the licence
// is renewed (by the form, or by itself at the next start), a computer with no connection, and what happens to the shop's data through all of it (nothing is lost, nothing is
// sent twice). The stand-in server decides each key's licence (tests/helpers/fakeServer.cjs).
//   P0  activation through the setup page, a little work done
//   P1  the licence ended while the app was closed: the first request of the run is refused: no app, the page that says so, the settings file renamed, nothing sent
//   P2  the next start: the setup page, the key and address filled in, "the server does not accept this key"; wrong keys and a still-ended licence only give a sentence
//   P3  the licence is renewed: Confirm (with the shop's saved details) activates again, the app starts, the old renamed file is gone
//   P4  the licence ends WHILE the shop works: the first refused save stops the app (its windows are replaced), the work done is kept here
//   P5  renewed again: the next start restores the settings by itself and sends what was kept, once
//   P6  ended again and the computer has no connection: the setup page says the key could not be checked; back online and renewed, the app starts
const fs = require("node:fs");
const { sandbox, runScript, launchApp, connectPage, recorder, sleep } = require("./helpers/app.cjs");
const { startFakeServer } = require("./helpers/fakeServer.cjs");
const { dumpLocal, reconcile } = require("./helpers/reconcile.cjs");

const R = recorder();
const SETUP = /renderer[\\/]setup\.html/;
const APP = /renderer[\\/]index\.html/;
const EXPIRED = /renderer[\\/]expired\.html/;
const KEY = "shop-key-licence";
const OTHER_KEY = "other-shop-key";
const SHOP = { "shop-name": "Optique du Centre", "shop-phone": "+213 550 77 66 55", "shop-email": "centre@optique.example.com", "shop-address": "5 Avenue de l'ALN, Oran", "shop-instagram": "", "shop-tiktok": "" };

const ready = async (port) => { const page = await connectPage(port, SETUP); await page.until("typeof window.setupAPI?.confirm === 'function' && !!document.getElementById('setup-form')?.dataset.mode", 15000); return page; };
const fill = (page, values) => page.val(`(() => { for (const [id, v] of Object.entries(${JSON.stringify(values)})) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()`);
const press = (page) => page.val("(() => { document.getElementById('setup-confirm').click(); return 1; })()");
const said = async (page, ms = 15000) => { await page.until("!document.getElementById('setup-status').hidden && document.getElementById('setup-status').textContent.trim() !== '' && !/Activating/.test(document.getElementById('setup-status').textContent)", ms); return page.val("document.getElementById('setup-status').textContent"); };
const targets = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url.split(/[\\/]/).pop());

(async () => {
  const fake = await startFakeServer({ keys: { [KEY]: { expiry: "2099-12-31" }, [OTHER_KEY]: { expiry: "2099-12-31" } } });
  const box = sandbox("op-e2e-lic-");
  const expiredFile = box.config + ".expired";
  let A = null;
  const stop = async () => { try { await A?.stop(); } catch { /* gone */ } A = null; };
  const refusals = () => fake.state.requests.filter((r) => r.status === 401 && r.key === KEY);

  try {
    // ------------------------------------------------------------------------------------------------ P0
    R.section("P0: activation, and a little work");
    A = await launchApp(box, {}, SETUP);
    let setup = await ready(A.port);
    await fill(setup, { "tenant-key": KEY, "server-url": fake.url, ...SHOP });
    await press(setup);
    let app = await connectPage(A.port, APP, 25000);
    R.ck(fs.readFileSync(box.config, "utf8").includes(`tenant.key=${KEY}`), "the shop is activated: the settings file is written");
    R.ck(fake.state.keys.get(KEY).shop?.name === "Optique du Centre", "and the server has the shop's details");
    const brand = await app.val("window.electronAPI.brands.insert({ name: 'Essilor' })");
    const frame = (await app.val("window.electronAPI.frames.create({ currency: 'DZD', name: 'Classic', brandId: " + JSON.stringify(brand.id) + ", categoryId: 1, price: '12000', costPrice: '7000', stock: '5' })")).frame;
    const amina = await app.val("window.electronAPI.customers.insert({ yearOfBirth: 1990, name: 'Amina', phone: '0550 00 00 01' })");
    const placed = await app.val("window.electronAPI.orderPlacement.place({ customerId: " + JSON.stringify(amina.id) + ", frameId: " + JSON.stringify(frame.id) + ", deposit: '12000' })");
    R.ck(placed.status === "placed", "an order is placed", JSON.stringify(placed.errors ?? ""));
    R.ck(await app.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 25000), "and everything reaches the server");
    const rowsBefore = { orders: fake.count("orders"), customers: fake.count("customers"), frames: fake.count("frames") };
    app.close();
    setup.close();
    await stop();

    // ------------------------------------------------------------------------------------------------ P1
    R.section("P1: the licence ended while the app was closed");
    fake.setLicence(KEY, "expired");
    fake.clearRequests();
    A = await launchApp(box, {}, EXPIRED);
    const page = await connectPage(A.port, EXPIRED);
    R.ck(await page.until("document.getElementById('expired-title')?.textContent.includes('licence has expired')"), "the page says the licence has expired");
    R.ck((await targets(A.port)).join() === "expired.html", "it is the only window: the app itself did not start", (await targets(A.port)).join());
    R.ck(!fs.existsSync(box.config) && fs.existsSync(expiredFile), "the settings file was renamed (config.properties.expired), not deleted");
    R.ck(fs.readFileSync(expiredFile, "utf8").includes(`tenant.key=${KEY}`) && fs.readFileSync(expiredFile, "utf8").includes(`server.url=${fake.url}`), "it still holds the key and the address");
    R.ck(fake.state.requests[0]?.path === "/api/expiry" && fake.state.requests[0]?.status === 401 && fake.writes().length === 0, "the first (and only) request was the licence check, refused; nothing was written to the server", fake.state.requests.map((r) => `${r.path}:${r.status}`).join());
    page.close();
    await stop();

    // ------------------------------------------------------------------------------------------------ P2
    R.section("P2: the next start, the licence still ended");
    fake.clearRequests();
    A = await launchApp(box, {}, SETUP);
    setup = await ready(A.port);
    R.ck(await setup.until("document.getElementById('tenant-key').value === " + JSON.stringify(KEY)), "the setup page opens with the key filled in");
    R.ck((await setup.val("document.getElementById('server-url').value")) === fake.url, "and the server address");
    R.ck((await setup.val("document.getElementById('setup-status').textContent")).includes("does not accept this shop's key"), "it says the server does not accept the key");
    R.ck((await setup.val("document.getElementById('setup-form').dataset.mode")) === "short" && (await setup.val("document.querySelector('[data-details]').hidden")), "it is the short form: the shop's details are already here, only the key and the address are asked");
    R.ck((await targets(A.port)).join() === "setup.html", "nothing else is open");
    R.ck(fake.state.requests.filter((r) => r.path === "/api/expiry").length === 1 && fake.writes().length === 0, "the server was asked once about that key, and nothing else");
    await fill(setup, { "tenant-key": "a-wrong-key" });
    await press(setup);
    R.ck((await said(setup)).includes("did not accept the tenant key"), "a wrong key: a sentence, the page stays");
    await fill(setup, { "tenant-key": KEY });
    await press(setup);
    R.ck((await said(setup)).includes("did not accept the tenant key"), "the right key but the licence still ended: the same sentence, the page stays");
    R.ck(!fs.existsSync(box.config) && fs.existsSync(expiredFile) && (await targets(A.port)).join() === "setup.html", "nothing was written, the renamed file is kept, the app did not start or close");

    // ------------------------------------------------------------------------------------------------ P3
    R.section("P3: the licence is renewed");
    fake.setLicence(KEY, "valid");
    fake.clearRequests();
    await press(setup);
    app = await connectPage(A.port, APP, 25000);
    R.ck(await app.until("typeof window.electronAPI?.dashboard?.month === 'function'"), "Confirm activates again: the app starts");
    R.ck(fs.existsSync(box.config) && !fs.existsSync(expiredFile) && fs.readFileSync(box.config, "utf8").includes(`tenant.key=${KEY}`), "the settings file is back and the renamed one is gone");
    const reg = fake.state.requests.find((r) => r.path === "/api/register");
    R.ck(reg?.status === 200 && reg.key === KEY, "the shop registered again with the server");
    R.ck(fake.state.keys.get(KEY).shop?.name === "Optique du Centre" && fake.state.keys.get(KEY).shop?.address === "5 Avenue de l'ALN, Oran", "with the details it had saved (the shop did not have to type them again)", JSON.stringify(fake.state.keys.get(KEY).shop));
    R.ck(fake.count("orders") === rowsBefore.orders && fake.count("customers") === rowsBefore.customers, "no row was duplicated or lost", JSON.stringify([fake.count("orders"), fake.count("customers")]));
    R.ck((await targets(A.port)).join() === "index.html", "the setup window is closed", (await targets(A.port)).join());

    // ------------------------------------------------------------------------------------------------ P4
    R.section("P4: the licence ends while the shop works");
    fake.setLicence(KEY, "expired");
    fake.clearRequests();
    // (the window is closed by the refusal while this call is on its way: its answer never comes back, which is what is being tested, so it is not waited for)
    app.val("window.electronAPI.customers.insert({ yearOfBirth: 1990, name: 'Saved while the licence ended', phone: '0661 00 00 02' })").catch(() => undefined);
    const expired = await connectPage(A.port, EXPIRED, 20000);
    R.ck(await expired.until("document.getElementById('expired-title')?.textContent.includes('licence has expired')"), "the first refused request replaced the app's windows with the page that says the licence has expired");
    R.ck((await targets(A.port)).join() === "expired.html", "the app's own window is closed", (await targets(A.port)).join());
    R.ck(!fs.existsSync(box.config) && fs.existsSync(expiredFile), "the settings file was renamed");
    await sleep(1500);
    const refused = refusals().length;
    R.ck(refused >= 1 && refused <= 3, "the sync stopped after that refusal (it does not keep asking)", `${refused} refused request(s)`);
    expired.close();
    app.close();
    await stop();

    // ------------------------------------------------------------------------------------------------ P5
    R.section("P5: renewed, and the next start restores everything by itself");
    fake.setLicence(KEY, "valid");
    fake.clearRequests();
    A = await launchApp(box, {}, APP);
    app = await connectPage(A.port, APP, 25000);
    R.ck(await app.until("typeof window.electronAPI?.dashboard?.month === 'function'"), "the app starts without any form");
    R.ck(fs.existsSync(box.config) && !fs.existsSync(expiredFile), "the settings file got its name back");
    R.ck(fake.state.requests[0]?.path === "/api/expiry" && fake.state.requests[0]?.status === 200, "the renamed file's key was checked first: accepted");
    R.ck(await app.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 25000), "what was saved while the licence ended is sent");
    R.ck(fake.rows("customers").filter((c) => c.name === "Saved while the licence ended").length === 1, "exactly once");
    R.ck(fake.writes().filter((w) => w === "orders:insert").length === 0, "and nothing that was already on the server is sent again", fake.writes().join());
    app.close();
    await stop();

    // ------------------------------------------------------------------------------------------------ P6
    R.section("P6: ended, and the computer has no connection");
    fake.setLicence(KEY, "expired");
    A = await launchApp(box, {}, EXPIRED); // the first request is refused at start: the page, the file renamed
    let again = await connectPage(A.port, EXPIRED);
    R.ck(await again.until("!!document.getElementById('expired-title')"), "(ended at start)");
    again.close();
    await stop();
    fake.setMode("down");
    A = await launchApp(box, {}, SETUP);
    setup = await ready(A.port);
    R.ck((await setup.val("document.getElementById('setup-status').textContent")).includes("could not be reached"), "with no connection the setup page says the key could not be checked");
    R.ck((await targets(A.port)).join() === "setup.html", "and the app does not start on an unchecked renamed file");
    setup.close();
    await stop();
    fake.setMode("ok");
    fake.setLicence(KEY, "valid");
    A = await launchApp(box, {}, APP);
    app = await connectPage(A.port, APP, 25000);
    R.ck(await app.until("typeof window.electronAPI?.dashboard?.month === 'function'") && fs.existsSync(box.config) && !fs.existsSync(expiredFile), "back online and renewed: the app starts by itself");
    app.close();
    await stop();

    // ------------------------------------------------------------------------------------------------ the end
    R.section("the end");
    const local = dumpLocal(box);
    reconcile(R, fake, local, "after all of it: ");
    R.ck(local.customers.length === rowsBefore.customers + 1 && local.orders.length === rowsBefore.orders, "this computer lost nothing and made no extra row", JSON.stringify([local.customers.length, local.orders.length]));

    // What a different key does (recorded, not judged): the setup page accepts any key the server knows, and the data that is here goes to that shop.
    fake.setLicence(KEY, "expired");
    A = await launchApp(box, {}, EXPIRED);
    await connectPage(A.port, EXPIRED);
    await stop();
    fake.clearRequests();
    A = await launchApp(box, {}, SETUP);
    setup = await ready(A.port);
    await fill(setup, { "tenant-key": OTHER_KEY });
    await press(setup);
    app = await connectPage(A.port, APP, 25000);
    await app.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 25000);
    const toOther = fake.state.requests.filter((r) => r.table && r.key === OTHER_KEY).length;
    console.log(`FINDING: the setup page accepted another valid key (${OTHER_KEY}); the data of the first shop was then sent under it: ${toOther} write request(s) with the other shop's key.`);
    R.ck(true, "(recorded) a different key re-labels the computer's data to that shop: see the report");
    app.close();
    await stop();
    await fake.close();
  } catch (error) {
    console.log("ERR", error.stack);
    R.ck(false, "the scenario ran to its end", String(error.message));
    await stop();
    await fake.close();
  }
  process.exit(R.done());
})();
