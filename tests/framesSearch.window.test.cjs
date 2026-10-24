// The Frames page search, in the real window: by model and by code, over all the frames when nothing is chosen, narrowed by the brand and the category that are
// chosen, a code that is not a code is refused, the list stays as it was when the box is empty. And the top bar no longer has a search box.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-framessearch-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  for (const [id, name] of [[1, 'Optical Frames'], [2, 'Sunglasses'], [3, 'Kids']]) await p.category.upsert({ where: { id }, create: { id, name, imageUrl: 'u' }, update: {} });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.brand.create({ data: { id: 'b2', name: 'Oakley', ...S } });
  const frame = (id, name, brandId, categoryId, code, reference) => p.frame.create({ data: { id, name, brandId, categoryId, code, reference, price: 18500, currency: 'DZD', stock: 2, ...S } });
  await frame('f1', 'Aviator Classic', 'b1', 1, 'abc-123', 'RB3025');
  await frame('f2', 'Wayfarer', 'b1', 2, 'def-456', 'RB2140');
  await frame('f3', 'Holbrook', 'b2', 2, 'ghi-789', 'OO9102');
  await frame('f4', 'Aviator Pilot', 'b2', 1, 'jkl-012', null);
  for (let i = 1; i <= 65; i++) await frame('t' + i, 'Test frame ' + String(i).padStart(2, '0'), 'b2', 1, 'tst-' + String(100 + i), null);
`,
);

let A;
const settle = () => sleep(500); // the search waits a moment after the last key (150 ms), then answers
const type = (text) => A.val(`(() => { const e = document.getElementById('frames-search'); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const names = () => A.val("[...document.querySelectorAll('.results .frame-card__name')].map((e) => e.textContent).join('|')");
const mode = (m) => A.val(`(() => { document.querySelector('[data-search-modes] [data-mode=${m}]').click(); return 1; })()`);
const chip = (group, label) => A.val(`(() => { const b = [...document.querySelectorAll('.chips[aria-labelledby=frames-${group}-title] .chip')].find((x) => x.textContent === ${JSON.stringify(label)}); b.click(); return 1; })()`);
const count = () => A.val("document.querySelectorAll('.results .frame-card').length");
const hint = () => A.val("document.querySelector('[data-search-hint]').hidden ? '' : document.querySelector('[data-search-hint]').textContent");

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.frames?.searchWithPhotos === 'function'");
    await A.val("(() => { location.hash = '#inventory/frames'; return 1; })()");
    await A.until("!!document.getElementById('frames-search') && document.querySelectorAll('.chips[aria-labelledby=frames-brand-title] .chip').length === 2");

    R.section("the top bar");
    R.ck(await A.val("!document.querySelector('.topbar form.search') && !document.querySelector('.topbar input[type=search]')"), "the search box is gone from the top bar of the app");
    R.ck(await A.val("!!document.querySelector('.topbar .topbar__title') && !!document.querySelector('.topbar__actions')"), "and the rest of the top bar is still there");

    R.section("the search box");
    R.ck(await A.val("[...document.querySelectorAll('[data-search-modes] .chip')].map((b) => b.textContent).join() === 'By model,By code' && document.querySelector('[data-search-modes] [data-mode=model]').getAttribute('aria-pressed') === 'true'"), "two ways to search, By model (the one chosen) and By code");
    R.ck(/Search by model/.test(await A.val("document.getElementById('frames-search').placeholder")), "and the box says what it searches");
    R.ck(await A.val("/Pick to begin/.test(document.querySelector('.results').textContent)"), "with nothing typed and nothing chosen the page is as it was");

    R.section("nothing chosen: the search covers all the frames");
    await type("aviator");
    await settle();
    R.ck((await names()) === "Aviator Classic|Aviator Pilot" && (await A.val("document.querySelector('[data-search-count]').textContent")) === "2 frames", "by model, 'aviator' finds the frames of every brand and category", await names());
    R.ck(await A.val("!document.querySelector('[data-search-scope]') && /Results for/.test(document.querySelector('.results__title').textContent)"), "with no scope shown: only what is typed counts");
    await type("ray");
    await settle();
    R.ck((await names()) === "Aviator Classic|Wayfarer", "the brand is searched too (ray -> the two Ray-Ban frames)", await names());
    await type("rb2140");
    await settle();
    R.ck((await names()) === "Wayfarer", "and the maker's reference");
    await type("zzzz");
    await settle();
    R.ck(await A.val("/No frame matches/.test(document.querySelector('.results').textContent) && /Nothing found for “zzzz”\\./.test(document.querySelector('.results').textContent)"), "nothing found says so");

    R.section("by code");
    await mode("code");
    R.ck(/code/i.test(await A.val("document.getElementById('frames-search').placeholder")), "choosing By code changes the box's text");
    await type("abc");
    await settle();
    R.ck((await names()) === "Aviator Classic", "a code, in part, finds the frame", await names());
    await type("ABC123");
    await settle();
    R.ck((await names()) === "Aviator Classic", "capitals and no dash find it too");
    await type("aviator");
    await settle();
    R.ck((await count()) === 0 && /3 letters, a dash and 3 digits/.test(await hint()) && (await A.val("document.getElementById('frames-search').getAttribute('aria-invalid')")) === "true", "a model name is not a code: nothing is listed and the line under the box says what a code looks like", await hint());
    await mode("model");
    await settle();
    R.ck((await names()) === "Aviator Classic|Aviator Pilot" && (await hint()) === "", "switching back to By model searches what is typed again, and the message goes");

    R.section("the brand and the category that are chosen narrow the search");
    await chip("brand", "Ray-Ban");
    await settle();
    R.ck((await names()) === "Aviator Classic" && (await A.val("document.querySelector('[data-search-scope]').textContent")) === "Ray-Ban", "with a brand chosen, 'aviator' finds only that brand's (and the scope says so)", await names());
    await chip("category", "Sunglasses");
    await settle();
    R.ck((await count()) === 0 && /Nothing found for “aviator” in Sunglasses · Ray-Ban/.test(await A.val("document.querySelector('.results').textContent")), "with a category chosen as well the search is narrowed again, and the message names the scope");
    await type("way");
    await settle();
    R.ck((await names()) === "Wayfarer" && (await A.val("document.querySelector('[data-search-scope]').textContent")) === "Sunglasses · Ray-Ban", "the Wayfarer is a Ray-Ban sunglasses frame: found");
    await type("");
    await settle();
    R.ck(await A.val("!/Results for/.test(document.querySelector('.results').textContent) && document.querySelector('.results__title').textContent.includes('Sunglasses · Ray-Ban')"), "emptying the box brings back the list of the chosen category and brand", await A.val("document.querySelector('.results').textContent.slice(0, 80)"));
    R.ck((await names()) === "Wayfarer", "which has its frames");

    R.section("many results");
    await chip("brand", "Oakley");
    await chip("category", "Optical Frames");
    await type("test frame");
    await settle();
    R.ck((await count()) === 60 && (await A.val("!!document.querySelector('[data-more]')")), "65 frames match: 60 are shown, and it says to keep typing", String(await count()));
    R.ck(await A.val("[...document.querySelectorAll('.results .frame-card')].every((c) => c.querySelector('a[data-action=open-details]'))"), "each card opens the frame's details, like in the list");
    await type("");

    R.section("French");
    await A.val("(() => { window.i18n.setLang('fr', { persist: false }); return 1; })()");
    await sleep(900);
    await A.val("(() => { location.hash = '#dashboard'; return 1; })()");
    await A.val("(() => { location.hash = '#inventory/frames'; return 1; })()");
    await A.until("!!document.getElementById('frames-search')");
    await sleep(300);
    R.ck(/Rechercher par modèle/.test(await A.val("document.getElementById('frames-search').placeholder")) && (await A.val("document.querySelector('[data-search-modes] [data-mode=code]').textContent")) === "Par code", "the box and the ways to search are translated");
    await type("aviator");
    await settle();
    R.ck(/Résultats pour/.test(await A.val("document.querySelector('.results__title').textContent")), "and so are the results");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
