// A new shop, from the box: install, activation, first start, restarts. The app is started with NO settings file and a stand-in server that behaves like the real one
// (tests/helpers/fakeServer.cjs: the real validation of the backend, a licence per tenant key).
//   1. the setup page opens, nothing else runs (no database)
//   2. every way to get the form wrong or the server unreachable leaves the form open with a sentence, writes nothing, and never closes the app
//   3. the right key and details: the settings file is written (key, address; readable by its owner only), the app's own window replaces the setup window, the shop's details are
//      kept here and on the server, the first request of the run asks whether the licence is valid
//   4. the next starts go straight to the app and ask the server the same question
const fs = require("node:fs");
const path = require("node:path");
const { sandbox, launchApp, connectPage, recorder, sleep } = require("./helpers/app.cjs");
const { startFakeServer } = require("./helpers/fakeServer.cjs");

const R = recorder();
const SETUP = /renderer[\\/]setup\.html/;
const APP = /renderer[\\/]index\.html/;
const KEY = "shop-key-001";

const FORM = { "tenant-key": KEY, "server-url": "", "shop-name": "Optique El Djazair", "shop-phone": "+213 550 11 22 33", "shop-email": "contact@optique-dz.example.com", "shop-address": "12 Rue Didouche Mourad, Alger", "shop-instagram": "", "shop-tiktok": "" };
const fill = (A, values) => A.val(`(() => { for (const [id, v] of Object.entries(${JSON.stringify(values)})) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()`);
let lastSaid = "";
const press = async (A) => { lastSaid = await status(A); await A.val("(() => { document.getElementById('setup-confirm').click(); return 1; })()"); };
const status = (A) => A.val("document.getElementById('setup-status').hidden ? '' : document.getElementById('setup-status').textContent");
const said = async (A, ms = 12000) => { await A.until("(() => { const s = document.getElementById('setup-status'); const t = s.textContent.trim(); return !s.hidden && t !== '' && !/^Activating/.test(t) && t !== " + JSON.stringify(lastSaid.trim()) + "; })()", ms); return status(A); };
const alive = async (port) => { try { return (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

(async () => {
  const fake = await startFakeServer({ keys: { [KEY]: { expiry: "2099-12-31" } } });
  const box = sandbox("op-e2e-act-"); // no settings file at all
  let A = await launchApp(box, {}, SETUP);
  let app = null;
  try {
    R.section("a new installation");
    R.ck(!fs.existsSync(box.config), "no settings file exists");
    R.ck(await A.until("!!document.getElementById('setup-form')"), "the setup page opens");
    // (ready: its script has run, so a click is answered by the page and not by the browser's own form sending)
    await A.until("typeof window.setupAPI?.confirm === 'function' && !!document.getElementById('setup-form')?.dataset.mode", 15000);
    R.ck(!fs.existsSync(box.db), "nothing of the app runs behind it: no database was made");
    R.ck(fake.state.requests.length === 0, "and the server has not been asked anything yet");

    R.section("a form that is wrong, a server that is not there");
    await fill(A, { ...FORM, "server-url": fake.url, "tenant-key": "" });
    await press(A);
    R.ck((await said(A, 4000)).toLowerCase().includes("tenant key") && fake.state.requests.length === 0, "no key typed: the form says so and no request is made", `${await status(A)} | requests: ${fake.state.requests.length}`);
    await fill(A, { ...FORM, "server-url": fake.url, "tenant-key": "bad key!" });
    await press(A);
    R.ck((await said(A, 4000)).toLowerCase().includes("letters") && fake.state.requests.length === 0, "a key with strange characters is refused before anything is sent", await status(A));
    await fill(A, { ...FORM, "server-url": "ftp://nowhere", "tenant-key": KEY });
    await press(A);
    R.ck((await said(A, 4000)).toLowerCase().includes("web address") && fake.state.requests.length === 0, "a server address that is not a web address is refused before anything is sent", await status(A));
    await fill(A, { ...FORM, "server-url": fake.url, "shop-name": "" });
    await press(A);
    R.ck((await said(A, 4000)).toLowerCase().includes("name") && fake.state.requests.length === 0, "no shop name: the form says so", await status(A));

    await fill(A, { ...FORM, "server-url": fake.url, "tenant-key": "not-a-real-key" });
    await press(A);
    R.ck((await said(A)).includes("did not accept the tenant key"), "an unknown key: the server's refusal is explained", await status(A));
    R.ck(!fs.existsSync(box.config) && (await alive(A.port)), "nothing was written and the app is still open");

    await fill(A, { ...FORM, "server-url": fake.url, "shop-email": "not-an-email" });
    await press(A);
    R.ck((await said(A)).toLowerCase().includes("e-mail") || (await status(A)).toLowerCase().includes("email"), "a bad e-mail: the server's words are shown", await status(A));
    R.ck(!fs.existsSync(box.config), "nothing was written");

    await fill(A, { ...FORM, "server-url": "http://127.0.0.1:9" });
    await press(A);
    R.ck((await said(A, 20000)).includes("can't be reached"), "a server address with nothing behind it: the form says the server can't be reached", await status(A));
    R.ck(!fs.existsSync(box.config) && (await alive(A.port)), "nothing written, the app is still open");

    fake.setMode("error");
    await fill(A, { ...FORM, "server-url": fake.url });
    await press(A);
    R.ck((await said(A)).toLowerCase().includes("try again"), "a server that fails (500): a message, the form stays", await status(A));
    fake.setMode("down");
    await press(A);
    R.ck((await said(A, 20000)).includes("can't be reached"), "a server that drops the connection: the form says the server can't be reached", await status(A));
    fake.setMode("ok");
    R.ck(!fs.existsSync(box.config), "still nothing written after all of it");

    R.section("the right key and details");
    fake.state.requests.length = 0;
    await fill(A, { ...FORM, "server-url": fake.url });
    await press(A);
    app = await connectPage(A.port, APP, 25000);
    R.ck(true, "the app's own window opens");
    R.ck(await app.until("typeof window.electronAPI?.shopInfo?.get === 'function'"), "it is the real app (its services are there)");
    const config = fs.readFileSync(box.config, "utf8");
    R.ck(config.includes(`tenant.key=${KEY}`) && config.includes(`server.url=${fake.url}`), "the settings file holds the key and the server address", config.replace(KEY, "<key>"));
    if (process.platform !== "win32") R.ck((fs.statSync(box.config).mode & 0o077) === 0, "readable by its owner only");
    R.ck(!(await alive(A.port).then(async () => (await (await fetch(`http://127.0.0.1:${A.port}/json`)).json()).some((t) => t.type === "page" && SETUP.test(t.url)))), "the setup window is closed");
    const registered = fake.state.requests.find((r) => r.path === "/api/register");
    R.ck(registered && registered.key === KEY && registered.status === 200, "the server was asked to register the shop with its key");
    R.ck(fake.state.keys.get(KEY).shop?.name === "Optique El Djazair" && fake.state.keys.get(KEY).shop?.phone === "+213 550 11 22 33" && fake.state.keys.get(KEY).shop?.address === "12 Rue Didouche Mourad, Alger", "the server holds the shop's details", JSON.stringify(fake.state.keys.get(KEY).shop));
    const info = await app.val("window.electronAPI.shopInfo.get()");
    R.ck(info?.name === "Optique El Djazair" && info?.phone === "+213 550 11 22 33" && info?.email === "contact@optique-dz.example.com" && info?.onServer === true, "this computer holds the same details, known by the server", JSON.stringify(info));
    R.ck(await app.until("document.getElementById('shop-brand-name')?.textContent === 'Optique El Djazair'"), "the sidebar carries the shop's name");
    R.ck(fake.state.requests.some((r) => r.path === "/api/expiry" && r.status === 200), "the first request of the run asked whether the licence is valid");
    const firstAfterRegister = fake.state.requests.filter((r) => r.path !== "/api/register")[0];
    R.ck(firstAfterRegister?.path === "/api/expiry", "(it was the first thing after the registration)", firstAfterRegister?.path);
    R.ck(await app.until("document.querySelector('[data-section=month-numbers]')?.dataset.status === 'ready'"), "the dashboard is there, empty and without error");
    R.ck((await app.val("window.electronAPI.dashboard.syncStatus()")).unsyncedCount === 0, "nothing is waiting to be sent");
    R.ck(fake.writes().length === 0, "and nothing was written to the server's tables (a new shop has no rows)", fake.writes().join());
    R.ck(app.problems.length === 0, "no error in the window", app.problems.join(" | "));
    app.close();
    await A.stop();

    R.section("the next starts");
    fake.clearRequests();
    A = await launchApp(box, {}, APP);
    R.ck(await A.until("typeof window.electronAPI?.shopInfo?.get === 'function'", 20000), "the app starts straight on its own window (no setup page)");
    R.ck(await A.until("document.getElementById('shop-brand-name')?.textContent === 'Optique El Djazair'"), "the shop is remembered");
    R.ck(fake.state.requests[0]?.path === "/api/expiry" && fake.state.requests[0]?.status === 200, "the first request of the run is the licence check", fake.state.requests[0]?.path);
    R.ck(fake.state.requests.filter((r) => r.path === "/api/register").length === 0, "the shop is not registered again");
    await A.stop();

    fake.setMode("down");
    fake.clearRequests();
    A = await launchApp(box, {}, APP);
    R.ck(await A.until("typeof window.electronAPI?.shopInfo?.get === 'function'", 20000), "with no connection the app starts anyway (the licence is the server's to refuse, never the computer's)");
    R.ck(fs.existsSync(box.config) && !fs.existsSync(box.config + ".expired"), "the settings file is untouched");
    await A.stop();
    fake.setMode("ok");
    fake.close();
    R.ck(true, "(done)");
  } catch (error) {
    console.log("ERR", error.stack);
    R.ck(false, "the test ran to its end", String(error.message));
    try { app?.close(); await A.stop(); await fake.close(); } catch { /* gone */ }
  }
  process.exit(R.done());
})();
