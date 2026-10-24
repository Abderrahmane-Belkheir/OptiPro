// The person never waits long for the server. After "Save" the app waits for the server for a short time only (OPTIPRO_PUSH_WAIT_MS, 1.5 s by default; 300 ms here);
// what is not done by then goes on in the background: the answer is "push-pending", the row is marked synced when the server has it, and the next saves do not wait
// at all while the server is slow. A child is still sent after its parent (one line of pushes), and a fast server changes nothing: the answer is "synced" at once.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-pushwait-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
const out = runScript(
  box,
  `
  process.env.OPTIPRO_PUSH_WAIT_MS = '300';
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const L = require(ROOT + '/dist/local/index.js');

  // a fake server: answers after 'delay' ms, and notes what it was asked, in order
  let delay = 2500;
  const seen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    const m = /^\\/api\\/table\\/([a-z_]+)\\?action=([a-z]+)$/.exec(req.url);
    seen.push(m ? m[1] + ':' + m[2] : req.url);
    setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); }, delay);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'tenant.key=t1\\nserver.url=http://127.0.0.1:' + server.address().port + '\\n');
  const circuit = require(ROOT + '/dist/local/tableApiClient.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = (id) => ({ id, name: 'Frame ' + id, brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: 1 });
  const synced = async (table, id) => (await p[table].findFirst({ where: { id } })).synced;
  const out = {};

  // 1. a slow server (2.5 s): inserting a frame comes back after about the short wait, not after the server
  let t0 = Date.now();
  const f1 = await L.localFrameService.insert(frame('f1'));
  out.slowInsert = { ms: Date.now() - t0, name: f1.name, syncedAtOnce: await synced('frame', 'f1') };
  // ... and the push goes on: a moment later the row is synced
  for (let i = 0; i < 40 && !(await synced('frame', 'f1')); i++) await sleep(250);
  out.slowLater = { synced: await synced('frame', 'f1') };

  // 2. the answer of pushRow itself
  await p.frame.create({ data: { ...frame('f2'), ...S, synced: false } });
  t0 = Date.now();
  const r2 = await L.pushRow('frames', 'f2');
  out.pending = { ms: Date.now() - t0, synced: r2.synced, reason: r2.reason, hasDone: r2.done instanceof Promise };
  const final = await r2.done;
  out.final = { synced: final.synced, rowSynced: await synced('frame', 'f2') };

  // 3. while the server is slow nobody waits at all (the first late push started "slow mode")
  await p.frame.create({ data: { ...frame('f3'), ...S, synced: false } });
  await p.frame.create({ data: { ...frame('f4'), ...S, synced: false } });
  t0 = Date.now();
  const r3 = await L.pushRow('frames', 'f3');
  const r4 = await L.pushRow('frames', 'f4');
  out.noWait = { ms: Date.now() - t0, reasons: [r3.reason, r4.reason] };
  await Promise.all([r3.done, r4.done]);
  out.noWaitLater = [await synced('frame', 'f3'), await synced('frame', 'f4')];

  // 4. a child asked for right after its parent (both slow): the child is not left behind, it is sent after the parent
  seen.length = 0;
  await p.brand.create({ data: { id: 'b2', name: 'New brand', tenantKey: 't1', synced: false } });
  await p.frame.create({ data: { ...frame('f5'), brandId: 'b2', ...S, synced: false } });
  const rb = await L.pushRow('brands', 'b2');
  const rf = await L.pushRow('frames', 'f5');
  out.chain = { brand: rb.reason, frame: rf.reason }; // both pending: the frame is not "parents-not-synced"
  await Promise.all([rb.done, rf.done]);
  out.chainLater = { brandSynced: await synced('brand', 'b2'), frameSynced: await synced('frame', 'f5'), requests: seen.slice() };

  // 5. a fast server changes nothing: synced at once, with no pending answer
  delay = 0;
  circuit.resetTableApiCircuit();
  await sleep(100);
  await L.pushRow('frames', 'f1'); // (the first call after a slow time may still say pending; it ends the slow time)
  await sleep(300);
  await p.frame.create({ data: { ...frame('f6'), ...S, synced: false } });
  t0 = Date.now();
  const r6 = await L.pushRow('frames', 'f6');
  out.fast = { ms: Date.now() - t0, synced: r6.synced, reason: r6.reason ?? null };
  await p.frame.create({ data: { ...frame('f7'), ...S, synced: false } });
  const f7 = await L.localFrameService.insert(frame('f7b'));
  out.fastInsert = { rowSynced: await synced('frame', 'f7b') };

  server.close();
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("a slow server");
R.ck(r.slowInsert?.ms < 1500 && r.slowInsert?.name === "Frame f1" && r.slowInsert?.syncedAtOnce === false, "inserting a frame while the server takes 2.5 s comes back after the short wait (about 0.3 s here), not after the server", JSON.stringify(r.slowInsert));
R.ck(r.slowLater?.synced === true, "the push went on in the background: the frame is marked synced when the server answered", JSON.stringify(r.slowLater));
R.ck(r.pending?.reason === "push-pending" && r.pending?.synced === false && r.pending?.hasDone === true && r.pending?.ms < 1500, "pushRow answers 'push-pending' after the short wait, with the push still on its way", JSON.stringify(r.pending));
R.ck(r.final?.synced === true && r.final?.rowSynced === true, "and the push finishes by itself: the row is synced", JSON.stringify(r.final));
R.ck(r.noWait?.ms < 400 && r.noWait?.reasons?.join() === "push-pending,push-pending", "while the server is slow, the next saves do not wait at all (two pushes took under 0.4 s together)", JSON.stringify(r.noWait));
R.ck(r.noWaitLater?.join() === "true,true", "and they are sent in their turn", JSON.stringify(r.noWaitLater));

R.section("a child after its parent");
R.ck(r.chain?.brand === "push-pending" && r.chain?.frame === "push-pending", "a frame of a brand that is itself still being sent is queued after it (not set aside as 'parents not synced')", JSON.stringify(r.chain));
R.ck(r.chainLater?.brandSynced === true && r.chainLater?.frameSynced === true && r.chainLater?.requests?.join() === "brands:insert,frames:insert", "and both land, the brand first", JSON.stringify(r.chainLater));

R.section("a fast server");
R.ck(r.fast?.synced === true && r.fast?.reason === null && r.fast?.ms < 1000, "with a fast server the answer is 'synced' at once, as before", JSON.stringify(r.fast));
R.ck(r.fastInsert?.rowSynced === true, "and an inserted frame is already synced when insert returns");

process.exit(R.done());
