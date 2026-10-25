// The sex of a frame (female | male | unisex, stored in lower case) on the Frames page: the filter (All, Female, Male, Unisex), the sex shown on every frame's card and on its details
// page, and the choice on the card that creates a frame and on the one that edits it.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-framesex-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.category.upsert({ where: { id: 1 }, create: { id: 1, name: 'Optical Frames', imageUrl: 'u' }, update: {} });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.brand.create({ data: { id: 'b2', name: 'Oakley', ...S } });
  const frame = (id, name, brandId, gender, code) => p.frame.create({ data: { id, name, brandId, categoryId: 1, gender, code, price: 18500, currency: 'DZD', stock: 2, ...S } });
  await frame('f1', 'Aviator Women', 'b1', 'female', 'aaa-111');
  await frame('f2', 'Wayfarer Men', 'b1', 'male', 'bbb-222');
  await frame('f3', 'Clubmaster Unisex', 'b1', 'unisex', 'ccc-333');
  await frame('f4', 'Old frame, no sex', 'b1', null, 'ddd-444');
  await frame('f5', 'Holbrook Men', 'b2', 'male', 'eee-555');
`,
);

let A;
const chip = (group, label) => A.val(`(() => { const b = [...document.querySelectorAll('.chips[aria-labelledby=frames-${group}-title] .chip')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); b.click(); return 1; })()`);
const sexChip = async (value) => { await A.val(`(() => { document.querySelector('[data-gender-filter] [data-gender=${value}]').click(); return 1; })()`); await sleep(150); };
const shown = () => A.val("[...document.querySelectorAll('.results .frame-card')].map((c) => c.querySelector('.frame-card__name').textContent).sort().join('|')");
const count = () => A.val("document.querySelector('.results__count')?.textContent ?? ''");

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.frames?.create === 'function'", 20000);
    await A.val("(() => { location.hash = 'inventory/frames'; return 1; })()");
    await A.until("document.querySelectorAll('.chips[aria-labelledby=frames-brand-title] .chip').length === 2");

    R.section("the filter");
    R.ck((await A.val("[...document.querySelectorAll('[data-gender-filter] .chip')].map((c) => c.textContent + ':' + c.getAttribute('aria-pressed')).join()")) === "All:true,Female:false,Male:false,Unisex:false", "the page has a Sex filter: All (chosen), Female, Male, Unisex");
    await chip("category", "Optical Frames");
    await chip("brand", "Ray-Ban");
    await A.until("document.querySelectorAll('.results .frame-card').length === 4");
    R.ck((await shown()) === "Aviator Women|Clubmaster Unisex|Old frame, no sex|Wayfarer Men", "All: every frame of the brand, with or without a sex");
    await sexChip("female");
    R.ck((await shown()) === "Aviator Women" && (await count()) === "1 frame", "Female: only the female frames", await shown());
    await sexChip("male");
    R.ck((await shown()) === "Wayfarer Men", "Male: only the male frames");
    await sexChip("unisex");
    R.ck((await shown()) === "Clubmaster Unisex", "Unisex: only the unisex frames");
    await sexChip("all");
    R.ck((await shown()).split("|").length === 4 && (await count()) === "4 frames", "All again: every frame");

    R.ck(await A.val("(() => { const sex = document.querySelector('[data-gender-filter]').getBoundingClientRect().top; const cat = document.querySelector('.chips[aria-labelledby=frames-category-title]').getBoundingClientRect().top; const brand = document.querySelector('.chips[aria-labelledby=frames-brand-title]').getBoundingClientRect().top; return sex < cat && sex < brand; })()"), "the Sex filter is above the Category and the Brand choosers");

    R.section("the sex on every card");
    const sexes = await A.val("Object.fromEntries([...document.querySelectorAll('.results .frame-card')].map((c) => [c.querySelector('.frame-card__name').textContent, c.querySelector('[data-sex]').textContent + '/' + c.querySelector('[data-sex]').dataset.sex]))");
    R.ck(sexes["Aviator Women"] === "Female/female" && sexes["Wayfarer Men"] === "Male/male" && sexes["Clubmaster Unisex"] === "Unisex/unisex", "each card says Female, Male or Unisex", JSON.stringify(sexes));
    R.ck(sexes["Old frame, no sex"] === "Sex not set/", "a frame with no sex says so (so it can be filled in)", JSON.stringify(sexes));

    R.section("the filter with a search, and a brand with none");
    await A.val("(() => { const e = document.getElementById('frames-search'); e.focus(); e.value = 'a'; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
    await sleep(700);
    await sexChip("male");
    R.ck((await shown()).split("|").every((n) => /Men/.test(n)) && (await shown()) !== "", "the frames found follow the filter too", await shown());
    await A.val("(() => { const e = document.getElementById('frames-search'); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
    await sleep(500);
    await chip("brand", "Oakley");
    await sexChip("female");
    await A.until("!!document.querySelector('.results .state')");
    R.ck((await A.val("document.querySelector('.results .state__title').textContent")) === "No frame for this sex", "a brand with no frame of that sex says so (and how to see them all)");
    await sexChip("all");

    R.section("the card that creates a frame");
    await chip("brand", "Ray-Ban");
    for (const [filter, expected] of [["male", "male"], ["unisex", "unisex"], ["female", "female"], ["all", ""]]) {
      await sexChip(filter);
      await A.val("document.getElementById('add-frame').click()");
      await A.until("!!document.querySelector('dialog[open] [name=gender]')");
      R.ck((await A.val("document.querySelector('dialog[open] [name=gender]').value")) === expected, `with the filter on ${filter}, the new frame's Sex starts as ${expected === "" ? "Not specified" : expected}`);
      await A.val("document.querySelectorAll('dialog[open]').forEach((d) => d.close())");
      await sleep(150);
    }
    await sexChip("female");
    await A.val("document.getElementById('add-frame').click()");
    await A.until("!!document.querySelector('dialog[open] [name=gender]')");
    await A.val("(() => { const e = document.querySelector('dialog[open] [name=gender]'); e.value = 'male'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    R.ck((await A.val("document.querySelector('dialog[open] [name=gender]').value")) === "male", "and it can be changed on the card");
    await A.val("document.querySelectorAll('dialog[open]').forEach((d) => d.close())");
    await sleep(150);
    await sexChip("all");
    await A.val("document.getElementById('add-frame').click()");
    await A.until("!!document.querySelector('dialog[open] [name=gender]')");
    R.ck((await A.val("[...document.querySelector('dialog[open] [name=gender]').options].map((o) => o.value + '=' + o.textContent).join()")) === "=Not specified,female=Female,male=Male,unisex=Unisex", "it offers Not specified, Female, Male and Unisex (the values are lower case)");
    await A.val("(() => { const d = document.querySelector('dialog[open]'); const set = (n, v) => { const e = d.querySelector('[name=' + n + ']'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; set('name', 'Created with a sex'); set('gender', 'female'); d.querySelector('[data-action=create], button[type=submit]').click(); return 1; })()");
    await A.until("!document.querySelector('dialog[open]')", 10000);
    const created = await A.val("window.electronAPI.frames.search('Created with a sex', 5, 'model').then((r) => r[0]?.id)");
    R.ck((await A.val(`window.electronAPI.frames.get(${JSON.stringify(created)})`)).gender === "female", "a frame created with Female is stored as female");
    await A.until("[...document.querySelectorAll('.results .frame-card')].some((c) => c.textContent.includes('Created with a sex'))");
    R.ck(await A.val("[...document.querySelectorAll('.results .frame-card')].find((c) => c.textContent.includes('Created with a sex')).querySelector('[data-sex]').textContent === 'Female'"), "and its card says Female");

    R.section("the card that edits a frame");
    await A.val("document.querySelector('.results .frame-card[data-id=f2] [data-action=edit]').click()");
    await A.until("!!document.querySelector('dialog[open] [name=gender]')");
    R.ck((await A.val("document.querySelector('dialog[open] [name=gender]').value")) === "male", "it shows the sex the frame has");
    await A.val("(() => { const e = document.querySelector('dialog[open] [name=gender]'); e.value = 'unisex'; e.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('dialog[open] [data-action=save]').click(); return 1; })()");
    await A.until("!document.querySelector('dialog[open]')", 10000);
    R.ck((await A.val("window.electronAPI.frames.get('f2')")).gender === "unisex", "changing it to Unisex saves unisex");
    await A.until("document.querySelector('.results .frame-card[data-id=f2] [data-sex]')?.textContent === 'Unisex'");
    R.ck(true, "and the card follows");
    await A.val("document.querySelector('.results .frame-card[data-id=f4] [data-action=edit]').click()");
    await A.until("!!document.querySelector('dialog[open] [name=gender]')");
    R.ck((await A.val("document.querySelector('dialog[open] [name=gender]').value")) === "", "a frame with no sex shows Not specified");
    await A.val("document.querySelectorAll('dialog[open]').forEach((d) => d.close())");

    R.section("the details page");
    await A.val("(() => { location.hash = 'inventory/frames/f1'; return 1; })()");
    await A.until("!!document.querySelector('[data-row=gender]')");
    R.ck((await A.val("document.querySelector('[data-row=gender] dd').textContent")) === "Female", "a frame's details say Sex: Female");
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
