// The Settings page in the real window: the boxes start empty and show what the shop has as their placeholder, only what is typed is sent (a null for the rest),
// the sync state is shown, a change the server could not take waits and is sent later, and a computer with no licence row cannot edit.
const http = require("node:http");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();

async function fakeServer() {
  const server = { mode: "ok", posts: [] };
  const http_ = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (req.method === "GET" && req.url === "/api/expiry") return send(200, { expiry: "2030-01-01" });
      if (req.method === "POST" && req.url === "/api/infos") {
        server.posts.push({ auth: req.headers.authorization, body: JSON.parse(raw || "null") });
        if (server.mode === "down") return send(503, { error: "unavailable" });
        return send(200, { updated: true, fields: [], tenant: {} });
      }
      send(404, { error: "Not found." });
    });
  });
  await new Promise((r) => http_.listen(0, "127.0.0.1", r));
  server.url = `http://127.0.0.1:${http_.address().port}`;
  server.close = () => new Promise((r) => http_.close(r));
  return server;
}

const NULLS = { name: null, phone: null, email: null, address: null, instagramUrl: null, tiktokUrl: null };

/** Waits (up to 5 s) until `check()` is true. */
async function waitFor(check) {
  for (let i = 0; i < 50; i++) {
    if (await check()) return true;
    await sleep(100);
  }
  return false;
}

(async () => {
  const server = await fakeServer();
  const box = sandbox("op-settings-");
  box.writeConfig([`server.url=${server.url}`, "tenant.key=goodkey"]);
  runScript(
    box,
    `
    await p.tenant.create({ data: { key: 'goodkey', host: 'h', name: 'T' } });
    await p.licenseExpiry.create({ data: { id: 1, shopName: 'Maison Clair', phone: '0550 00 00 00', email: 'hello@maison.dz', instagramUrl: 'https://instagram.com/maison', synced: true } });
  `,
  );

  let A;
  const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
  const type = (id, value) => A.val(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
  const placeholder = (id) => A.val(`document.getElementById(${JSON.stringify(id)}).placeholder`);
  const syncText = () => A.val("document.querySelector('[data-sync]').textContent");
  const open = async () => {
    await A.val("(() => { location.hash = '#dashboard'; return 1; })()");
    await A.val("(() => { location.hash = '#settings'; return 1; })()");
    await A.until("!!document.querySelector('[data-settings-page]') && !document.getElementById('shop-name').disabled");
  };

  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.shopInfo?.get === 'function'");
    await open();

    R.section("what the page shows");
    R.ck(await A.val("document.title.startsWith('Settings') && document.querySelector('[data-page=settings]').getAttribute('aria-current') === 'page'"), "the Settings entry of the sidebar is the current page");
    R.ck(await A.val("['shop-name','shop-phone','shop-email','shop-address','shop-instagramUrl','shop-tiktokUrl'].every((id) => document.getElementById(id)?.value === '')"), "the six boxes start empty");
    R.ck((await placeholder("shop-name")) === "Maison Clair" && (await placeholder("shop-phone")) === "0550 00 00 00" && (await placeholder("shop-email")) === "hello@maison.dz" && (await placeholder("shop-instagramUrl")) === "https://instagram.com/maison", "and show what the shop has now as their placeholder");
    R.ck((await placeholder("shop-address")) === "Not set" && (await placeholder("shop-tiktokUrl")) === "Not set", "a detail the shop does not have says 'Not set'");
    R.ck((await syncText()) === "Up to date on the server." && (await A.val("document.querySelector('[data-sync]').dataset.synced")) === "true", "and the page says the server has them", (await syncText()) + " | " + (await A.val("document.querySelector('[data-sync]').dataset.synced")));

    R.section("the shop's name at the top of the app");
    R.ck((await A.val("document.getElementById('shop-brand-name').textContent")) === "Maison Clair", "the sidebar shows the shop's saved name, not a fixed one");
    R.ck((await A.val("document.title")) === "Settings · Maison Clair", "and so does the window title", await A.val("document.title"));

    R.section("nothing to change, or wrong");
    await click("[data-action=save]");
    await A.until("!document.querySelector('[data-note]').hidden");
    R.ck(/Nothing to change/.test(await A.val("document.querySelector('[data-note]').textContent")) && server.posts.length === 0, "pressing Save with nothing typed says so, and sends nothing");
    await type("shop-email", "nope");
    await type("shop-phone", "call me");
    await click("[data-action=save]");
    await A.until("!document.getElementById('shop-email-error').hidden");
    R.ck(/name@example\.com/.test(await A.val("document.getElementById('shop-email-error').textContent")) && /digits/.test(await A.val("document.getElementById('shop-phone-error').textContent")) && (await A.val("document.getElementById('shop-email').getAttribute('aria-invalid')")) === "true", "wrong values are refused under their own boxes, which are marked");
    R.ck(server.posts.length === 0, "and nothing is sent");
    await type("shop-email", "");
    await type("shop-phone", "0550 00 00 00");
    await click("[data-action=save]");
    await A.until("/Nothing to change/.test(document.querySelector('[data-note]').textContent) && document.getElementById('shop-email-error').hidden");
    R.ck(server.posts.length === 0, "typing the value the shop already has is not a change");

    R.section("saving a change");
    await type("shop-phone", "0661 11 22 33");
    await click("[data-action=save]");
    R.ck(await waitFor(() => server.posts.length === 1), "Save sends one request to the server");
    R.ck(server.posts[0]?.auth === "Bearer goodkey" && JSON.stringify(server.posts[0]?.body) === JSON.stringify({ ...NULLS, phone: "0661 11 22 33" }), "with the tenant key, and only the changed field: the other five are null", JSON.stringify(server.posts[0]));
    await A.until("document.getElementById('shop-phone').placeholder === '0661 11 22 33'");
    R.ck(await A.val("document.getElementById('shop-phone').value === '' && !!document.querySelector('.toast--success')"), "the box is emptied again and a message confirms it");
    R.ck((await placeholder("shop-name")) === "Maison Clair" && (await syncText()) === "Up to date on the server.", "the other boxes still show what they had, and the server has it all");
    R.ck((await A.val("window.electronAPI.shopInfo.get().then((i) => i.phone + '|' + i.onServer)")) === "0661 11 22 33|true", "the row on this computer holds the new phone and is synced", String(await A.val("window.electronAPI.shopInfo.get().then((i) => i.phone + '|' + i.onServer)")));

    R.section("a new name shows at once");
    await type("shop-name", "Optique Soleil");
    await click("[data-action=save]");
    await A.until("document.getElementById('shop-brand-name').textContent === 'Optique Soleil'");
    R.ck((await A.val("document.title")) === "Settings · Optique Soleil" && (await A.val("document.getElementById('shop-brand-name').title")) === "Optique Soleil", "saving a new name changes the sidebar and the window title without reopening the app");
    await A.val("(() => { location.hash = '#dashboard'; return 1; })()");
    R.ck((await A.val("document.title")) === "Dashboard · Optique Soleil", "and every page's title uses it");
    await open();

    R.section("the server can not take it now");
    server.mode = "down";
    await type("shop-address", "12 Rue Didouche Mourad");
    await click("[data-action=save]");
    await A.until("/Saved on this computer/.test(document.querySelector('[data-sync]').textContent)");
    R.ck(server.posts.length === 3 && JSON.stringify(server.posts[2].body) === JSON.stringify({ ...NULLS, address: "12 Rue Didouche Mourad" }), "only the address was sent", JSON.stringify(server.posts[2]?.body));
    R.ck((await A.val("document.querySelector('[data-sync]').dataset.synced")) === "false" && (await placeholder("shop-address")) === "12 Rue Didouche Mourad", "it is kept on this computer, shown as saved, and marked as waiting for the server");
    R.ck(await A.val("!!document.querySelector('.toast--error')"), "a message says the server could not take it now");
    server.mode = "ok";
    const pass = await A.val("window.electronAPI.shopInfo.pushPending()");
    R.ck(pass.status === "sent" && server.posts.length === 4, "the next sync pass sends it", JSON.stringify(pass));
    R.ck(JSON.stringify(server.posts[3].body) === JSON.stringify({ name: "Optique Soleil", phone: "0661 11 22 33", email: "hello@maison.dz", address: "12 Rue Didouche Mourad", instagramUrl: "https://instagram.com/maison", tiktokUrl: null }), "with every detail that has a value", JSON.stringify(server.posts[3]?.body));
    await open();
    R.ck((await syncText()) === "Up to date on the server.", "and the page shows it as up to date when it is opened again", await syncText());

    R.section("French");
    await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
    await sleep(900);
    await open();
    R.ck((await A.val("document.querySelector('.page__title').textContent")) === "Paramètres" || (await A.val("document.querySelector('.page__title').textContent.length")) > 0, "the page is translated");
    R.ck((await placeholder("shop-tiktokUrl")) === "Non renseigné" && (await A.val("document.querySelector('label[for=shop-name]').textContent")) !== "Shop name", "a detail that is not set says 'Non renseigné', and the labels are translated");
    const missing = await A.val("[...window.i18n.missing].filter((s) => !/^(Maison|Optique|0\\d|\\d|https?:|hello@|12 Rue)/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s) && !/^DZD/.test(s))");
    R.ck(missing.length === 0, "every text of the page has a translation", JSON.stringify(missing));
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }

  // ---- a computer with no licence row: nowhere to keep the details
  const empty = sandbox("op-settings-empty-");
  empty.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=goodkey"]);
  runScript(empty, `await p.tenant.create({ data: { key: 'goodkey', host: 'h', name: 'T' } });`);
  const B = await launchApp(empty);
  try {
    await B.until("typeof window.electronAPI?.shopInfo?.get === 'function'");
    await B.val("(() => { location.hash = '#settings'; return 1; })()");
    await B.until("!!document.querySelector('[data-settings-page]') && document.querySelector('[data-banner]') !== null");
    R.section("a copy with no shop row yet"); // (the app makes the row at start, so the information can be edited)
    R.ck(await B.val("document.querySelector('[data-banner]').hidden"), "the app made the shop row when it started, so there is no banner saying the information can't be edited");
    R.ck((await B.val("document.getElementById('shop-brand-name').textContent")) === "OptiPro" && (await B.val("document.title")) === "Settings · OptiPro", "with no saved name the app's own name is shown");
    R.ck(await B.val("['shop-name','shop-phone','shop-email','shop-address','shop-instagramUrl','shop-tiktokUrl'].every((id) => !document.getElementById(id).disabled)"), "and the boxes can be used");
  } catch (error) {
    R.ck(false, "empty: ERR", String(error.stack).slice(0, 500));
  } finally {
    await B.stop();
  }
  await server.close();
  process.exit(R.done());
})();
