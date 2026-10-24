// When the server no longer accepts the shop's key (it does not know it, or its licence ended) the FIRST request of the run (GET /api/expiry, at start) is answered
// 401 UNAUTHORIZED: the settings file is renamed (config.properties.expired), a page says the licence has expired and nothing runs behind it (no sync, no categories stored,
// no app window). The next start asks the server about the key kept in the renamed file: accepted -> the file gets its name back and the app starts; refused, or no internet
// -> the setup page opens with the key and the address filled in (a renamed file never lets the app start without the server's word). Nothing about the licence is kept
// on this computer: an old end day left in the database by an earlier version blocks nothing.
const http = require("node:http");
const fs = require("node:fs");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const EXPIRED = /renderer[\\/]expired\.html/;
const APP = /renderer[\\/]index\.html/;
const SETUP = /renderer[\\/]setup\.html/;

const categories = (box) => Number(/COUNT (\d+)/.exec(runScript(box, "console.log('COUNT ' + (await p.category.count()));"))?.[1]);
const pages = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url);

(async () => {
  R.section("the server refuses the key at start");
  const requests = [];
  const fake = http.createServer((req, res) => {
    req.resume();
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "A valid tenant key is required.", code: "UNAUTHORIZED" }));
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const box = sandbox("op-expired-");
  box.writeConfig([`server.url=http://127.0.0.1:${fake.address().port}`, "tenant.key=t1", "label.width=50"]);
  const A = await launchApp(box, {}, EXPIRED);
  try {
    R.ck(await A.until("document.documentElement.dataset.ready === 'true'"), "the expired page opens instead of the app");
    R.ck(requests[0] === "GET /api/expiry", "after the app's first request, GET /api/expiry", requests.join());
    R.ck(await A.val("document.querySelector('.setup__title').textContent === 'Your licence has expired'"), "it says the licence has expired");
    R.ck(await A.val("/settings were set aside/.test(document.getElementById('expired-text').textContent) && !/[0-9]/.test(document.getElementById('expired-text').textContent)"), "and that the settings were set aside, naming no date");
    R.ck(await A.val("typeof window.electronAPI === 'undefined' && typeof window.setupAPI === 'undefined'"), "the page has no access to the app");
    R.ck(!fs.existsSync(box.config), "the settings file is gone (the key, the server address and the rest of it)");
    await sleep(1500);
    R.ck(!(await pages(A.port)).some((u) => APP.test(u)), "the app's own window is not opened");
    R.ck(requests.length === 1, "the app asked nothing else (no sync behind the page)", requests.join());
    R.ck(A.log().includes("the settings file is removed") || A.log().includes("removing the settings file"), "the log says why");
    await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
    await sleep(900);
    R.ck(await A.until("document.querySelector('.setup__title').textContent === 'Votre licence a expiré' && /paramètres ont été mis de côté/.test(document.getElementById('expired-text').textContent)"), "the page is translated into French");
    await A.val("(() => { window.i18n.setLang('ar', { persist: false }); return 1; })()");
    await sleep(900);
    R.ck(await A.until("document.documentElement.dir === 'rtl' && document.querySelector('.setup__title').textContent === 'انتهت صلاحية ترخيصك'"), "and Arabic, right to left");
    R.ck((await A.val("[...window.i18n.missing]")).length === 0, "every text of the page has a translation");
    R.ck(A.problems.length === 0, "no errors in the page", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 400));
  } finally {
    await A.stop();
  }
  R.ck(categories(box) === 0, "nothing of the app started (the categories were not stored)");

  R.ck(!fs.existsSync(box.config) && fs.existsSync(box.config + ".expired"), "the settings file was renamed, not deleted: config.properties.expired is there");
  R.ck(fs.readFileSync(box.config + ".expired", "utf8").includes("tenant.key=t1") && fs.readFileSync(box.config + ".expired", "utf8").includes("label.width=50"), "and it still holds the key, the address and the other settings");
  fake.close();

  // ---- the next start, the server cannot be reached: the form, with the key and the address filled in
  R.section("the next start: the server cannot be reached");
  const down = http.createServer();
  await new Promise((resolve) => down.listen(0, "127.0.0.1", resolve));
  const downUrl = `http://127.0.0.1:${down.address().port}`;
  await new Promise((resolve) => down.close(resolve)); // (nothing listens there now)
  fs.writeFileSync(box.config + ".expired", `tenant.key=t1\nserver.url=${downUrl}\n`);
  const B = await launchApp(box, {}, SETUP);
  try {
    R.ck(await B.until("document.querySelector('form') !== null && document.getElementById('setup-form').dataset.ready === 'true'"), "no internet, and the settings file is not under its normal name: the setup page opens (the app does not start)");
    R.ck(await B.val(`document.getElementById('tenant-key').value === 't1' && document.getElementById('server-url').value === '${downUrl}'`), "with the tenant key and the server address filled in");
    R.ck(await B.val("/could not be reached/.test(document.getElementById('setup-status').textContent) && !document.getElementById('setup-status').hidden"), "and it says the server could not be reached");
    R.ck(!(await pages(B.port)).some((u) => APP.test(u) || EXPIRED.test(u)), "neither the app nor the expired page is open");
    R.ck(fs.existsSync(box.config + ".expired") && !fs.existsSync(box.config), "the renamed file stays as it was");
  } catch (error) {
    R.ck(false, "unreachable: ERR", String(error.stack).slice(0, 400));
  } finally {
    await B.stop();
  }

  // ---- the next start, the server still refuses the key: the form, filled in, saying so
  R.section("the next start: the server still refuses the key");
  const refusing = http.createServer((req, res) => { req.resume(); res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ code: "UNAUTHORIZED" })); });
  await new Promise((resolve) => refusing.listen(0, "127.0.0.1", resolve));
  const refusingUrl = `http://127.0.0.1:${refusing.address().port}`;
  fs.writeFileSync(box.config + ".expired", `tenant.key=t1\nserver.url=${refusingUrl}/\n`);
  const C = await launchApp(box, {}, SETUP);
  try {
    R.ck(await C.until("document.getElementById('setup-form').dataset.ready === 'true'"), "the setup page opens");
    R.ck(await C.val(`document.getElementById('tenant-key').value === 't1' && document.getElementById('server-url').value === '${refusingUrl}'`), "with the key and the address filled in (a trailing slash dropped)");
    R.ck(await C.val("/does not accept this shop's key/.test(document.getElementById('setup-status').textContent)"), "and it says the server does not accept the key");
    await C.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
    await sleep(900);
    R.ck(await C.until("/n'accepte pas la clé/.test(document.getElementById('setup-status').textContent)"), "the message is translated into French");
    { const miss = (await C.val("[...window.i18n.missing]")).filter((s) => !/^http|^t1$|^[0-9a-f]{32}$|@|Rue Didouche/.test(s)); R.ck(miss.length === 0, "and every text of the page has a translation", JSON.stringify(miss)); }
  } catch (error) {
    R.ck(false, "refused: ERR", String(error.stack).slice(0, 400));
  } finally {
    await C.stop();
  }
  refusing.close();

  // ---- the next start, the server accepts the key: the file gets its name back and the app starts
  R.section("the next start: the server accepts the key");
  const accepting = http.createServer((req, res) => { req.resume(); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ expiry: "2031-05-06" })); });
  await new Promise((resolve) => accepting.listen(0, "127.0.0.1", resolve));
  fs.writeFileSync(box.config + ".expired", `tenant.key=t1\nserver.url=http://127.0.0.1:${accepting.address().port}\nlabel.width=50\n`);
  const D = await launchApp(box, {}, APP);
  try {
    R.ck(await D.until("document.querySelector('.nav-item') !== null && typeof window.electronAPI?.customers?.list === 'function'"), "the app starts, without asking for anything");
    R.ck(fs.existsSync(box.config) && !fs.existsSync(box.config + ".expired"), "the renamed file got its normal name back");
    R.ck(fs.readFileSync(box.config, "utf8").includes("label.width=50"), "with everything it held");
  } catch (error) {
    R.ck(false, "accepted: ERR", String(error.stack).slice(0, 400));
  } finally {
    await D.stop();
  }
  accepting.close();

  // ---- a form confirmed: the new settings file is written and the renamed one is removed
  R.section("confirming the form");
  fs.rmSync(box.config, { force: true });
  const registering = http.createServer((req, res) => {
    req.resume();
    res.writeHead(req.url.startsWith("/api/register") ? 200 : 401, { "content-type": "application/json" });
    res.end(JSON.stringify(req.url.startsWith("/api/register") ? { registered: true, expiry: "2031-05-06", tenant: {} } : { code: "UNAUTHORIZED" }));
  });
  await new Promise((resolve) => registering.listen(0, "127.0.0.1", resolve));
  const registeringUrl = `http://127.0.0.1:${registering.address().port}`;
  fs.writeFileSync(box.config + ".expired", `tenant.key=t1\nserver.url=${registeringUrl}\n`);
  const E = await launchApp(box, {}, SETUP);
  try {
    await E.until("document.getElementById('setup-form').dataset.ready === 'true'");
    await E.val("(() => { document.getElementById('shop-name').value = 'Maison Clair'; document.getElementById('setup-form').requestSubmit(); return 1; })()");
    for (let i = 0; i < 40 && !fs.existsSync(box.config); i++) await sleep(250);
    R.ck(fs.existsSync(box.config) && fs.readFileSync(box.config, "utf8").includes("tenant.key=t1"), "the new settings file is written with the key");
    R.ck(!fs.existsSync(box.config + ".expired"), "and the renamed one is removed (it is not needed any more)");
  } catch (error) {
    R.ck(false, "confirm: ERR", String(error.stack).slice(0, 400));
  } finally {
    await E.stop();
  }
  registering.close();

  R.section("the server cannot be reached, or accepts the key: the app starts as usual");
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  for (const [label, daySaved] of [["a database that never had an end day", null], ["an end day long past, left by an earlier version", day(-730)], ["an end day yesterday, left by an earlier version", day(-1)]]) {
    const c = sandbox("op-expiry-ok-");
    c.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
    if (daySaved !== null) {
      // the table as the earlier version made it, with its NOT NULL expires_at
      runScript(c, `
        await p.$executeRawUnsafe('DROP TABLE "license_expiry"');
        await p.$executeRawUnsafe('CREATE TABLE "license_expiry" ("id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1, "expires_at" DATETIME NOT NULL, "shop_name" TEXT, "instagram_url" TEXT, "tiktok_url" TEXT, "phone" TEXT, "email" TEXT, "address" TEXT, "synced" BOOLEAN NOT NULL DEFAULT true, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME NOT NULL)');
        await p.$executeRawUnsafe("INSERT INTO license_expiry (id, expires_at, shop_name, updated_at) VALUES (1, '${daySaved} 00:00:00', 'Old Shop', '2026-01-01 00:00:00')");
      `);
    }
    const D = await launchApp(c, {}, APP);
    try {
      R.ck(await D.until("document.querySelector('.nav-item') !== null && typeof window.electronAPI?.customers?.list === 'function'"), `${label}: the app starts`);
      R.ck(fs.existsSync(c.config), `${label}: the settings file stays`);
      R.ck(D.log().includes("[startup] server check: offline") && D.log().includes("[startup] ready: opening the main window"), `${label}: the log shows the server check and that the main window opened`);
    } finally {
      await D.stop();
    }
    R.ck(categories(c) > 0, `${label}: and everything behind it ran (the categories were stored)`);
    if (daySaved !== null) {
      const shop = /SHOP (.*)/.exec(runScript(c, "console.log('SHOP ' + JSON.stringify({ name: (await p.licenseExpiry.findUnique({ where: { id: 1 } })).shopName, columns: (await p.$queryRawUnsafe('PRAGMA table_info(\\\"license_expiry\\\")')).map((x) => x.name) }));"))?.[1];
      const parsed = JSON.parse(shop ?? "null");
      R.ck(parsed?.name === "Old Shop" && !parsed?.columns?.includes("expires_at"), `${label}: the old column was dropped and the shop's details kept`, shop);
    }
  }
  process.exit(R.done());
})();
