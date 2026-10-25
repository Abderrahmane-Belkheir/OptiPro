// The frame's "gender" column (male | female | unisex, always lower case, optional) in the local database only, for now:
//   - a new database has the column, an older database gets it when the app starts, and nothing it held is lost;
//   - the server's column list has it (the same list the servers use to check what the app sends): a frame goes up with its gender, or with none, and an emptied gender is emptied there too;
//   - a gender can be set and read back here.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");
const { startFakeServer } = require("./helpers/fakeServer.cjs");

const R = recorder();

(async () => {
  // ---- the column, in a new database and in an older one
  const old = sandbox("op-gender-old-");
  old.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
  const made = runScript(
    old,
    `
    await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
    const S = { tenantKey: 't1', synced: true };
    await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
    await p.category.upsert({ where: { id: 1 }, create: { id: 1, name: 'Optical Frames', imageUrl: 'u' }, update: {} });
    await p.frame.create({ data: { id: 'f1', name: 'Aviator', brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: 3, ...S } });
    const cols = async () => (await p.$queryRawUnsafe('PRAGMA table_info("frames")')).map((c) => c.name);
    console.log('NEW ' + JSON.stringify({ has: (await cols()).includes('gender'), value: (await p.frame.findFirst({ where: { id: 'f1' } })).gender }));
    await p.$executeRawUnsafe('ALTER TABLE "frames" DROP COLUMN "gender"'); // what a database made by an older version looks like
    console.log('OLD ' + JSON.stringify({ has: (await cols()).includes('gender') }));
  `,
  );
  const fresh = JSON.parse(/NEW (.*)/.exec(made)[1]);
  R.section("the column");
  R.ck(fresh.has === true && fresh.value === null, "a new database has the column, empty for a frame that has none", JSON.stringify(fresh));
  R.ck(JSON.parse(/OLD (.*)/.exec(made)[1]).has === false, "(an older database, made to look like one: no column)");
  const upgraded = runScript(
    old,
    `
    const cols = (await p.$queryRawUnsafe('PRAGMA table_info("frames")')).map((c) => c.name);
    const f = await p.frame.findFirst({ where: { id: 'f1' } });
    await p.frame.update({ where: { id: 'f1' }, data: { gender: 'female' } });
    console.log('UP ' + JSON.stringify({ has: cols.includes('gender'), name: f.name, stock: f.stock, gender: f.gender, after: (await p.frame.findFirst({ where: { id: 'f1' } })).gender }));
  `,
  );
  const up = JSON.parse(/UP (.*)/.exec(upgraded)[1]);
  R.ck(up.has === true && up.name === "Aviator" && up.stock === 3 && up.gender === null, "the next start gives an older database the column and keeps its frames as they were", JSON.stringify(up));
  R.ck(up.after === "female", "a gender can be saved and read back");

  // ---- the server that does not have the column yet
  const fake = await startFakeServer({ keys: { "key-g": {} } });
  const box = sandbox("op-gender-sync-");
  box.writeConfig(["tenant.key=key-g", `server.url=${fake.url}`]);
  const A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.frames?.create === 'function'", 20000);
    const api = (path, ...args) => A.val(`window.electronAPI.${path}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
    R.section("the server");
    const brand = await api("brands.insert", { name: "Oakley" });
    const frame = (await api("frames.create", { currency: "DZD", name: "Holbrook", brandId: brand.id, categoryId: 1, price: "22000", stock: "2" })).frame;
    await A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 15000);
    R.ck(fake.row("frames", frame.id)?.name === "Holbrook" && fake.row("frames", frame.id)?.gender === null, "a frame with no gender reaches the server with none", JSON.stringify(fake.row("frames", frame.id)?.gender));
    R.ck(fake.state.requests.filter((r) => r.status >= 400).length === 0, "and the server refused nothing");
    await api("frames.update", frame.id, { gender: "male" });
    await A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 15000);
    R.ck(fake.row("frames", frame.id)?.gender === "male", "a gender set here reaches the server, in lower case");
    await api("frames.update", frame.id, { gender: null });
    await A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 15000);
    R.ck(fake.row("frames", frame.id)?.gender === null, "a gender emptied here is emptied on the server too");
    await api("frames.update", frame.id, { gender: "male" });
    await A.until("window.electronAPI.dashboard.syncStatus().then((s) => s.unsyncedCount === 0)", 15000);
    R.ck((await api("frames.get", frame.id)).gender === "male", "the gender is kept on this computer");
    R.ck(fake.state.requests.filter((r) => r.status >= 400).length === 0, "and nothing was refused");

    R.section("what is stored: lower case, and only the three values");
    const made = async (gender) => api("frames.create", { currency: "DZD", name: "Gender " + String(gender), brandId: brand.id, categoryId: 1, price: "10000", stock: "1", ...(gender === undefined ? {} : { gender }) });
    const kinds = {};
    for (const [label, input] of [["Male", "Male"], ["FEMALE", " FEMALE "], ["unisex", "unisex"]]) {
      const r = await made(input);
      kinds[label] = r.status === "created" ? r.frame.gender : r.errors;
    }
    R.ck(kinds.Male === "male" && kinds.FEMALE === "female" && kinds.unisex === "unisex", "Male, \" FEMALE \" and unisex are stored as male, female and unisex", JSON.stringify(kinds));
    for (const bad of ["men", "women", "homme", "m", "other"]) {
      const r = await made(bad);
      R.ck(r.status === "invalid" && /Choose male, female or unisex/.test(r.errors.gender ?? ""), `"${bad}" is refused with a sentence, nothing is saved`, JSON.stringify(r.errors ?? r.status));
    }
    const blank = await made("");
    R.ck(blank.status === "created" && blank.frame.gender === null, "empty means no gender");
    const none = await made(undefined);
    R.ck(none.status === "created" && none.frame.gender === null, "a form that does not mention it gives none");
    const target = (await made("female")).frame;
    const keep = await api("frames.edit", target.id, { currency: "DZD", name: target.name, brandId: brand.id, categoryId: 1, price: "10000", stock: "5" });
    R.ck(keep.status === "updated" && (await api("frames.get", target.id)).gender === "female", "an edit whose form does not mention the gender leaves it as it was (the Edit card has no such field yet)");
    const change = await api("frames.edit", target.id, { currency: "DZD", name: target.name, brandId: brand.id, categoryId: 1, price: "10000", stock: "5", gender: "UNISEX" });
    R.ck((await api("frames.get", target.id)).gender === "unisex" && change.status === "updated", "an edit can change it");
    const clear = await api("frames.edit", target.id, { currency: "DZD", name: target.name, brandId: brand.id, categoryId: 1, price: "10000", stock: "5", gender: "" });
    R.ck((await api("frames.get", target.id)).gender === null && clear.status === "updated", "and empty it");
    const refused = await api("frames.edit", target.id, { currency: "DZD", name: target.name, brandId: brand.id, categoryId: 1, price: "10000", stock: "9", gender: "women" });
    R.ck(refused.status === "invalid" && (await api("frames.get", target.id)).stock === 5, "an edit with a wrong value changes nothing");
    const listed = (await api("frames.listWithPhotos", brand.id, 1)).find((x) => x.id === frame.id);
    R.ck(listed && listed.gender === "male", "the frames list carries the gender (for the filter to come)", JSON.stringify(listed?.gender));
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
    await fake.close();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
