// The expiry day saved on this computer: when the settings are complete and the saved day is before today (UTC), the app does not start: a page says the
// licence ended, and nothing runs behind it (no sync, no categories stored, no app window). Today, a later day, or no saved day: the app starts as usual.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const EXPIRED = /renderer[\\/]expired\.html/;
const APP = /renderer[\\/]index\.html/;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** A sandbox with complete settings and, if given, an expiry day already saved in its local database. */
function withExpiry(saved) {
  const box = sandbox("op-expiry-");
  box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  if (saved !== null) runScript(box, `await p.licenseExpiry.create({ data: { id: 1, expiresAt: new Date(${JSON.stringify(saved + "T00:00:00Z")}) } });`);
  return box;
}
const categories = (box) => Number(/COUNT (\d+)/.exec(runScript(box, "console.log('COUNT ' + (await p.category.count()));"))?.[1]);
const pages = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url);

(async () => {
  R.section("expired");
  for (const [label, offset] of [["yesterday", -1], ["two years ago", -730]]) {
    const saved = day(offset);
    const box = withExpiry(saved);
    const A = await launchApp(box, {}, EXPIRED);
    try {
      R.ck(await A.until("document.documentElement.dataset.ready === 'true'"), `${label}: the expired page opens instead of the app`);
      R.ck(await A.val("document.querySelector('.setup__title').textContent === 'Your licence has expired'"), `${label}: it says the licence has expired`);
      R.ck(await A.val(`(() => { const text = document.getElementById('expired-text').textContent; return /licence has ended/.test(text) && !/[0-9]/.test(text); })()`), `${label}: it says the licence has ended, and names no date (no digits at all)`);
      R.ck(await A.val("typeof window.electronAPI === 'undefined' && typeof window.setupAPI === 'undefined'"), `${label}: it has no access to the app`);
      await sleep(1500);
      R.ck(!(await pages(A.port)).some((u) => APP.test(u)), `${label}: the app's own window is not opened`);
      R.ck(categories(box) === 0, `${label}: nothing of the app started (the categories were not stored)`);
      R.ck(A.log().includes("[license] asking ") && A.log().includes("[license] the server did not answer") && A.log().includes("-> expired") && A.log().includes("[license] expired on"), `${label}: the log says it asked the server, got no answer, and why the app did not start`);
      if (offset === -1) {
        await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
        await sleep(900);
        R.ck(await A.until("document.querySelector('.setup__title').textContent === 'Votre licence a expiré' && /Veuillez contacter le support/.test(document.getElementById('expired-text').textContent)"), "and the page is translated (French)");
        await A.val("(() => { window.i18n.setLang('ar', { persist: false }); return 1; })()");
        await sleep(900);
        R.ck(await A.until("document.documentElement.dir === 'rtl' && document.querySelector('.setup__title').textContent === 'انتهت صلاحية ترخيصك'"), "and Arabic, right to left");
        const missing = await A.val("[...window.i18n.missing]");
        R.ck(missing.length === 0, "every text of the page has a translation", JSON.stringify(missing));
      }
      R.ck(A.problems.length === 0, `${label}: no errors in the page`, A.problems.join(" | "));
    } catch (error) {
      R.ck(false, `${label}: ERR`, String(error.stack).slice(0, 300));
    } finally {
      await A.stop();
    }
  }

  R.section("still valid");
  for (const [label, saved] of [["today", day(0)], ["tomorrow", day(1)], ["in two weeks", day(14)], ["no expiry saved", null]]) {
    const box = withExpiry(saved);
    const A = await launchApp(box, {}, APP);
    try {
      R.ck(await A.until("document.querySelector('.nav-item') !== null && typeof window.electronAPI?.customers?.list === 'function'"), `${label}: the app starts as usual`);
      R.ck(categories(box) > 0, `${label}: and everything behind it ran (the categories were stored)`);
      R.ck(A.log().includes("[startup] server check: offline") && A.log().includes("[startup] ready: opening the main window"), `${label}: the log shows the server check and that the main window opened`);
    } finally {
      await A.stop();
    }
  }
  process.exit(R.done());
})();
