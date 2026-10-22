// The shop's own details (src/local/shopInfoService.ts): saved in the local licence row with a synced flag, sent with POST /api/infos carrying only what changed (a null
// for the rest), sent again by the sync pass while the server has not confirmed them, and never lost. A fake server runs inside the script (the script is a
// separate process, and the test must be able to answer while it waits).
const path = require("node:path");
const { sandbox, runScript, recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();

// ---- the rules alone
const { validateShopInfoForm } = require(path.join(ROOT, "dist", "local", "shopInfoValidation.js"));
const bad = (form) => validateShopInfoForm(form).errors ?? null;
const good = (form) => validateShopInfoForm(form).values ?? null;

R.section("the rules");
R.ck(JSON.stringify(good({})) === "{}" && JSON.stringify(good({ name: "", phone: "  ", email: null, address: undefined })) === "{}", "an empty, blank, null or missing field is not a value: it means 'leave it as it is'");
R.ck(good({ name: "  Maison   Clair " }).name === "Maison Clair", "values are trimmed and spaces tidied");
R.ck(bad({ name: "x".repeat(121) })?.name && bad({ address: "x".repeat(301) })?.address && bad({ phone: 5 })?.phone, "too long, or not text: refused");
R.ck(bad({ phone: "call me" })?.phone && good({ phone: "+213 (0) 550-12.34" }).phone === "+213 (0) 550-12.34", "a phone number: digits, spaces and + ( ) . - only");
R.ck(bad({ email: "nope" })?.email && good({ email: "hello@maison.dz" }).email === "hello@maison.dz", "an email must look like one");
R.ck(bad({ instagramUrl: "javascript:alert(1)" })?.instagramUrl && bad({ tiktokUrl: "tiktok" })?.tiktokUrl && good({ instagramUrl: "https://instagram.com/x" }).instagramUrl === "https://instagram.com/x", "the social addresses must be http(s) addresses");
R.ck(Object.keys(bad({ email: "x", phone: "y", instagramUrl: "z" })).length === 3, "every mistake is reported at once, by field");

// ---- the service, the server and the sync pass
const box = sandbox("op-shopinfo-");
box.writeConfig(["tenant.key=goodkey", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  const http = require('node:http');
  const fs = require('node:fs');
  const L = require(ROOT + '/dist/local/index.js');
  const S = L.localShopInfoService;
  await p.tenant.create({ data: { key: 'goodkey', host: 'h', name: 'T' } });

  // a fake server: records what it was sent, answers by 'mode'
  const seen = [];
  let mode = 'ok';
  let hook = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (hook) await hook();
      if (mode === 'ok') return send(200, { updated: true, fields: [], tenant: {} });
      if (mode === '401') return send(401, { error: 'A valid tenant key is required.', code: 'UNAUTHORIZED' });
      if (mode === '400') return send(400, { error: '"email" must be an e-mail address.', code: 'INVALID_FIELD', field: 'email' });
      if (mode === '500') return send(500, { error: 'The shop information could not be saved on the server.', code: 'NOT_UPDATED' });
      send(200, { something: 'else' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const up = 'http://127.0.0.1:' + server.address().port;
  const dead = http.createServer();
  await new Promise((r) => dead.listen(0, '127.0.0.1', r));
  const down = 'http://127.0.0.1:' + dead.address().port;
  await new Promise((r) => dead.close(r)); // (nothing listens there now)
  const serverIs = (url) => fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'tenant.key=goodkey\\nserver.url=' + url + '\\n');
  const bodies = () => seen.map((s) => s.body);
  const row = () => p.licenseExpiry.findUnique({ where: { id: 1 } });
  const out = {};
  let refusedTimes = 0;
  L.setUnauthorizedHandler(() => { refusedTimes += 1; });

  // no licence row yet
  serverIs(up);
  out.noRow = await S.save({ phone: '0550 11 22 33' }).then(() => 'saved', (e) => e.kind);
  out.getNoRow = await S.get();

  // the activation stored the details and the server has them
  await L.localLicenseService.setExpiry('2030-01-01', { name: 'Maison Clair', phone: '0550 00 00 00', instagramUrl: 'https://instagram.com/maison' });
  out.start = await S.get();
  out.startPending = await S.isPending();

  // nothing to change, or wrong: no request, nothing saved
  const before = seen.length;
  out.unchangedEmpty = (await S.save({})).status;
  out.unchangedSame = (await S.save({ phone: '0550 00 00 00', name: '  Maison  Clair ' })).status;
  out.invalid = (await S.save({ email: 'nope', phone: 'call me' })).errors;
  out.noRequests = seen.length === before;
  out.stillSynced = (await row()).synced;

  // 1. a change while synced: only that field carries a value, the others are null
  const a = await S.save({ phone: '0661 11 22 33', address: '' });
  out.a = { status: a.status, changed: a.changed, sent: a.sentToServer, syncedNow: a.info.onServer, phone: a.info.phone };
  out.aRequest = seen.at(-1);

  // 2. the server cannot be reached: the change is kept, unsynced
  serverIs(down);
  const b = await S.save({ address: '12 Rue Didouche Mourad' });
  out.b = { status: b.status, changed: b.changed, sent: b.sentToServer, reason: b.reason, syncedNow: b.info.onServer, address: b.info.address };
  out.bPending = await S.isPending();
  out.bUnsyncedCount = (await L.localDashboardService.syncStatus()).unsyncedCount;
  out.bFirstUnsynced = (await L.checkUnsynced())?.table;

  // 3. another change while the first never arrived: everything that has a value is sent, so the address is not lost
  serverIs(up);
  const c = await S.save({ email: 'hello@maison.dz' });
  out.c = { status: c.status, changed: c.changed, sent: c.sentToServer, syncedNow: c.info.onServer };
  out.cRequest = seen.at(-1);
  out.cAfterPending = await S.isPending();

  // 4. nothing waiting: the pass sends nothing
  const n = seen.length;
  out.pushNothing = (await S.pushPending()).status;
  out.pushNothingRequests = seen.length - n;

  // 5. the pass sends what is waiting (every field with a value) when the server is back
  serverIs(down);
  await S.save({ name: 'Maison Clair 2' });
  out.d1 = (await S.pushPending());
  out.d1Synced = (await row()).synced;
  serverIs(up);
  const d2 = await S.pushPending();
  out.d2 = d2.status;
  out.d2Request = seen.at(-1).body;
  out.d2Synced = (await row()).synced;

  // 6. the server refuses a value: kept unsynced, with its reason
  mode = '400';
  const e = await S.save({ tiktokUrl: 'https://tiktok.com/@maison' });
  out.e = { sent: e.sentToServer, reason: e.reason, syncedNow: e.info.onServer, tiktok: e.info.tiktokUrl };
  mode = '500';
  out.e500 = (await S.pushPending());
  mode = 'weird';
  out.eWeird = (await S.pushPending()).status;
  mode = 'ok';
  out.eRetry = (await S.pushPending()).status;
  out.eRetrySynced = (await row()).synced;

  // 7. an edit made while the request is on its way keeps the row unsynced (it was not what the server got)
  hook = async () => { await p.licenseExpiry.update({ where: { id: 1 }, data: { phone: '0770 99 99 99', synced: false } }); hook = null; };
  const f = await S.save({ address: '5 Rue des Frères' });
  out.f = { sent: f.sentToServer, syncedNow: (await row()).synced, phone: (await row()).phone };
  out.fRetry = (await S.pushPending()).status;
  out.fRequest = seen.at(-1).body;
  out.fSynced = (await row()).synced;

  // 8. the server turns the shop away: the change is kept, the old day is saved, the app is told to close (once)
  mode = '401';
  const g = await S.save({ phone: '0555 12 12 12' });
  out.g = { sent: g.sentToServer, syncedNow: g.info.onServer, phone: g.info.phone };
  out.gDay = await L.localLicenseService.getExpiry();
  out.gClosed = refusedTimes;
  mode = 'ok';
  await L.localLicenseService.setExpiry('2030-01-01');
  await S.pushPending();

  // 9. sending turned off
  const hn = seen.length;
  L.syncFlag.push = false;
  const h = await S.save({ phone: '0556 00 00 01' });
  await S.pushPending();
  out.hSent = seen.length - hn;
  L.syncFlag.push = true;
  out.h = { sent: h.sentToServer, reason: h.reason, syncedNow: h.info.onServer };

  // 10. the sync pass: what is waiting is sent, with the tables
  serverIs(down);
  await S.save({ phone: '0556 00 00 02' });
  const down1 = await L.pushAll('manual');
  out.passDown = { outcome: down1.outcome, info: down1.shopInfo?.status, errors: down1.errors.map((x) => x.message).join('|') };
  serverIs(up);
  const upRun = await L.pushAll('manual');
  out.passUp = { outcome: upRun.outcome, info: upRun.shopInfo?.status, synced: (await row()).synced, errors: upRun.errors.length };
  const idle = await L.pushAll('manual');
  out.passIdle = { outcome: idle.outcome, info: idle.shopInfo };
  out.noneLeft = (await L.checkUnsynced()) === null;

  // the answers the server was sent, in the order of the requests
  out.methods = [...new Set(seen.map((s) => s.method + ' ' + s.url))].join();
  out.auth = [...new Set(seen.map((s) => s.auth))].join();
  out.api = require(ROOT + '/dist/ipc/channels.js').API_METHODS.shopInfo;

  await p.licenseExpiry.deleteMany();
  out.rowGone = await S.get();
  server.close();
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");
const NULLS = { name: null, phone: null, email: null, address: null, instagramUrl: null, tiktokUrl: null };

R.section("reading and saving");
R.ck(r.noRow === "not-found" && r.getNoRow === null, "with no licence row on this computer there is nowhere to keep the details: not-found (and get answers null)");
R.ck(r.start?.name === "Maison Clair" && r.start?.phone === "0550 00 00 00" && r.start?.onServer === true && r.startPending === false, "after the activation the details are there and synced (the server accepted them)", JSON.stringify(r.start));
R.ck(r.unchangedEmpty === "unchanged" && r.unchangedSame === "unchanged", "an empty form, or the same values, change nothing");
R.ck(r.invalid?.email && r.invalid?.phone, "a wrong value is refused, by field");
R.ck(r.noRequests === true && r.stillSynced === true, "and none of those sent anything or touched the row");

R.section("what is sent");
R.ck(r.a?.status === "saved" && JSON.stringify(r.a?.changed) === '["phone"]' && r.a?.sent === true && r.a?.syncedNow === true && r.a?.phone === "0661 11 22 33", "a change is saved, sent, and the row is synced again", JSON.stringify(r.a));
R.ck(r.aRequest?.method === "POST" && r.aRequest?.url === "/api/infos" && r.aRequest?.auth === "Bearer goodkey", "POST /api/infos with the tenant key as the Bearer token");
R.ck(JSON.stringify(r.aRequest?.body) === JSON.stringify({ ...NULLS, phone: "0661 11 22 33" }), "the body holds only the changed field; the other five are null", JSON.stringify(r.aRequest?.body));

R.section("the server can not be reached");
R.ck(r.b?.status === "saved" && r.b?.sent === false && r.b?.address === "12 Rue Didouche Mourad" && r.b?.syncedNow === false && /reach/i.test(r.b?.reason ?? ""), "the change is kept on this computer, unsynced, and the reason is given", JSON.stringify(r.b));
R.ck(r.bPending === true && r.bUnsyncedCount >= 1 && r.bFirstUnsynced === "shop_info", "it counts as waiting: the dashboard counts it and the unsynced check finds it");
R.ck(r.c?.sent === true && r.c?.syncedNow === true && r.cAfterPending === false, "a later change, with the server back, is sent and syncs the row");
R.ck(JSON.stringify(r.cRequest?.body) === JSON.stringify({ name: "Maison Clair", phone: "0661 11 22 33", email: "hello@maison.dz", address: "12 Rue Didouche Mourad", instagramUrl: "https://instagram.com/maison", tiktokUrl: null }), "and it carries every field that has a value: the address that never arrived is not lost", JSON.stringify(r.cRequest?.body));

R.section("the sync pass");
R.ck(r.pushNothing === "nothing-pending" && r.pushNothingRequests === 0, "with everything synced it sends nothing");
R.ck(r.d1?.status === "failed" && r.d1?.unreachable === true && r.d1Synced === false, "while the server is down the details stay unsynced");
R.ck(r.d2 === "sent" && r.d2Synced === true && r.d2Request?.name === "Maison Clair 2" && r.d2Request?.address === "12 Rue Didouche Mourad", "and the next try sends them all and marks them synced", JSON.stringify(r.d2Request));
R.ck(r.passDown?.outcome === "pushed" && r.passDown?.info === "failed" && /shop information/.test(r.passDown?.errors ?? ""), "a pass with the server down reports the details as failed", JSON.stringify(r.passDown));
R.ck(r.passUp?.outcome === "pushed" && r.passUp?.info === "sent" && r.passUp?.synced === true && r.passUp?.errors === 0, "a pass with the server back sends them and marks them synced", JSON.stringify(r.passUp));
R.ck(r.passIdle?.outcome === "nothing-to-push" && r.passIdle?.info === null && r.noneLeft === true, "a pass with nothing waiting touches no network, and nothing is left unsynced");

R.section("refusals and races");
R.ck(r.e?.sent === false && r.e?.syncedNow === false && r.e?.tiktok === "https://tiktok.com/@maison" && /e-mail address/.test(r.e?.reason ?? ""), "a value the server refuses stays saved, unsynced, with the server's reason", JSON.stringify(r.e));
R.ck(r.e500?.status === "failed" && r.eWeird === "failed" && r.eRetry === "sent" && r.eRetrySynced === true, "a failing server, or an answer that is not the endpoint's, leaves it unsynced; a good answer later syncs it");
R.ck(r.f?.sent === true && r.f?.syncedNow === false && r.f?.phone === "0770 99 99 99" && r.fRetry === "sent" && r.fSynced === true && r.fRequest?.phone === "0770 99 99 99", "an edit made while a request is on its way is not marked synced by it: the next pass sends the newer values", JSON.stringify(r.f));
R.ck(r.g?.sent === false && r.g?.syncedNow === false && r.g?.phone === "0555 12 12 12" && r.gDay === "1970-01-01" && r.gClosed === 1, "when the server turns the shop away (401 UNAUTHORIZED) the change is kept, an old expiry day is saved and the app is told to close, once", JSON.stringify([r.g, r.gDay, r.gClosed]));
R.ck(r.h?.sent === false && r.h?.syncedNow === false && /turned off/.test(r.h?.reason ?? "") && r.hSent === 0, "with sending turned off the change stays local and nothing is sent");
R.ck(r.rowGone === null, "(and get is null again when the row is gone)");
R.ck(r.methods === "POST /api/infos" && r.auth === "Bearer goodkey", "only POST /api/infos was called, always with the tenant key");
R.ck(r.api?.join() === "get,save,isPending,pushPending", "shopInfo is on the list of what the window may call");
process.exit(R.done());
