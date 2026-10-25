// One copy of the app per computer: the icon clicked twice must not start a second copy on the same database (two copies numbering orders at once, two syncs).
// The second copy ends by itself and the first stays as it was.
const path = require("node:path");
const { spawn, execSync } = require("node:child_process");
const { sandbox, launchApp, recorder, sleep, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-single-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");

(async () => {
  const A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.dashboard?.month === 'function'", 20000);
    // the same program, the same profile (the same user data folder), started again
    const env = { ...process.env, SQLITE_DATABASE_URL: box.db, OPTIPRO_CONFIG_FILE: box.config, OPTIPRO_IMAGES_DIR: box.images, OPTIPRO_LABEL_PDF_DIR: box.pdf };
    delete env.ELECTRON_RUN_AS_NODE;
    const second = spawn(ELECTRON, [".", `--user-data-dir=${path.join(box.dir, "electron-profile")}`], { cwd: ROOT, env, stdio: "ignore" });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve("still running"), 15000);
      second.on("exit", (c) => { clearTimeout(timer); resolve(c); });
    });
    R.ck(code !== "still running", "the second copy ends by itself", String(code));
    if (code === "still running") { try { execSync(`taskkill /F /T /PID ${second.pid}`, { stdio: "ignore" }); } catch { /* gone */ } }
    R.ck(await A.val("window.electronAPI.dashboard.month().then((m) => typeof m.orders === 'number')"), "the first copy is as it was, and still answers");
    const windows = (await (await fetch(`http://127.0.0.1:${A.port}/json`)).json()).filter((t) => t.type === "page" && /index\.html/.test(t.url));
    R.ck(windows.length === 1, "and it is still the only window", String(windows.length));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
