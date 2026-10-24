// When the server turns the shop away (HTTP 401 with the code UNAUTHORIZED, from the table API or a photo upload), the app removes the settings file and closes;
// the next start opens the setup page. Nothing else does that. Service level (a local fake server answers) and window level (the real app is refused while it syncs).
const http = require("node:http");
const fs = require("node:fs");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const EXPIRED = /renderer[\\/]expired\.html/;
const APP = /renderer[\\/]index\.html/;

// ---- service level
const box = sandbox("op-refusal-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
const out = runScript(
  box,
  `
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const { localCustomerService, localImageService } = require(ROOT + '/dist/local/index.js');
  const guard = require(ROOT + '/dist/local/licenseGuard.js');
  let closed = 0;
  guard.setUnauthorizedHandler(() => { closed += 1; });
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const results = {};
  let n = 0;
  async function scenario(name, status, body, how) {
    const server = http.createServer((req, res) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'server.url=http://127.0.0.1:' + server.address().port + '\\ntenant.key=t1\\n');
    guard.resetRefusalReport();
    closed = 0;
    if (how === 'table') await localCustomerService.insert({ name: 'C' + (++n) }).catch(() => {});
    else await localImageService.upload('frame', 'abc', PNG).catch(() => {});
    results[name] = { settingsKept: fs.existsSync(process.env.OPTIPRO_CONFIG_FILE), closed };
    server.close();
  }
  for (const how of ['table', 'photo']) {
    await scenario(how + ' 401 UNAUTHORIZED', 401, { error: 'x', code: 'UNAUTHORIZED' }, how);
    await scenario(how + ' 401 without the code', 401, { error: 'x' }, how);
    await scenario(how + ' 401 other code', 401, { error: 'x', code: 'SOMETHING' }, how);
    await scenario(how + ' 429', 429, { error: 'x', code: 'TOO_MANY_ATTEMPTS' }, how);
    await scenario(how + ' 500', 500, { error: 'x', code: 'SERVER_ERROR' }, how);
    await scenario(how + ' 403', 403, { error: 'x', code: 'ACTION_NOT_ALLOWED' }, how);
  }
  // a refusal twice closes the app once
  guard.resetRefusalReport(); closed = 0;
  const again = http.createServer((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'x', code: 'UNAUTHORIZED' })); });
  await new Promise((r) => again.listen(0, '127.0.0.1', r));
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'server.url=http://127.0.0.1:' + again.address().port + '\\ntenant.key=t1\\n');
  await localCustomerService.insert({ name: 'Twice 1' }).catch(() => {});
  await localCustomerService.insert({ name: 'Twice 2' }).catch(() => {});
  results.twice = { closed };
  // unreachable server (last: the sync stops trying for a while after it)
  guard.resetRefusalReport(); closed = 0;
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'server.url=http://127.0.0.1:9\\ntenant.key=t1\\n');
  await localCustomerService.insert({ name: 'Offline' }).catch(() => {});
  results.unreachable = { settingsKept: fs.existsSync(process.env.OPTIPRO_CONFIG_FILE), closed };
  process.stdout.write('RESULT ' + JSON.stringify(results) + '\\n', () => process.exit(0));
`,
);
const results = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("service");
for (const how of ["table", "photo"]) {
  const refused = results[`${how} 401 UNAUTHORIZED`];
  R.ck(refused?.settingsKept === false && refused?.closed === 1, `${how}: a 401 UNAUTHORIZED removes the settings file and closes the app`, JSON.stringify(refused));
  for (const other of ["401 without the code", "401 other code", "429", "500", "403"]) {
    const r = results[`${how} ${other}`];
    R.ck(r?.settingsKept === true && r?.closed === 0, `${how}: ${other} changes nothing`, JSON.stringify(r));
  }
}
R.ck(results.unreachable?.settingsKept === true && results.unreachable?.closed === 0, "an unreachable server changes nothing");
R.ck(results.twice?.closed === 1, "the app is closed once however many refusals come");

// ---- window level
async function exited(port, ms = 12000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(800) });
    } catch {
      return true;
    }
    await sleep(300);
  }
  return false;
}

(async () => {
  /** A server that answers /api/expiry and everything else as told. */
  async function fake(expiryAnswer, otherAnswer) {
    const server = http.createServer((req, res) => {
      req.resume();
      const [status, body] = req.url.startsWith("/api/expiry") ? expiryAnswer : otherAnswer;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server;
  }
  const REFUSE = [401, { error: "A valid tenant key is required", code: "UNAUTHORIZED" }];
  const pages = async (port) => (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) })).json()).filter((x) => x.type === "page").map((x) => x.url);

  // (a refusal at start, the first request of a run, is tested in expiry.window.test.cjs)
  R.section("window: refused later, while it syncs");
  {
    const server = await fake([200, { expiry: "2031-05-06" }], REFUSE);
    const b = sandbox("op-refused-sync-");
    b.writeConfig([`server.url=http://127.0.0.1:${server.address().port}`, "tenant.key=t1"]);
    runScript(b, "await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } }); await p.customer.create({ data: { id: 'c1', name: 'Waiting to sync', tenantKey: 't1', synced: false } });");
    // (the refusal comes within a moment of starting, and the app's own page is destroyed with it: the test attaches to the page that stays, the expired one)
    const A = await launchApp(b, {}, EXPIRED);
    try {
      let shown = false;
      for (let i = 0; i < 60 && !shown; i++) {
        const open = await pages(A.port).catch(() => []);
        shown = open.some((u) => EXPIRED.test(u)) && !open.some((u) => APP.test(u));
        if (!shown) await sleep(300);
      }
      R.ck(shown, "the server accepts the key at start, then refuses it while the app syncs: the app's window is replaced by the page that says so");
    } finally {
      await A.stop();
    }
    R.ck(!fs.existsSync(b.config) && fs.existsSync(b.config + ".expired"), "and the settings file is renamed (config.properties.expired), not lost");
    server.close();
  }
  process.exit(R.done());
})();
