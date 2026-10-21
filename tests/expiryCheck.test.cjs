// The start-up check with the server: GET <server.url>/api/expiry with the tenant key.
//   200 with a day   -> saved in the local license_expiry table
//   401 UNAUTHORIZED -> a very old day is saved and the app closes
//   anything else, no network, no answer in time -> nothing changes (the day saved locally decides)
// Service level (a local fake server answers) and window level (the real app starts with it).
const http = require("node:http");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

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
  const { checkExpiryWithServer, localLicenseService } = require(ROOT + '/dist/local/index.js');
  const guard = require(ROOT + '/dist/local/licenseGuard.js');
  let closed = 0;
  guard.setUnauthorizedHandler(() => { closed += 1; });
  const results = {};
  const seen = [];
  async function scenario(name, status, body, { delay = 0, timeout } = {}) {
    const server = http.createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
      setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }, delay);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'server.url=http://127.0.0.1:' + server.address().port + '\\ntenant.key=t1\\n');
    await p.licenseExpiry.deleteMany();
    await localLicenseService.setExpiry('2030-01-01'); // what was saved before
    guard.resetRefusalReport();
    closed = 0;
    const started = Date.now();
    const answer = await checkExpiryWithServer(fetch, timeout);
    results[name] = { answer, saved: await localLicenseService.getExpiry(), closed, ms: Date.now() - started };
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
  await scenario('200 with a bad day', 200, { expiry: 'soon' });
  await scenario('200 that is not JSON', 200, 'not json');
  await scenario('no answer in time', 200, { expiry: '2040-01-01' }, { delay: 3000, timeout: 300 });
  // no server at all
  await p.licenseExpiry.deleteMany();
  await localLicenseService.setExpiry('2030-01-01');
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'server.url=http://127.0.0.1:9\\ntenant.key=t1\\n');
  results.unreachable = { answer: await checkExpiryWithServer(), saved: await localLicenseService.getExpiry(), closed };
  // no settings
  fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'label.width=40\\n');
  results.noSettings = { answer: await checkExpiryWithServer(), saved: await localLicenseService.getExpiry() };
  results.request = seen[0];
  process.stdout.write('RESULT ' + JSON.stringify(results) + '\\n', () => process.exit(0));
`,
);
const results = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("service");
R.ck(results.request?.method === "GET" && results.request?.url === "/api/expiry" && results.request?.authorization === "Bearer t1", "it asks GET /api/expiry with the tenant key as the Authorization header", JSON.stringify(results.request));
const a = results["a day"];
R.ck(a?.answer === "valid" && a?.saved === "2031-05-06" && a?.closed === 0, "a day from the server is saved locally (it replaces the one that was there)", JSON.stringify(a));
const n = results["no day on the server"];
R.ck(n?.answer === "valid" && n?.saved === "2030-01-01", "a server that holds no day leaves the local one", JSON.stringify(n));
const u = results["unauthorized"];
R.ck(u?.answer === "refused" && u?.saved === "1970-01-01" && u?.closed === 1, "401 UNAUTHORIZED: a very old day is saved and the app closes", JSON.stringify(u));
for (const name of ["401 without the code", "401 other code", "404 (a server without this address)", "429", "500", "200 that is not an expiry", "200 with a bad day", "200 that is not JSON", "no answer in time"]) {
  const r = results[name];
  R.ck(r?.answer === "offline" && r?.saved === "2030-01-01" && r?.closed === 0, `${name}: the local day decides (nothing changes, the app stays open)`, JSON.stringify(r));
}
R.ck(results["no answer in time"]?.ms < 2500, "and the check gives up when the server does not answer in time");
R.ck(results.unreachable?.answer === "offline" && results.unreachable?.saved === "2030-01-01" && results.unreachable?.closed === 0, "no network / an unreachable server: the local day decides");
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
  runScript(b, `await p.licenseExpiry.create({ data: { id: 1, expiresAt: new Date('2030-01-01T00:00:00Z') } });`);
  const A = await launchApp(b, {}, APP);
  try {
    R.ck(await A.until("document.querySelector('.nav-item') !== null && typeof window.electronAPI?.customers?.list === 'function'"), "the app starts when the server sends a day");
    R.ck(server.requests.includes("GET /api/expiry"), "and it asked GET /api/expiry at start");
    const saved = /SAVED (.*)/.exec(runScript(b, "console.log('SAVED ' + JSON.stringify((await p.licenseExpiry.findMany()).map((r) => r.expiresAt.toISOString().slice(0, 10))));"))?.[1];
    R.ck(saved === '["2031-05-06"]', "the day the server sent replaced the local one", saved);
  } finally {
    await A.stop();
  }
  fake.close();
  process.exit(R.done());
})();
