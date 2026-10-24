// The first-run setup when the settings file is gone but this computer's database is still there. With the shop's details in the database (the licence row) the page
// asks only for the tenant key and the server address, and registers the shop with the saved details; for another shop's key, or with no details saved, it shows
// the whole form. A small local server stands in for the real one.
const fs = require("node:fs");
const http = require("node:http");
const { sandbox, runScript, launchApp, recorder, sleep, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const SETUP = /renderer[\\/]setup\.html/;
const APP = /renderer[\\/]index\.html/;

async function fakeServer() {
  const server = { requests: [], refuseKey: null }; // refuseKey: the one key the server does not know (401 UNAUTHORIZED, like the real one)
  const http_ = http.createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      server.requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: data ? JSON.parse(data) : null });
      if (server.refuseKey && req.headers.authorization === `Bearer ${server.refuseKey}`) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "A valid tenant key is required.", code: "UNAUTHORIZED" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url === "/api/expiry" ? { expiry: "2030-01-01" } : { registered: true, tenant: {}, expiry: "2030-01-01" }));
    });
  });
  await new Promise((resolve) => http_.listen(0, "127.0.0.1", resolve));
  server.url = `http://127.0.0.1:${http_.address().port}`;
  server.close = () => http_.close();
  return server;
}

const pages = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url);
async function fill(A, values) {
  await A.val(`(() => { for (const [id, v] of Object.entries(${JSON.stringify(values)})) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()`);
}
const confirm = (A) => A.val("(() => { document.getElementById('setup-confirm').click(); return 1; })()");
const detailsHidden = (A) => A.val("[...document.querySelectorAll('[data-details]')].every((g) => g.hidden)");
const detailsShown = (A) => A.val("[...document.querySelectorAll('[data-details]')].every((g) => !g.hidden) && document.querySelectorAll('[data-details]').length === 2");
const status = (A) => A.val("document.getElementById('setup-status').hidden ? '' : document.getElementById('setup-status').textContent");

/** A sandbox with a database and NO settings file. `seed` is the script that fills the database. */
function withDatabase(seed) {
  const box = sandbox("op-setupsaved-");
  runScript(box, seed); // (the database is made by this; there is no config file)
  return box;
}
const SHOP = `await p.tenant.create({ data: { key: 'goodkey', host: 'h', name: 'T' } });
  await p.licenseExpiry.create({ data: { id: 1, shopName: 'Maison Clair', phone: '0550 00 00 00', email: 'hello@maison.dz', address: '12 Rue Didouche Mourad', instagramUrl: 'https://instagram.com/maison', synced: true } });`;

(async () => {
  // ---- the reader alone
  R.section("reading the saved shop");
  const box0 = withDatabase(SHOP);
  const read = JSON.parse(
    /READ (.*)/.exec(
      runScript(
        box0,
        `
    const { readSavedShop } = require(ROOT + '/dist/savedShop.js');
    const out = {};
    out.saved = readSavedShop();
    const sizeBefore = require('fs').statSync(process.env.SQLITE_DATABASE_URL).mtimeMs;
    readSavedShop(); readSavedShop();
    out.untouched = require('fs').statSync(process.env.SQLITE_DATABASE_URL).mtimeMs === sizeBefore;
    process.env.SQLITE_DATABASE_URL = process.env.SQLITE_DATABASE_URL + '.missing';
    out.noFile = readSavedShop();
    out.noFileCreated = require('fs').existsSync(process.env.SQLITE_DATABASE_URL);
    process.env.SQLITE_DATABASE_URL = process.env.SQLITE_DATABASE_URL.replace('.missing', '');
    await p.licenseExpiry.update({ where: { id: 1 }, data: { shopName: null } });
    out.noName = readSavedShop();
    await p.licenseExpiry.update({ where: { id: 1 }, data: { shopName: '  ' } });
    out.blankName = readSavedShop();
    await p.licenseExpiry.deleteMany();
    out.noRow = readSavedShop();
    console.log('READ ' + JSON.stringify(out));
  `,
      ),
    )?.[1] ?? "null",
  );
  R.ck(JSON.stringify(read.saved?.shop) === JSON.stringify({ name: "Maison Clair", phone: "0550 00 00 00", email: "hello@maison.dz", address: "12 Rue Didouche Mourad", instagramUrl: "https://instagram.com/maison" }), "it reads the shop's details (a detail that is empty is left out)", JSON.stringify(read.saved));
  R.ck(read.untouched === true, "looking changes nothing in the database file");
  R.ck(read.noFile === null && read.noFileCreated === false, "no database file: nothing saved, and none is made");
  R.ck(read.noName === null && read.blankName === null && read.noRow === null, "a licence row with no shop name, a blank one, or no row at all: nothing saved");

  // ---- the setup window
  const server = await fakeServer();

  R.section("the database has the shop: only the key and the server address");
  {
    const box = withDatabase(SHOP);
    const A = await launchApp(box, {}, SETUP);
    try {
      R.ck(await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'"), "the setup page opens");
      R.ck((await A.val("document.getElementById('setup-form').dataset.mode")) === "short" && (await detailsHidden(A)), "in the short form: the shop's details and the social networks are not shown");
      R.ck(await A.val("['tenant-key', 'server-url'].every((id) => { const e = document.getElementById(id); return e && !e.closest('fieldset').hidden && e.offsetParent !== null; })"), "and the tenant key and the server address are");
      R.ck(/this computer already has your shop's information/.test(await A.val("document.getElementById('setup-intro').textContent")), "the text above says why");
      R.ck(await A.val("[...document.querySelectorAll('[data-details] input')].every((e) => e.offsetParent === null)"), "none of the hidden boxes can be reached");
      await fill(A, { "tenant-key": "goodkey", "server-url": server.url + "/" });
      server.requests.length = 0;
      await confirm(A);
      R.ck(await A.until("/Activated/.test(document.getElementById('setup-status').textContent)"), "the server accepts: the page says Activated");
      const sent = server.requests.find((r) => r.url === "/api/register");
      R.ck(sent?.method === "POST" && sent?.authorization === "Bearer goodkey", "the shop is registered with POST /api/register and the typed key");
      R.ck(JSON.stringify(Object.entries(sent?.body ?? {}).sort()) === JSON.stringify(Object.entries({ name: "Maison Clair", phone: "0550 00 00 00", email: "hello@maison.dz", address: "12 Rue Didouche Mourad", instagramUrl: "https://instagram.com/maison" }).sort()), "with the details the database already had, nothing typed", JSON.stringify(sent?.body));
      let appeared = false;
      for (let i = 0; i < 60 && !appeared; i++) {
        appeared = (await pages(A.port)).some((u) => APP.test(u));
        if (!appeared) await sleep(250);
      }
      R.ck(appeared, "and the app starts");
      await sleep(800);
      const config = fs.readFileSync(box.config, "utf8");
      R.ck(/^tenant\.key=goodkey$/m.test(config) && config.includes(`server.url=${server.url}\n`), "the settings file holds the key and the address");
      const row = JSON.parse(/ROW (.*)/.exec(runScript(box, "const r = await p.licenseExpiry.findUnique({ where: { id: 1 } }); console.log('ROW ' + JSON.stringify([r.shopName, r.phone, r.address, r.synced]));"))?.[1] ?? "null");
      R.ck(JSON.stringify(row) === JSON.stringify(["Maison Clair", "0550 00 00 00", "12 Rue Didouche Mourad", true]), "the saved details are still there, synced", JSON.stringify(row));
    } catch (error) {
      R.ck(false, "short form: ERR", String(error.stack).slice(0, 500));
    } finally {
      await A.stop();
    }
  }

  R.section("a wrong key fails normally");
  {
    const box = withDatabase(SHOP);
    const A = await launchApp(box, {}, SETUP);
    try {
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      server.refuseKey = "wrongkey";
      await fill(A, { "tenant-key": "wrongkey", "server-url": server.url });
      server.requests.length = 0;
      await confirm(A);
      R.ck(await A.until("/did not accept the tenant key/.test(document.getElementById('setup-status').textContent)"), "a key the server does not know is refused with the server's usual message, as in the whole form", await status(A));
      R.ck(server.requests.length === 1 && server.requests[0].url === "/api/register" && server.requests[0].authorization === "Bearer wrongkey", "the key was sent to the server, which decided (nothing was compared on this computer)");
      R.ck((await A.val("document.getElementById('setup-form').dataset.mode")) === "short" && (await detailsHidden(A)), "the form stays the short one: a wrong key does not bring the whole form");
      R.ck((await A.val("document.getElementById('tenant-key').getAttribute('aria-invalid')")) === "true" && (await A.val("document.getElementById('tenant-key').value")) === "wrongkey", "the key box is marked and keeps what was typed");
      R.ck(!fs.existsSync(box.config), "no settings file was written, and the app did not close");
      await fill(A, { "tenant-key": "goodkey" });
      server.requests.length = 0;
      await confirm(A);
      R.ck(await A.until("/Activated/.test(document.getElementById('setup-status').textContent)"), "correcting the key and confirming again activates the shop");
      const sent = server.requests.find((r) => r.url === "/api/register");
      R.ck(sent?.authorization === "Bearer goodkey" && sent?.body?.name === "Maison Clair", "with the saved details", JSON.stringify(sent?.body));
    } catch (error) {
      R.ck(false, "wrong key: ERR", String(error.stack).slice(0, 500));
    } finally {
      server.refuseKey = null;
      await A.stop();
    }
  }

  R.section("nothing usable saved: the whole form");
  for (const [label, seed] of [
    ["a database with no licence row", `await p.tenant.create({ data: { key: 'goodkey', host: 'h', name: 'T' } });`],
    ["a licence row with no shop name", `await p.tenant.create({ data: { key: 'goodkey', host: 'h', name: 'T' } }); await p.licenseExpiry.create({ data: { id: 1, phone: '0550 00 00 00' } });`],
  ]) {
    const A = await launchApp(withDatabase(seed), {}, SETUP);
    try {
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      R.ck((await A.val("document.getElementById('setup-form').dataset.mode")) === "full" && (await detailsShown(A)), `${label}: the whole form`);
    } catch (error) {
      R.ck(false, `${label}: ERR`, String(error.stack).slice(0, 300));
    } finally {
      await A.stop();
    }
  }
  {
    const box = sandbox("op-setupsaved-none-");
    const A = await launchApp(box, {}, SETUP);
    try {
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await sleep(500);
      R.ck((await A.val("document.getElementById('setup-form').dataset.mode")) === "full" && (await detailsShown(A)) && !fs.existsSync(box.db), "no database at all: the whole form, and looking did not make a database");
    } catch (error) {
      R.ck(false, "no database: ERR", String(error.stack).slice(0, 300));
    } finally {
      await A.stop();
    }
  }

  R.section("French");
  {
    const A = await launchApp(withDatabase(SHOP), {}, SETUP);
    try {
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
      await sleep(900);
      R.ck(/déjà les informations de votre magasin/.test(await A.val("document.getElementById('setup-intro').textContent")), "the short form's text is translated");
      const missing = (await A.val("[...window.i18n.missing]")).filter((s) => !/^(0ad726ca|https?:|hello@|12 Rue)/.test(s)); // (the examples shown inside the empty boxes are not translated)
      R.ck(missing.length === 0, "and every text of the page has a translation", JSON.stringify(missing));
    } catch (error) {
      R.ck(false, "French: ERR", String(error.stack).slice(0, 300));
    } finally {
      await A.stop();
    }
  }

  server.close();
  process.exit(R.done());
})();
