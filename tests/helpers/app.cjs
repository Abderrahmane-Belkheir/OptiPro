// A small harness for tests that drive the real app window: starts the app on a throw-away database, connects over the DevTools protocol, and lets a test
// evaluate code in the page. Run the tests with plain `node` after `npm run build`. Nothing here touches the real app data.
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A throw-away folder with a database path, a settings file and folders for photos and printed labels. */
function sandbox(prefix = "op-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = { dir, db: path.join(dir, "local.db"), config: path.join(dir, "config.properties"), images: path.join(dir, "images"), pdf: path.join(dir, "pdf") };
  const writeConfig = (lines) => fs.writeFileSync(paths.config, [...lines, ""].join("\n"));
  return { ...paths, writeConfig };
}

/** Runs a script (a string of JavaScript) in Electron-as-node against the sandbox's database: for putting rows in before the app starts. */
function runScript(box, source) {
  const file = path.join(box.dir, `script-${Math.random().toString(16).slice(2)}.cjs`);
  fs.writeFileSync(file, `process.env.SQLITE_DATABASE_URL=${JSON.stringify(box.db)}; process.env.OPTIPRO_CONFIG_FILE=${JSON.stringify(box.config)};\nconst ROOT=${JSON.stringify(ROOT)};\nconst {sqlitePrisma:p}=require(ROOT+'/dist/lib/sqliteClient.js');\n(async()=>{\n${source}\nawait p.$disconnect();\n})().catch((e)=>{console.error(e);process.exit(1)});`);
  const r = spawnSync(ELECTRON, [file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", OPTIPRO_PUSH_WAIT_MS: process.env.OPTIPRO_PUSH_WAIT_MS ?? "60000" }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`script failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

/** Starts the app on the sandbox and answers { val, until, stop, problems }. `val(expr)` evaluates a JS expression in the page and returns its JSON value. */
async function launchApp(box, extraEnv = {}, page = /renderer[\\/]index\.html/) {
  const port = await freePort();
  const env = { ...process.env, SQLITE_DATABASE_URL: box.db, OPTIPRO_CONFIG_FILE: box.config, OPTIPRO_IMAGES_DIR: box.images, OPTIPRO_LABEL_PDF_DIR: box.pdf, OPTIPRO_PUSH_WAIT_MS: "60000", ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(ELECTRON, [".", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(box.dir, "electron-profile")}`, // (its own profile: the tests never read or change the real app's saved settings, such as its language)
     "--disable-features=CalculateNativeWinOcclusion"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  app.stdout.on("data", (d) => (log += d));
  app.stderr.on("data", (d) => (log += d));

  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) })).json()).find((t) => t.type === "page" && page.test(t.url))?.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    if (!wsUrl) await sleep(150);
  }
  if (!wsUrl) throw new Error(`the app window did not open: ${log.slice(-400)}`);

  const ws = new WebSocket(wsUrl);
  // (an app that closes itself before the connection opens must not leave the test waiting for ever)
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("the app closed before the test could connect to it"));
      ws.onclose = () => reject(new Error("the app closed before the test could connect to it"));
      setTimeout(() => reject(new Error("the test could not connect to the app in time")), 8000);
    });
  } catch (error) {
    try { execSync(`taskkill /F /T /PID ${app.pid}`, { stdio: "ignore" }); } catch { /* already gone */ }
    throw error;
  }
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (message) => {
    const m = JSON.parse(message.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push(m.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.bringToFront");

  const val = async (expression) => {
    const r = await send("Runtime.evaluate", { expression: `(async()=>JSON.stringify(await(${expression})))()`, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    const v = r.result.result.value;
    return v === undefined ? undefined : JSON.parse(v);
  };
  const until = async (expression, ms = 8000) => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      try {
        if (await val(expression)) return true;
      } catch {
        /* keep trying */
      }
      await sleep(120);
    }
    return false;
  };
  const stop = async () => {
    try { ws.close(); } catch { /* already closed */ }
    try { execSync(`taskkill /F /T /PID ${app.pid}`, { stdio: "ignore" }); } catch { /* already gone */ }
    await sleep(600);
  };
  return { val, until, stop, problems, port, log: () => log };
}

/** A tiny test runner: `ck(ok, label, detail)` records and prints; `done()` prints the total and answers the exit code. */
function recorder() {
  const results = [];
  let section = "";
  return {
    section: (name) => { section = name; },
    ck(ok, label, detail = "") { results.push(Boolean(ok)); console.log(`${ok ? "PASS" : "FAIL"}  [${section}] ${label}${detail ? "  " + detail : ""}`); },
    done() { const n = results.filter(Boolean).length; console.log(`${n}/${results.length} passed`); return n === results.length ? 0 : 1; },
  };
}

module.exports = { ROOT, sandbox, runScript, launchApp, recorder, sleep };
