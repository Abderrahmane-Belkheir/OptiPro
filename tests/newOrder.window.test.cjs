// The product pickers of the New order form, in the real window: how to search (By model / By code), nothing listed until something is typed, the list made
// again at every keystroke, the scrollable list, choosing, scanning, and the search icon clear of the text (in English and in Arabic).
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const CASES = require("./helpers/searchCases.json");
const box = sandbox("op-neworder-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina Benali', ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.brand.create({ data: { id: 'b2', name: 'Oakley', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, brandId, reference, code) => p.frame.create({ data: { id, name, brandId, categoryId: 1, reference, code, price: 18500, currency: 'DZD', stock: 2, ...S } });
  await frame('f1', 'Aviator Classic', 'b1', 'RB3025', 'abc-123');
  await frame('f2', 'Wayfarer', 'b1', 'RB2140', 'def-456');
  await frame('f3', 'Holbrook', 'b2', 'OO9102', 'ghi-789');
  for (let i = 1; i <= 25; i++) await frame('t' + i, 'Test frame ' + String(i).padStart(2, '0'), 'b2', null, 'tst-' + String(100 + i));
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: new Date('2026-01-10T00:00:00Z'), rightSphere: -2, rightCylinder: -0.5, rightAxis: 90, leftSphere: -1.5, ...S } });
  const lens = (id, name, over) => p.lens.create({ data: { id, name, brand: 'Essilor', priceCents: 500000, ...over, ...S } });
  await lens('l1', 'Stock 1.5', { sphereMin: -6, sphereMax: 4, cylinderMin: -2, cylinderMax: 0 });
  await lens('l2', 'High power 1.74', { sphereMin: -12, sphereMax: -6, cylinderMin: -2, cylinderMax: 0 });
  await lens('l3', 'Unlimited 1.6', {});
  await lens('l4', 'Retired lens', { isActive: false });
  await p.accessory.create({ data: { id: 'a1', name: 'Hard case', description: 'Protective case', price: 1200, currency: 'DZD', stock: 9, code: 'xyz-111', ...S } });
`,
);

let A;
const pick = (kind) => `document.querySelector('.pick[data-kind=${kind}]')`;
const names = (kind) => A.val(`[...${pick(kind)}.querySelectorAll('.pick-result__name')].map((e) => e.textContent).join('|')`);
const type = (kind, text) => A.val(`(() => { const e = document.querySelector('[data-picker=${kind}]'); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
const mode = (kind, m) => A.val(`(() => { ${pick(kind)}.querySelector('[data-mode=${m}]').click(); return 1; })()`);
const listShown = (kind) => A.val(`!document.querySelector('[data-results=${kind}]').hidden`);
const settle = () => sleep(450); // the search waits a moment after the last key (150 ms), then answers

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.openNewOrderForm === 'function' && typeof window.electronAPI?.frames?.search === 'function'");
    await A.val("(() => { window.openNewOrderForm({ id: 'c1', name: 'Amina Benali' }); return 1; })()");
    await A.until(`!!${pick("frame")}`);

    R.section("at first");
    R.ck(!(await listShown("frame")) && (await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length === 0`)), "nothing is listed: the frames are not shown before anything is typed");
    R.ck(await A.val(`!document.querySelector('[data-hint=frame]').hidden && /Start typing/.test(document.querySelector('[data-hint=frame]').textContent)`), "a hint says to start typing");
    R.ck(!(await listShown("accessory")), "the accessory picker starts empty too");
    R.ck(await A.val(`${pick("frame")}.querySelector('[data-mode=model]').getAttribute('aria-pressed') === 'true' && ${pick("frame")}.querySelector('[data-mode=code]').getAttribute('aria-pressed') === 'false'`), "two ways to search, By model and By code, and By model is the one chosen");
    R.ck(await A.val("/Search by model/.test(document.querySelector('[data-picker=frame]').placeholder)"), "and the box says what it searches");

    R.section("the list follows what is typed");
    await type("frame", "a");
    await A.until(`${pick("frame")}.querySelectorAll('.pick-result').length > 0`);
    const one = await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length`);
    await type("frame", "av");
    await settle();
    const two = await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length`);
    R.ck(one > two && two >= 1, "each letter typed makes the list again: fewer frames after 'av' than after 'a'", `${one} then ${two}`);
    await type("frame", "aviator");
    await settle();
    R.ck((await names("frame")) === "Aviator Classic", "'aviator' leaves only the Aviator");
    R.ck((await listShown("frame")) && (await A.val("document.querySelector('[data-hint=frame]').hidden")), "the list is shown and the hint is gone");
    await type("frame", "");
    await A.until(`!!document.querySelector('[data-results=frame]').hidden`);
    R.ck(await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length === 0 && !document.querySelector('[data-hint=frame]').hidden`), "erasing everything empties the list and brings the hint back");
    await type("frame", "rb2140");
    await settle();
    R.ck((await names("frame")) === "Wayfarer", "by model, the maker's reference finds the frame");
    await type("frame", "oakley");
    await settle();
    R.ck((await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length`)) === 20 && (await A.val(`!!${pick("frame")}.querySelector('[data-more]')`)), "26 frames match: 20 are listed in a scrollable list, and it says to keep typing");
    R.ck(await A.val(`(() => { const r = document.querySelector('[data-results=frame]'); return getComputedStyle(r).overflowY === 'auto' && r.scrollHeight > r.clientHeight; })()`), "the list scrolls");
    await type("frame", "oakley test");
    await settle();
    R.ck((await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length`)) === 20 && (await A.val(`${pick("frame")}.querySelectorAll('.pick-result__name')[0].textContent`)) === "Test frame 01", "more words narrow it down (oakley + test)");

    R.section("by code");
    await type("frame", "");
    await mode("frame", "code");
    R.ck(await A.val(`/code/i.test(document.querySelector('[data-picker=frame]').placeholder) && ${pick("frame")}.querySelector('[data-mode=code]').getAttribute('aria-pressed') === 'true'`), "choosing By code changes the box's text and the pressed button");
    await type("frame", "abc");
    await settle();
    R.ck((await names("frame")) === "Aviator Classic", "typing a code finds the frame");
    await type("frame", "ABC123");
    await settle();
    R.ck((await names("frame")) === "Aviator Classic", "capitals and no dash find it too");
    await type("frame", "aviator");
    await settle();
    R.ck((await A.val(`${pick("frame")}.querySelectorAll('.pick-result').length`)) === 0 && (await A.val("document.querySelector('[data-hint=frame]').textContent")) === "A code is 3 letters, a dash and 3 digits, like abc-123.", "a model name is not a code: nothing is listed, and the line under the box says what a code looks like");
    await type("frame", "ray");
    await settle();
    await mode("frame", "model");
    await settle();
    R.ck((await names("frame")) === "Aviator Classic|Wayfarer", "switching to By model searches what is typed again (ray -> the two Ray-Ban frames)");

    R.section("choosing and scanning");
    await A.val(`(() => { ${pick("frame")}.querySelector('.pick-result[data-code=def-456]').click(); return 1; })()`);
    R.ck(await A.until(`!document.querySelector('[data-chosen=frame]').hidden && /Wayfarer/.test(document.querySelector('[data-chosen=frame]').textContent)`), "clicking a frame chooses it (a card with its name)");
    await A.val("(() => { document.querySelector('[data-chosen=frame] [data-action=change]').click(); return 1; })()");
    R.ck(await A.until(`document.querySelector('[data-picker=frame]').value === '' && !!document.querySelector('[data-results=frame]').hidden`), "Change goes back to an empty search");
    await type("frame", "https://shop.example.com/frames/ghi-789");
    await A.val("(() => { document.querySelector('[data-picker=frame]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 1; })()");
    R.ck(await A.until(`!document.querySelector('[data-chosen=frame]').hidden && /Holbrook/.test(document.querySelector('[data-chosen=frame]').textContent)`), "scanning a label (Enter) picks the frame, whichever way the box is set");
    await type("accessory", "case");
    await settle();
    R.ck((await names("accessory")) === "Hard case", "the accessory picker works the same way (by model)");
    await mode("accessory", "code");
    await type("accessory", "xyz-111");
    await settle();
    R.ck((await names("accessory")) === "Hard case", "and by code");

    R.section("keyboard");
    await type("accessory", "");
    await mode("accessory", "model");
    await type("accessory", "case");
    await settle();
    await A.val("(() => { document.querySelector('[data-picker=accessory]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); return 1; })()");
    R.ck(await A.val("document.activeElement?.classList.contains('pick-result')"), "the down arrow moves from the box into the list");

    R.section("the structure of what is typed");
    await A.val("(() => { document.querySelector('[data-chosen=frame] [data-action=change]')?.click(); return 1; })()");
    await mode("frame", "code");
    const hintText = () => A.val("document.querySelector('[data-hint=frame]').textContent");
    const invalidNow = () => A.val("document.querySelector('[data-picker=frame]').getAttribute('aria-invalid') === 'true' && document.querySelector('[data-hint=frame]').classList.contains('pick-hint--invalid') && document.querySelector('[data-results=frame]').hidden");
    await type("frame", "abcd");
    R.ck((await invalidNow()) && (await hintText()) === "A code is 3 letters, a dash and 3 digits, like abc-123.", "by code, 'abcd' is refused at once: the line under the box says what a code looks like, the box is marked, nothing is listed");
    await type("frame", "ab1");
    R.ck(await invalidNow(), "'ab1' (digits before the 3 letters are done) is refused");
    await type("frame", "abc-1234");
    R.ck(await invalidNow(), "'abc-1234' (a fourth digit) is refused");
    await type("frame", "abc-12");
    await settle();
    R.ck(!(await A.val("document.querySelector('[data-picker=frame]').hasAttribute('aria-invalid')")) && (await names("frame")) === "Aviator Classic", "'abc-12' (a code in part) is fine: the mark goes and the frame is listed");
    await type("frame", "https://shop.example.com/frames/abc-123");
    R.ck((await hintText()) === "Press Enter to use this label." && !(await A.val("document.querySelector('[data-picker=frame]').hasAttribute('aria-invalid')")), "a label's address is not called wrong: it says to press Enter");
    await mode("frame", "model");
    await type("frame", "50%");
    R.ck((await invalidNow()) && /Only letters, digits, spaces/.test(await hintText()), "by model, characters that are not letters, digits, spaces or . , ' & + - / ( ) are refused");
    await type("frame", "one two three four five six seven");
    R.ck((await invalidNow()) && (await hintText()) === "Use at most 6 words.", "more than 6 words is refused");
    await type("frame", "x".repeat(61));
    R.ck((await invalidNow()) && /too long/.test(await hintText()), "more than 60 characters is refused");
    await type("frame", "ray ban");
    await settle();
    R.ck((await names("frame")) === "Aviator Classic|Wayfarer", "then a good model searches again");
    await type("frame", "");
    R.ck(await A.val("!document.querySelector('[data-picker=frame]').hasAttribute('aria-invalid') && /Start typing/.test(document.querySelector('[data-hint=frame]').textContent)"), "erasing brings the first hint back");
    // the form and the search function apply the same rules, input by input
    const service = JSON.parse(/CHECKS (.*)/.exec(runScript(box, `const S2 = require(ROOT + '/dist/local/productSearch.js'); const C = ${JSON.stringify(CASES)}; console.log('CHECKS ' + JSON.stringify({ valid: C.valid.map((c) => S2.checkSearchInput(c.input, c.by)), invalid: C.invalid.map((c) => S2.checkSearchInput(c.input, c.by)) }));`))?.[1] ?? "null");
    const page = await A.val(`(() => { const C = ${JSON.stringify(CASES)}; const q = window.newOrderData.checkQuery; return { valid: C.valid.map((c) => q(c.input, c.by)), invalid: C.invalid.map((c) => q(c.input, c.by)) }; })()`);
    R.ck(JSON.stringify(service.valid) === JSON.stringify(page.valid) && JSON.stringify(service.invalid) === JSON.stringify(page.invalid), "the form's rules and the search function's give the same answer (accepted or not, the cleaned text, the sentence) for all " + (CASES.valid.length + CASES.invalid.length) + " inputs");

    R.section("lenses");
    const lensNames = () => A.val(`[...document.querySelectorAll('[data-results=lens] .pick-result__name')].map((e) => e.textContent).join('|')`);
    const lensTags = () => A.val(`[...document.querySelectorAll('[data-results=lens] .pick-result')].map((e) => e.dataset.fit).join('|')`);
    R.ck(!(await listShown("lens")) && (await A.val("/Choose a prescription/.test(document.querySelector('[data-hint=lens]').textContent)")), "the lens list starts empty, with a hint (like the frames)");
    R.ck(await A.val("document.querySelector('[data-picker=lens]').disabled"), "without a prescription the lens search box is disabled: no lens can be chosen");
    await A.val("(() => { document.getElementById('order-use-rx').click(); return 1; })()");
    await A.until("!!document.querySelector('input[name=prescription][value=rx1]')");
    R.ck(await A.val("document.querySelector('[data-picker=lens]').disabled"), "ticking 'use a prescription' is not enough: one must be chosen");
    await A.val("(() => { document.querySelector('input[name=prescription][value=rx1]').click(); return 1; })()");
    await A.until("!document.querySelector('[data-results=lens]').hidden");
    R.ck(await A.val("!document.querySelector('[data-picker=lens]').disabled"), "choosing a prescription enables the lens search");
    R.ck((await lensNames()) === "Stock 1.5|Unlimited 1.6" && (await lensTags()) === "yes|yes", "choosing a prescription lists the lenses that fit it (the one outside its range and the retired one are not listed)", await lensNames());
    R.ck(await A.val(`(() => { const r = document.querySelector('[data-results=lens]'); return getComputedStyle(r).overflowY === 'auto'; })()`), "in a scrollable list");
    await type("lens", "high");
    await settle();
    R.ck((await lensNames()) === "High power 1.74" && (await lensTags()) === "no" && (await A.val("!!document.querySelector('[data-results=lens] .pick-result__sub--no')")), "typing searches all the lenses: one that does not fit is listed, marked, with the reason");
    await type("lens", "retired");
    await settle();
    R.ck((await lensNames()) === "", "a retired lens is never listed");
    await type("lens", "50%");
    R.ck(await A.val("document.querySelector('[data-picker=lens]').getAttribute('aria-invalid') === 'true'"), "the same rules as the other searches apply to what is typed");
    await type("lens", "high");
    await settle();
    await A.val("(() => { document.querySelector('[data-results=lens] .pick-result').click(); return 1; })()");
    R.ck(await A.until("!document.querySelector('[data-chosen=lens]').hidden && /advice only/.test(document.querySelector('[data-chosen=lens]').textContent)") && (await A.val("document.querySelector('[data-new-order]').dataset.lens")) === "l2", "a lens that may not fit can still be chosen: the card says it is advice only");
    await A.val("(() => { document.querySelector('[data-chosen=lens] [data-action=change]').click(); return 1; })()");
    R.ck((await A.until("document.querySelector('[data-picker=lens]').value === ''")) && (await A.val("document.querySelector('[data-new-order]').dataset.lens")) === "", "Change goes back to the list");
    await A.until("(document.querySelectorAll('[data-results=lens] .pick-result').length) === 2");
    await A.val("(() => { document.getElementById('order-lens-describe').click(); return 1; })()");
    R.ck(await A.val("document.querySelector('.pick[data-kind=lens]').hidden && !document.querySelector('[data-lens-text]').hidden"), "the checkbox hides the list and shows a description box");
    await A.val("(() => { const t = document.getElementById('order-lens-description'); t.value = 'Progressive 1.6 with anti-reflective'; t.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
    R.ck((await A.val("document.querySelector('[data-new-order]').dataset.lensDescription")) === "Progressive 1.6 with anti-reflective" && (await A.val("document.querySelector('[data-new-order]').dataset.lens")) === "", "the description is kept, and no catalogue lens is used with it");
    R.ck((await A.val("document.getElementById('order-lens-description').maxLength")) === 200, "the description is limited to 200 characters");
    await A.val("(() => { document.getElementById('order-lens-describe').click(); return 1; })()");
    R.ck(await A.val("!document.querySelector('.pick[data-kind=lens]').hidden && document.querySelector('[data-lens-text]').hidden"), "unticking brings the list back");
    await A.until("(document.querySelectorAll('[data-results=lens] .pick-result').length) === 2");
    await A.val("(() => { document.querySelector('[data-results=lens] .pick-result').click(); return 1; })()");
    await A.until("!document.querySelector('[data-chosen=lens]').hidden");
    await A.val("(() => { document.getElementById('order-use-rx').click(); return 1; })()");
    R.ck(await A.until("document.querySelector('[data-chosen=lens]').hidden && document.querySelector('[data-picker=lens]').disabled && document.querySelector('[data-new-order]').dataset.lens === ''"), "dropping the prescription drops the chosen lens and disables the search again");

    R.section("the search icon and the text");
    await A.val("(() => { document.querySelector('[data-chosen=frame] [data-action=change]').click(); return 1; })()"); // (the box is hidden while a frame is chosen)
    await mode("frame", "model");
    R.ck(await A.val(`(() => { const i = ${pick("frame")}.querySelector('input'); const pl = parseFloat(getComputedStyle(i).paddingLeft); const ic = ${pick("frame")}.querySelector('.search .icon').getBoundingClientRect(); const ir = i.getBoundingClientRect(); return pl >= 32 && ic.right <= ir.left + pl; })()`), "left to right: the text starts after the icon (it no longer sits on the placeholder)");
    R.ck(await A.val(`(() => { const i = ${pick("frame")}.querySelector('input'); const w = i.getBoundingClientRect().width; return w > 300; })()`), "and the box fills its row");
    await A.val("(() => { document.documentElement.dir = 'rtl'; return 1; })()");
    R.ck(await A.val(`(() => { const i = ${pick("frame")}.querySelector('input'); const cs = getComputedStyle(i); const ic = ${pick("frame")}.querySelector('.search .icon').getBoundingClientRect(); const ir = i.getBoundingClientRect(); return parseFloat(cs.paddingRight) >= 32 && parseFloat(cs.paddingLeft) < 20 && ic.left >= ir.right - parseFloat(cs.paddingRight); })()`), "right to left (Arabic): the room for the icon is on the right, where the icon is");
    await A.val("(() => { document.documentElement.dir = 'ltr'; return 1; })()");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }

  // ---- the same form in French and Arabic
  const B = await launchApp(box);
  try {
    await B.until("typeof window.i18n?.setLang === 'function' && typeof window.openNewOrderForm === 'function'");
    for (const [code, mode_, hint] of [["fr", "Par modèle", "Commencez à écrire pour trouver une monture."], ["ar", "حسب الطراز", "ابدأ الكتابة للعثور على إطار."]]) {
      R.section(code);
      await B.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(900);
      await B.until("typeof window.openNewOrderForm === 'function'");
      await B.val("(() => { window.openNewOrderForm({ id: 'c1', name: 'Amina Benali' }); return 1; })()");
      await B.until("!!document.querySelector('.pick[data-kind=frame]')");
      R.ck(await B.val(`document.querySelector('.pick[data-kind=frame] [data-mode=model]').textContent === ${JSON.stringify(mode_)} && document.querySelector('[data-hint=frame]').textContent === ${JSON.stringify(hint)}`), "the way to search and the hint are translated");
      const missing = await B.val("[...window.i18n.missing].filter((s) => !/^(Amina|Ray-Ban|Oakley|Optical|Aviator|Wayfarer|Holbrook|Test frame|Hard case)/.test(s) && !/^[A-Z]{2,3}\\d|^DZD|^\\d/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s))");
      R.ck(missing.length === 0, "every text of the form has a translation", JSON.stringify(missing));
      await B.val("(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); return 1; })()");
    }
  } catch (error) {
    R.ck(false, "languages: ERR", String(error.stack).slice(0, 400));
  } finally {
    await B.stop();
  }
  process.exit(R.done());
})();
