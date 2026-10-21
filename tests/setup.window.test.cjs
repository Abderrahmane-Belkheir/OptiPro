// The first-run setup. While the settings file is missing, or lacks tenant.key or server.url, the app does not start: the setup page opens (and nothing
// behind it runs: no database is made). Confirm sends the shop's details to POST <server.url>/api/register:
//   200 registered -> the settings file is written (tenant.key and server.url) and the app starts
//   400 / 413      -> the form stays open with the server's words
//   401, 429, 5xx, a strange answer, no network -> the form stays open with a message, nothing is written (the app never closes because of it)
// A small local server stands in for the real one.
const fs = require("node:fs");
const http = require("node:http");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const SETUP = /renderer[\\/]setup\.html/;
const APP = /renderer[\\/]index\.html/;

/** A fake /api/register: answers what it is told to, remembers what it was sent. */
async function fakeServer() {
  const server = { status: 200, body: { registered: true, tenant: {}, expiry: "2030-01-01" }, requests: [] };
  const http_ = http.createServer((req, res) => {
    let data = "";
    req.on("data", (d) => (data += d));
    req.on("end", () => {
      server.requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: data ? JSON.parse(data) : null });
      res.writeHead(server.status, { "content-type": "application/json" });
      res.end(JSON.stringify(server.body));
    });
  });
  await new Promise((resolve) => http_.listen(0, "127.0.0.1", resolve));
  server.url = `http://127.0.0.1:${http_.address().port}`;
  server.close = () => http_.close();
  return server;
}

/** A fresh sandbox with the given settings file (null = no file). */
function fresh(lines) {
  const box = sandbox("op-setup-");
  if (lines !== null) box.writeConfig(lines);
  return box;
}

const FORM = { "tenant-key": "goodkey", "server-url": "", "shop-name": "Maison Clair", "shop-phone": "+213 550 00 00 00", "shop-email": "hello@maison-clair.example.com", "shop-address": "", "shop-instagram": "", "shop-tiktok": "" };
async function fill(A, values) {
  await A.val(`(() => { for (const [id, v] of Object.entries(${JSON.stringify(values)})) { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } return 1; })()`);
}
const confirm = (A) => A.val("(() => { document.getElementById('setup-confirm').click(); return 1; })()");
const status = (A) => A.val("document.getElementById('setup-status').hidden ? '' : document.getElementById('setup-status').textContent");

/** True once the app can no longer be reached on its debugging port (it has exited). */
async function exited(port, ms = 10000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(800) });
    } catch {
      return true;
    }
    await sleep(300);
  }
  return false;
}
/** The pages the app has open. */
const pages = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url);

async function expectSetup(label, lines) {
  const box = fresh(lines);
  const A = await launchApp(box, {}, SETUP);
  try {
    R.ck(await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'"), `${label}: the setup page opens`);
    R.ck(await A.val("typeof window.electronAPI === 'undefined' && typeof window.setupAPI?.confirm === 'function'"), `${label}: and it has only setupAPI, no electronAPI`);
    await sleep(800);
    R.ck(!fs.existsSync(box.db), `${label}: the app did not start: no local database was made`);
    return { A, box };
  } catch (error) {
    R.ck(false, `${label}: ERR`, String(error.stack).slice(0, 300));
    return { A, box };
  }
}

(async () => {
  R.section("the app does not start");
  const first = await expectSetup("missing file", null);
  try {
    R.section("the form");
    const A = first.A;
    const fields = await A.val("['tenant-key','server-url','shop-name','shop-phone','shop-email','shop-address','shop-instagram','shop-tiktok'].filter((id) => document.getElementById(id)).length");
    const hasHostField = await A.val("!!document.getElementById('shop-host') || !!document.querySelector('[name=host]')");
    R.ck(fields === 8 && !hasHostField, "tenant key, server url and the shop's details are all there (no website address: the host is set by hand on the server)", String(fields));

    // the whole form can be reached in a small window: the page scrolls, down to the social networks and the Confirm button
    R.ck(await A.val("getComputedStyle(document.body).overflowY !== 'hidden'"), "the page scrolls (it is not cut off in a small window)");
    R.ck(await A.val("(() => { const b = document.getElementById('setup-confirm'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1 && r.top >= 0; })()"), "and scrolling brings the Confirm button (and the social networks above it) into view");
    await A.val("(() => { window.scrollTo(0, 0); document.body.scrollTop = 0; return 1; })()");
    // a form that is wrong: no request, a message, the field marked
    const spy = await fakeServer();
    await confirm(A);
    await A.until("document.getElementById('setup-status').textContent !== ''");
    R.ck((await status(A)) === "Enter the tenant key." && (await A.val("document.getElementById('tenant-key').getAttribute('aria-invalid') === 'true'")), "an empty form: asks for the tenant key and marks the field");
    await fill(A, { "tenant-key": "bad key!" });
    await confirm(A);
    R.ck(await A.until("/letters, digits/.test(document.getElementById('setup-status').textContent)"), "a tenant key with a space or a symbol is refused before anything is sent");
    await fill(A, { "tenant-key": "goodkey" });
    await confirm(A);
    R.ck(await A.until("document.getElementById('setup-status').textContent === 'Enter the server address.'"), "then the server address is asked for");
    await fill(A, { "server-url": "ftp://x" });
    await confirm(A);
    R.ck(await A.until("/web address/.test(document.getElementById('setup-status').textContent)"), "an address that is not http(s) is refused");
    await fill(A, { "server-url": spy.url });
    await confirm(A);
    R.ck(await A.until("document.getElementById('setup-status').textContent === \"Enter the shop's name.\""), "then the shop's name");
    R.ck(spy.requests.length === 0 && !fs.existsSync(first.box.config), "none of that sent anything or wrote anything");
    R.ck(A.problems.length === 0, "no errors in the page", A.problems.join(" | "));

    // languages
    await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
    await sleep(900);
    R.ck(await A.until("document.querySelector('.setup__title').textContent === 'Configurez votre boutique'"), "the page is translated (French)");
    await fill(A, { "tenant-key": "", "server-url": "" });
    await confirm(A);
    R.ck(await A.until("document.getElementById('setup-status').textContent === 'Saisissez la clé de la boutique.'"), "and so are its messages");
    await A.val("(() => { window.i18n.setLang('ar', { persist: false }); return 1; })()");
    await sleep(900);
    R.ck(await A.until("document.documentElement.dir === 'rtl' && document.querySelector('.setup__title').textContent === 'قم بإعداد متجرك'"), "and Arabic, right to left");
    const missing = await A.val("[...window.i18n.missing].filter((s) => !/^(0ad7|https?:|maison|hello|\\+213|12 Rue)/.test(s))");
    R.ck(missing.length === 0, "every text of the page has a translation", JSON.stringify(missing));
    spy.close();
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 400));
  } finally {
    await first.A.stop();
  }

  R.section("incomplete settings");
  for (const [label, lines] of [["no tenant.key", ["server.url=https://shop.example.com"]], ["empty tenant.key", ["tenant.key=", "server.url=https://shop.example.com"]], ["no server.url", ["tenant.key=t1"]], ["empty server.url", ["tenant.key=t1", "server.url="]]]) {
    const { A } = await expectSetup(label, lines);
    await A.stop();
  }

  // ---- Confirm
  const server = await fakeServer();

  R.section("activated");
  {
    const box = fresh(["label.width=50", "tenant.key=", "# a comment"]); // a settings file without a usable key: other lines must survive
    const A = await launchApp(box, {}, SETUP);
    try {
      server.requests.length = 0;
      server.status = 200;
      server.body = { registered: true, tenant: {}, expiry: "2030-01-01" };
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await fill(A, { ...FORM, "server-url": server.url + "/" });
      await confirm(A);
      R.ck(await A.until("/Activated/.test(document.getElementById('setup-status').textContent)"), "the server accepts: the page says Activated");
      const sent = server.requests[0];
      R.ck(sent && sent.method === "POST" && sent.url === "/api/register", "the details are sent with POST /api/register (the trailing slash of the address is dropped)", JSON.stringify(sent && [sent.method, sent.url]));
      R.ck(sent?.authorization === "Bearer goodkey", "the tenant key is the Authorization header");
      R.ck(JSON.stringify(sent?.body) === JSON.stringify({ name: "Maison Clair", phone: "+213 550 00 00 00", email: "hello@maison-clair.example.com" }), "the body holds the shop's details only (no key, no server address, no empty fields)", JSON.stringify(sent?.body));
      let appeared = false;
      for (let i = 0; i < 60 && !appeared; i++) {
        appeared = (await pages(A.port)).some((u) => APP.test(u));
        if (!appeared) await sleep(250);
      }
      R.ck(appeared, "the app starts: its own window opens");
      await sleep(800);
      R.ck(!(await pages(A.port)).some((u) => SETUP.test(u)), "and the setup window is gone");
      const config = fs.readFileSync(box.config, "utf8");
      R.ck(/^tenant\.key=goodkey$/m.test(config) && config.includes(`server.url=${server.url}\n`), "the settings file holds tenant.key and server.url (without the trailing slash)", config.replace(/\n/g, " | "));
      R.ck(/^label\.width=50$/m.test(config) && /^# a comment$/m.test(config) && (config.match(/^tenant\.key=/gm) || []).length === 1, "and the other lines of an existing file are kept, the key written once");
      R.ck(fs.existsSync(box.db), "the local database is made now");
      const stored = JSON.parse(/EXPIRY (.*)/.exec(runScript(box, "console.log('EXPIRY ' + JSON.stringify((await p.licenseExpiry.findMany()).map((r) => [r.id, r.expiresAt.toISOString().slice(0, 10)])));"))?.[1] ?? "null");
      R.ck(JSON.stringify(stored) === JSON.stringify([[1, "2030-01-01"]]), "and the expiry day the server answered is saved in the local license_expiry table", JSON.stringify(stored));
    } catch (error) {
      R.ck(false, "activated: ERR", String(error.stack).slice(0, 400));
    } finally {
      await A.stop();
    }
  }
  {
    const box = fresh(null);
    const A = await launchApp(box, {}, SETUP);
    try {
      server.status = 200;
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await fill(A, { ...FORM, "server-url": server.url });
      await confirm(A);
      for (let i = 0; i < 60 && !fs.existsSync(box.config); i++) await sleep(250);
      R.ck(fs.existsSync(box.config) && /tenant\.key=goodkey/.test(fs.readFileSync(box.config, "utf8")), "with no settings file at all, the file is created");
    } finally {
      await A.stop();
    }
  }

  R.section("the details are wrong: the form stays open");
  for (const [label, status_, body, field] of [
    ["400 INVALID_FIELD", 400, { error: '"email" must be an e-mail address.', code: "INVALID_FIELD", field: "email" }, "shop-email"],
    ["400 INVALID_FIELD (name)", 400, { error: '"name" is longer than 120 characters.', code: "INVALID_FIELD", field: "name" }, "shop-name"],
  ]) {
    const box = fresh(null);
    const A = await launchApp(box, {}, SETUP);
    try {
      server.status = status_;
      server.body = body;
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await fill(A, { ...FORM, "server-url": server.url });
      await confirm(A);
      R.ck(await A.until(`document.getElementById('setup-status').textContent === ${JSON.stringify(body.error)}`), `${label}: the server's words are shown`);
      R.ck(await A.val(`document.getElementById('${field}').getAttribute('aria-invalid') === 'true' && !document.getElementById('setup-confirm').disabled`), `${label}: the field is marked and Confirm can be pressed again`);
      await sleep(3500);
      R.ck((await pages(A.port)).some((u) => SETUP.test(u)) && !fs.existsSync(box.config), `${label}: the app is still open, nothing was written`);
    } finally {
      await A.stop();
    }
  }

  R.section("the form stays open whatever the server says");
  for (const [label, status_, body, field, words] of [
    ["401 UNAUTHORIZED (unknown or expired key)", 401, { error: "A valid tenant key is required", code: "UNAUTHORIZED" }, "tenant-key", /did not accept the tenant key/],
    ["429 too many wrong keys", 429, { error: "slow down", code: "TOO_MANY_ATTEMPTS" }, null, /Too many attempts/],
    ["500 server error", 500, { error: "boom", code: "SERVER_ERROR" }, null, /could not complete the activation/],
    ["404 (a server that has no such endpoint)", 404, { error: "Not found." }, null, /could not complete the activation/],
    ["200 that is not the endpoint's answer", 200, { hello: "world" }, null, /could not complete the activation/],
    ["200 without the expiry day", 200, { registered: true, tenant: {} }, null, /could not complete the activation/],
    ["200 with an expiry that is not a day", 200, { registered: true, tenant: {}, expiry: "soon" }, null, /could not complete the activation/],
  ]) {
    const box = fresh(null);
    const A = await launchApp(box, {}, SETUP);
    try {
      server.status = status_;
      server.body = body;
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await fill(A, { ...FORM, "server-url": server.url });
      await confirm(A);
      R.ck(await A.until(`document.getElementById('setup-status').dataset.tone === 'error' && ${words}.test(document.getElementById('setup-status').textContent)`), `${label}: the form shows what went wrong`);
      R.ck(await A.val(`!document.getElementById('setup-confirm').disabled${field ? ` && document.getElementById('${field}').getAttribute('aria-invalid') === 'true'` : ""}`), `${label}: Confirm can be pressed again${field ? " and the field to correct is marked" : ""}`);
      await sleep(3500);
      R.ck((await pages(A.port)).some((u) => SETUP.test(u)) && !fs.existsSync(box.config), `${label}: the app is still open and nothing was written`);
    } finally {
      await A.stop();
    }
  }
  {
    const box = fresh(null);
    const A = await launchApp(box, {}, SETUP);
    try {
      await A.until("document.getElementById('setup-form')?.dataset.ready === 'true'");
      await fill(A, { ...FORM, "server-url": "http://127.0.0.1:9" }); // nothing listens there
      await confirm(A);
      R.ck(await A.until("/can't be reached/.test(document.getElementById('setup-status').textContent) && document.getElementById('server-url').getAttribute('aria-invalid') === 'true'"), "no network / no server: the form says the server can't be reached and marks the address");
      await sleep(3500);
      R.ck((await pages(A.port)).some((u) => SETUP.test(u)) && !fs.existsSync(box.config), "and the app is still open, nothing written");
      // corrected and sent again: it works
      server.status = 200;
      server.body = { registered: true, tenant: {}, expiry: "2030-01-01" };
      await fill(A, { "server-url": server.url });
      await confirm(A);
      for (let i = 0; i < 60 && !fs.existsSync(box.config); i++) await sleep(250);
      R.ck(fs.existsSync(box.config) && /tenant\.key=goodkey/.test(fs.readFileSync(box.config, "utf8")), "after correcting the address and pressing Confirm again, the shop is activated");
    } finally {
      await A.stop();
    }
  }

  R.section("complete settings");
  {
    const box = fresh(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
    const B = await launchApp(box, {}, APP);
    try {
      R.ck(await B.until("document.querySelector('.nav-item') !== null && typeof window.electronAPI?.customers?.list === 'function'"), "with a tenant.key and a server.url the app starts as usual, without asking the server");
      R.ck(fs.existsSync(box.db), "and the local database is made");
    } finally {
      await B.stop();
    }
  }
  server.close();
  process.exit(R.done());
})();
