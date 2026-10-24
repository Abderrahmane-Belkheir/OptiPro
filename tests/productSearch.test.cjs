// Searching frames and accessories for the New order form: by model (name, reference, brand / name, description), by code (the label's code), or by anything.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const CASES = require("./helpers/searchCases.json");
const R = recorder();
const box = sandbox("op-search-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.brand.create({ data: { id: 'b2', name: 'Oakley', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, brandId, reference, code) => p.frame.create({ data: { id, name, brandId, categoryId: 1, reference, code, price: 18500, currency: 'DZD', stock: 2, ...S } });
  await frame('f1', 'Aviator Classic', 'b1', 'RB3025', 'abc-123');
  await frame('f2', 'Wayfarer', 'b1', 'RB2140', 'def-456');
  await frame('f3', 'Holbrook', 'b2', 'OO9102', 'ghi-789');
  for (let i = 1; i <= 25; i++) await frame('t' + i, 'Test frame ' + String(i).padStart(2, '0'), 'b2', null, 'tst-' + String(100 + i));
  await p.accessory.create({ data: { id: 'a1', name: 'Hard case', description: 'Protective case', price: 1200, currency: 'DZD', stock: 9, code: 'xyz-111', ...S } });
  await p.accessory.create({ data: { id: 'a2', name: 'Cleaning cloth', description: 'Microfibre', price: 300, currency: 'DZD', stock: 9, code: 'xyz-222', ...S } });
  const S2 = require(ROOT + '/dist/local/productSearch.js');
  const names = (rows) => rows.map((r) => r.name).join('|');
  const out = {};
  out.frameModel = {
    aviator: names(await S2.searchFrames('aviator', 20, 'model')),
    reference: names(await S2.searchFrames('rb2140', 20, 'model')),
    brand: names(await S2.searchFrames('oakley holbrook', 20, 'model')),
    ray: names(await S2.searchFrames('ray', 20, 'model')),
    twoWords: names(await S2.searchFrames('ray aviator', 20, 'model')),
    noMatch: names(await S2.searchFrames('ray oakley', 20, 'model')),
    notTheCode: names(await S2.searchFrames('abc', 20, 'model')),
    upper: names(await S2.searchFrames('AVIATOR', 20, 'model')),
  };
  out.frameCode = {
    full: names(await S2.searchFrames('abc-123', 20, 'code')),
    part: names(await S2.searchFrames('abc', 20, 'code')),
    digits: names(await S2.searchFrames('456', 20, 'code')),
    upper: names(await S2.searchFrames('ABC-123', 20, 'code')),
    noDash: names(await S2.searchFrames('abc123', 20, 'code')),
    notTheName: await S2.searchFrames('aviator', 20, 'code').then(names, () => 'REFUSED'), // (a name is not a code)
    notTheReference: await S2.searchFrames('rb3025', 20, 'code').then(names, () => 'REFUSED'),
  };
  out.frameAny = {
    name: names(await S2.searchFrames('aviator', 20)),
    code: names(await S2.searchFrames('abc', 20)),
    bogusBy: names(await S2.searchFrames('abc', 20, 'bogus')),
    anyBy: names(await S2.searchFrames('abc', 20, 'any')),
  };
  out.accessories = {
    modelName: names(await S2.searchAccessories('case', 20, 'model')),
    modelDescription: names(await S2.searchAccessories('microfibre', 20, 'model')),
    code: names(await S2.searchAccessories('xyz-222', 20, 'code')),
    codeNoDash: names(await S2.searchAccessories('xyz222', 20, 'code')),
    codeNotName: await S2.searchAccessories('case', 20, 'code').then(names, () => 'REFUSED'),
    any: names(await S2.searchAccessories('xyz-111', 20)),
  };
  out.limit = { asked21: (await S2.searchFrames('test', 21, 'model')).length, asked5: (await S2.searchFrames('test', 5, 'model')).length };
  // what a customer's order can be made with: only what is in stock
  await frame('z0', 'Zero stock model', 'b1', 'ZZ0', 'zzz-000');
  await p.frame.update({ where: { id: 'z0' }, data: { stock: 0 } });
  await p.accessory.create({ data: { id: 'a0', name: 'Zero stock case', description: 'None left', price: 100, currency: 'DZD', stock: 0, code: 'zzz-001', ...S } });
  out.inStock = {
    framesAll: names(await S2.searchFrames('zero stock', 20, 'model')),
    framesIn: names(await S2.searchFrames('zero stock', 20, 'model', { inStock: true })),
    framesInOthers: names(await S2.searchFrames('aviator', 20, 'model', { inStock: true })),
    accessoriesAll: names(await S2.searchAccessories('zero stock', 20, 'model')),
    accessoriesIn: names(await S2.searchAccessories('zero stock', 20, 'model', { inStock: true })),
    accessoriesInOthers: names(await S2.searchAccessories('case', 20, 'model', { inStock: true })),
    byCode: names(await S2.searchFrames('zzz-000', 20, 'code', { inStock: true })),
  };
  const CASES = ${JSON.stringify(CASES)};
  out.valid = CASES.valid.map((c) => S2.checkSearchInput(c.input, c.by));
  out.invalid = CASES.invalid.map((c) => S2.checkSearchInput(c.input, c.by));
  out.thrown = {};
  for (const [name, call] of Object.entries({
    framesCode: () => S2.searchFrames('abcd', 20, 'code'),
    framesModel: () => S2.searchFrames('50%', 20, 'model'),
    framesAny: () => S2.searchFrames('x;y', 20),
    accessoriesCode: () => S2.searchAccessories('ab1', 20, 'code'),
    accessoriesModel: () => S2.searchAccessories('<b>', 20, 'model'),
    url: () => S2.searchFrames('https://shop.example.com/frames/abc-123', 20, 'code'),
    notText: () => S2.searchFrames(42, 20, 'model'),
  })) out.thrown[name] = await call().then(() => 'accepted', (e) => e.kind + ': ' + e.message);
  out.ok = { none: (await S2.searchFrames(undefined, 20)).length > 0, empty: (await S2.searchFrames('   ', 20, 'code')).length > 0, partialCode: names(await S2.searchFrames('abc-1', 20, 'code')), normalized: names(await S2.searchFrames('  AVIATOR  ', 20, 'model')) };
  out.firstHitFields = Object.keys((await S2.searchFrames('aviator', 5, 'model'))[0]).sort().join();
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("frames, by model");
R.ck(r.frameModel.aviator === "Aviator Classic" && r.frameModel.upper === "Aviator Classic", "the name finds it, in any case");
R.ck(r.frameModel.reference === "Wayfarer", "the maker's reference finds it (RB2140)");
R.ck(r.frameModel.brand === "Holbrook" && r.frameModel.ray === "Aviator Classic|Wayfarer", "the brand finds its frames, and a brand with a name narrows them");
R.ck(r.frameModel.twoWords === "Aviator Classic" && r.frameModel.noMatch === "", "every word typed has to match (ray + aviator, but not ray + oakley)");
R.ck(r.frameModel.notTheCode === "", "the code is NOT looked at (abc finds nothing by model)");

R.section("frames, by code");
R.ck(r.frameCode.full === "Aviator Classic" && r.frameCode.part === "Aviator Classic" && r.frameCode.digits === "Wayfarer", "the code finds it, whole or in part");
R.ck(r.frameCode.upper === "Aviator Classic" && r.frameCode.noDash === "Aviator Classic", "capitals, and the code without its dash (abc123), find it too");
R.ck(r.frameCode.notTheName === "REFUSED" && r.frameCode.notTheReference === "REFUSED", "the name and the maker's reference are NOT looked at: typed as a code they are refused (they are not codes)");

R.section("frames, by anything (as before)");
R.ck(r.frameAny.name === "Aviator Classic" && r.frameAny.code === "Aviator Classic", "with no way given, the name and the code both find it");
R.ck(r.frameAny.bogusBy === r.frameAny.code && r.frameAny.anyBy === r.frameAny.code, "an unknown way is the same as any");

R.section("accessories");
R.ck(r.accessories.modelName === "Hard case" && r.accessories.modelDescription === "Cleaning cloth", "by model: the name or the description");
R.ck(r.accessories.code === "Cleaning cloth" && r.accessories.codeNoDash === "Cleaning cloth", "by code: the code, with or without the dash");
R.ck(r.accessories.codeNotName === "REFUSED" && r.accessories.any === "Hard case", "by code a name is refused (it is not a code); with no way given the code works as before");

R.section("the structure of what is typed");
R.ck(CASES.valid.every((c, i) => r.valid[i].ok === true && r.valid[i].query === c.query), "every well-formed input is accepted and cleaned up (capitals, extra spaces, the code without its dash...)", JSON.stringify(CASES.valid.filter((c, i) => !(r.valid[i].ok === true && r.valid[i].query === c.query))));
R.ck(CASES.invalid.every((c, i) => r.invalid[i].ok === false && typeof r.invalid[i].message === "string"), "every malformed input is refused with a sentence", JSON.stringify(CASES.invalid.filter((c, i) => r.invalid[i].ok !== false)));
R.ck(CASES.invalid.filter((c) => c.by === "code").every((c) => r.invalid[CASES.invalid.indexOf(c)].message === "A code is 3 letters, a dash and 3 digits, like abc-123."), "a wrong code is told what a code looks like");
R.ck(Object.entries(r.thrown).filter(([name]) => name !== "url").every(([, v]) => /^invalid-input: Search: /.test(v)), "searching with a malformed input is an error (invalid-input), for frames and accessories, in every mode", JSON.stringify(r.thrown));
R.ck(/^invalid-input/.test(r.thrown.url), "a label's address is not a code: the form turns it into the code first", r.thrown.url);
R.ck(r.ok.none && r.ok.empty, "nothing typed is fine (the first ones, as before)");
R.ck(r.ok.partialCode === "Aviator Classic" && r.ok.normalized === "Aviator Classic", "a code typed in part, and a model with capitals and spaces around it, still search");

R.section("only what is in stock");
R.ck(r.inStock.framesAll === "Zero stock model" && r.inStock.accessoriesAll === "Zero stock case", "without the filter a product with no stock is found (the other pages need it)");
R.ck(r.inStock.framesIn === "" && r.inStock.accessoriesIn === "", "with the filter a frame or an accessory with no stock is not found", JSON.stringify(r.inStock));
R.ck(r.inStock.framesInOthers === "Aviator Classic" && r.inStock.accessoriesInOthers === "Hard case", "the ones in stock still are");
R.ck(r.inStock.byCode === "", "by code too");

R.section("limit");
R.ck(r.limit.asked21 === 21 && r.limit.asked5 === 5, "one more than shown can be asked for (to know there are more), and a smaller limit is kept");
R.ck(r.firstHitFields === "brand,code,currency,id,name,price,reference,stock", "a hit has what the picker shows", r.firstHitFields);
process.exit(R.done());
