// Every way the app talks to the server for syncing: a 401 UNAUTHORIZED must stop it (the settings file removed, the app told to stop, once).
// The paths: inserting, updating, deleting a row right away, the queue of deletions that waits for the server, and the upload of a photo.
// Anything else the server may answer (401 without the code, 403, 429, 500) must not.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-refusalpaths-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

const out = runScript(
  box,
  `
  const http = require('node:http');
  const fs = require('node:fs');
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Existing', tenantKey: 't1', synced: true } });
  const L = require(ROOT + '/dist/local/index.js');
  const guard = require(ROOT + '/dist/local/licenseGuard.js');
  let closed = 0;
  guard.setUnauthorizedHandler(() => { closed += 1; });
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const paths = {
    'insert a row': () => L.localCustomerService.insert({ yearOfBirth: 1990, name: 'New ' + Math.random() }),
    'update a row': () => L.localCustomerService.update('c1', { name: 'Renamed ' + Math.random() }),
    'delete a row right away': async () => { const id = 'now-' + Math.random(); await L.queueDeletion('frame', id); return L.attemptDeletion('frame', id); }, // (the app queues a deletion first, then tries it at once)
    'the queue of waiting deletions': async () => { await L.queueDeletion('frame', 'queued-' + Math.random()); return L.pushPendingDeletions(); },
    'upload a photo': () => L.localImageService.upload('frame', 'abc', PNG),
  };
  const answers = {
    'UNAUTHORIZED': [401, { error: 'x', code: 'UNAUTHORIZED' }],
    '401 without the code': [401, { error: 'x' }],
    '403': [403, { error: 'x', code: 'ACTION_NOT_ALLOWED' }],
    '429': [429, { error: 'x', code: 'TOO_MANY_ATTEMPTS' }],
    '500': [500, { error: 'x', code: 'SERVER_ERROR' }],
  };
  const results = {};
  for (const [pathName, run] of Object.entries(paths)) {
    for (const [answerName, [status, body]] of Object.entries(answers)) {
      const server = http.createServer((req, res) => { req.resume(); res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      fs.writeFileSync(process.env.OPTIPRO_CONFIG_FILE, 'server.url=http://127.0.0.1:' + server.address().port + '\\ntenant.key=t1\\n');
      guard.resetRefusalReport();
      L.resetTableApiCircuit();
      closed = 0;
      await Promise.resolve(run()).catch(() => {});
      results[pathName + ' | ' + answerName] = { settingsKept: fs.existsSync(process.env.OPTIPRO_CONFIG_FILE), closed };
      server.close();
    }
  }
  process.stdout.write('RESULT ' + JSON.stringify(results) + '\\n', () => process.exit(0));
`,
);
const results = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

for (const path of ["insert a row", "update a row", "delete a row right away", "the queue of waiting deletions", "upload a photo"]) {
  R.section(path);
  const refused = results[`${path} | UNAUTHORIZED`];
  R.ck(refused?.settingsKept === false && refused?.closed === 1, "401 UNAUTHORIZED: the settings file is removed and the app is told to stop", JSON.stringify(refused));
  for (const other of ["401 without the code", "403", "429", "500"]) {
    const r = results[`${path} | ${other}`];
    R.ck(r?.settingsKept === true && r?.closed === 0, `${other}: nothing is removed, the app is not stopped`, JSON.stringify(r));
  }
}
process.exit(R.done());
