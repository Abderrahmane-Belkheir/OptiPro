// The top bar: no notification bell, and the menu behind the round button holds only the language (no Profile, no Preferences, no Sign out). The language still can be chosen with the
// mouse and with the keyboard, and the menu opens and closes as before.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-topbar-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
runScript(box, `await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });`);

(async () => {
  const A = await launchApp(box);
  try {
    await A.until("document.readyState === 'complete' && !!document.getElementById('profile-button') && document.querySelector('[data-lang=en]')?.getAttribute('aria-checked') !== null && document.querySelector('[data-lang=en]').getAttribute('aria-checked') !== 'undefined'", 20000);
    await sleep(300); // (the page has finished loading: the scripts at its end have run)
    const text = () => A.val("document.querySelector('.topbar').textContent.replace(/\\s+/g, ' ')");
    R.section("the top bar");
    R.ck(!(await A.val("!!document.querySelector('.topbar [aria-label=Notifications], .topbar .icon-button')")), "no notification bell");
    R.ck(!(await A.val("!!document.querySelector('.topbar__separator')")), "and no separator left where it was");
    R.ck(!/Profile|Preferences|Sign out|Notifications/.test(await A.val("document.documentElement.textContent")), "the words Profile, Preferences, Sign out and Notifications are nowhere in the app");
    R.ck(!(await A.val("!!document.querySelector('[role=menuitem]')")), "the menu has no ordinary entries left");

    R.section("the menu that is left");
    await A.val("document.getElementById('profile-button').click()");
    R.ck((await A.val("document.getElementById('profile-menu').hidden")) === false && (await A.val("document.getElementById('profile-button').getAttribute('aria-expanded')")) === "true", "the round button opens the menu");
    R.ck((await A.val("[...document.querySelectorAll('#profile-menu [role=menuitemradio]')].map((b) => b.dataset.lang).join()")) === "en,fr,ar", "it holds English, Français and العربية");
    R.ck((await A.val("document.querySelector('#profile-menu .menu__label').textContent")) === "Language", "under the heading Language");
    R.ck((await A.val("[...document.querySelectorAll('#profile-menu .menu__item')].length")) === 3 && !(await A.val("!!document.querySelector('#profile-menu .menu__separator')")), "three entries and no separator");
    R.ck((await A.val("document.querySelector('#profile-menu [data-lang=en]').getAttribute('aria-checked')")) === "true", "the language in use is ticked");
    await A.val("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    R.ck((await A.val("document.getElementById('profile-menu').hidden")) === true, "Escape closes it");

    R.section("the keyboard");
    await A.val("document.getElementById('profile-button').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
    R.ck((await A.val("document.activeElement?.dataset.lang")) === "en", "the arrow down opens it and lands on the first language");
    await A.val("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
    R.ck((await A.val("document.activeElement?.dataset.lang")) === "fr", "the next arrow goes to the next one");
    await A.val("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))");
    R.ck((await A.val("document.activeElement?.dataset.lang")) === "ar", "End goes to the last");
    await A.val("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
    R.ck((await A.val("document.activeElement?.dataset.lang")) === "en", "and it wraps round to the first");

    R.section("choosing a language");
    await A.val("document.querySelector('#profile-menu [data-lang=fr]').click()");
    R.ck(await A.until("window.i18n?.lang === 'fr' && document.documentElement.lang === 'fr'", 15000), "French is chosen: the window is in French");
    await sleep(500);
    R.ck((await A.val("document.getElementById('profile-button').getAttribute('aria-label')")) === "Menu de la langue", "the button's label is translated");
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
