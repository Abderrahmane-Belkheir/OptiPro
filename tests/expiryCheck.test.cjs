// The start-up check with the server: the FIRST request of a run, GET <server.url>/api/expiry with the tenant key. Nothing about the licence is kept on this computer:
//   200               -> valid, the app starts (a day the server sends is not kept)
//   401 UNAUTHORIZED  -> refused: the settings file is renamed (config.properties.expired, the key stays in it) and the app closes
//   anything else, no network, no answer in time -> offline: nothing changes, the app starts as usual
// Service level (a local fake server answers) and window level (the real app starts with it).
const http = require("node:http");
const fs = require("node:fs");
const { sandbox, runScript, launchApp, recorder } = require("./helpers/app.cjs");

const R = recorder();
const APP = /renderer[\\/]index\.html/;

// ---- service level
const box = sandbox("op-expirycheck-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
const out = runScript(
  box,
  `
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const { checkExpiryWithServer } = require(ROOT + '/dist/local/index.js');
  const guard = require(ROOT + '/dist/local/licenseGuard.js');
  let closed = 0;
  guard.setUnauthorizedHandler(() => { closed += 1; });
  const results = {};
  const seen = [];
  const file = process.env.OPTIPRO_CONFIG_FILE;
  async function scenario(name, status, body, { delay = 0, timeout } = {}) {
    const server = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }, delay);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    fs.writeFileSync(file, 'server.url=http://127.0.0.1:' + server.address().port + '\\ntenant.key=t1\\nlabel.width=40\\n');
    guard.resetRefusalReport();
    closed = 0;
    const started = Date.now();
    const answer = await checkExpiryWithServer(fetch, timeout);
    results[name] = { answer, settingsKept: fs.existsSync(file), renamedKept: fs.existsSync(file + '.expired'), renamedHasKey: fs.existsSync(file + '.expired') && fs.readFileSync(file + '.expired', 'utf8').includes('tenant.key=t1') && fs.readFileSync(file + '.expired', 'utf8').includes('label.width=40'), closed, ms: Date.now() - started, rows: await p.licenseExpiry.count() };
    fs.rmSync(file + '.expired', { force: true });
    server.close();
  }
  await scenario('a day', 200, { expiry: '2031-05-06' });
  await scenario('no day on the server', 200, { expiry: null });
  await scenario('unauthorized', 401, { error: 'x', code: 'UNAUTHORIZED' });
  await scenario('401 without the code', 401, { error: 'x' });
  await scenario('401 other code', 401, { error: 'x', code: 'OTHER' });
  await scenario('404 (a server without this address)', 404, { error: 'Not found.' });
  await scenario('429', 429, { error: 'x', code: 'TOO_MANY_ATTEMPTS' });
  await scenario('500', 500, { error: 'x', code: 'SERVER_ERROR' });
  await scenario('200 that is not an expiry', 200, { hello: 'world' });
  await scenario('200 that is not JSON', 200, 'not json');
  await scenario('no answer in time', 200, { expiry: '2040-01-01' }, { delay: 3000, timeout: 300 });
  // refused twice in a run: it acts on the first answer only
  {
    const server = http.createServer((req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code: 'UNAUTHORIZED' })); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    fs.writeFileSync(file, 'server.url=http://127.0.0.1:' + server.address().port + '\\ntenant.key=t1\\n');
    guard.resetRefusalReport();
    closed = 0;
    await checkExpiryWithServer();
    fs.writeFileSync(file, 'server.url=http://127.0.0.1:' + server.address().port + '\\ntenant.key=t2\\n'); // (a file written again, e.g. a new key typed in)
    await checkExpiryWithServer();
    results.twice = { closed, secondFileKept: fs.existsSync(file) };
    server.close();
  }
  // no server at all
  closed = 0;
  guard.resetRefusalReport();
  fs.writeFileSync(file, 'server.url=http://127.0.0.1:9\\ntenant.key=t1\\n');
  results.unreachable = { answer: await checkExpiryWithServer(), settingsKept: fs.existsSync(file), closed };
  // no settings
  fs.writeFileSync(file, 'label.width=40\\n');
  results.noSettings = { answer: await checkExpiryWithServer() };
  results.request = seen[0];
  process.stdout.write('RESULT ' + JSON.stringify(results) + '\\n', () => process.exit(0));
`,
);
const results = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("service");
R.ck(results.request?.method === "GET" && results.request?.url === "/api/expiry" && results.request?.authorization === "Bearer t1", "it asks GET /api/expiry with the tenant key as the Authorization header", JSON.stringify(results.request));
for (const name of ["a day", "no day on the server"]) {
  const r = results[name];
  R.ck(r?.answer === "valid" && r?.settingsKept === true && r?.closed === 0 && r?.rows === 0, `${name}: valid, the settings stay, the app stays open, and nothing about the licence is saved on this computer`, JSON.stringify(r));
}
const u = results["unauthorized"];
R.ck(u?.answer === "refused" && u?.settingsKept === false && u?.closed === 1, "401 UNAUTHORIZED: the settings file is renamed away and the app is told to close", JSON.stringify(u));
R.ck(u?.renamedKept === true && u?.renamedHasKey === true, "and nothing is lost: the renamed file (config.properties.expired) still holds the key, the address and the other settings", JSON.stringify(u));
for (const name of ["401 without the code", "401 other code", "404 (a server without this address)", "429", "500", "200 that is not an expiry", "200 that is not JSON", "no answer in time"]) {
  const r = results[name];
  R.ck(r?.answer === "offline" && r?.settingsKept === true && r?.renamedKept === false && r?.closed === 0, `${name}: nothing changes (the settings stay, nothing is renamed, the app stays open)`, JSON.stringify(r));
}
R.ck(results["no answer in time"]?.ms < 2500, "and the check gives up when the server does not answer in time");
R.ck(results.twice?.closed === 1 && results.twice?.secondFileKept === true, "refused twice in one run: it acts on the FIRST answer only (the app is told once, a settings file written afterwards is not removed again)", JSON.stringify(results.twice));
R.ck(results.unreachable?.answer === "offline" && results.unreachable?.settingsKept === true && results.unreachable?.closed === 0, "no network / an unreachable server: the app starts as usual, the settings stay");
R.ck(results.noSettings?.answer === "offline", "without settings it does not ask anyone");

// ---- window level
(async () => {
  R.section("window");
  const server = { requests: [], status: 200, body: { expiry: "2031-05-06" } };
  const fake = http.createServer((req, res) => {
    req.resume();
    server.requests.push(`${req.method} ${req.url}`);
    res.writeHead(server.status, { "content-type": "application/json" });
    res.end(JSON.stringify(server.body));
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const b = sandbox("op-expirywin-");
  b.writeConfig([`server.url=http://127.0.0.1:${fake.address().port}`, "tenant.key=t1"]);
  const A = await launchApp(b, {}, APP);
  try {
    R.ck(await A.until("document.querySelector('.nav-item') !== null && typeof window.electronAPI?.customers?.list === 'function'"), "the app starts when the server accepts the key");
    R.ck(server.requests[0] === "GET /api/expiry", "and its first request was GET /api/expiry");
    R.ck(fs.existsSync(b.config), "the settings file is still there");
    const shop = /ROWS (.*)/.exec(runScript(b, "console.log('ROWS ' + JSON.stringify({ rows: await p.licenseExpiry.count(), columns: (await p.$queryRawUnsafe('PRAGMA table_info(\\\"license_expiry\\\")')).map((c) => c.name) }));"))?.[1];
    const parsed = JSON.parse(shop ?? "null");
    R.ck(parsed?.rows === 1 && !parsed?.columns?.includes("expires_at"), "the shop's row exists (the settings can edit it) and keeps no date", shop);
  } finally {
    await A.stop();
  }
  fake.close();
  process.exit(R.done());
})();
