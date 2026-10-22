// Runs the tests in this folder:  npm test            (all of them)
//                                  npm test -- labels  (only the files whose name contains "labels")
// Each file is started the way it needs: "service" tests in Electron-as-node (the app's database code), "electron" tests in Electron itself (printing),
// "window" tests with plain node (they start the app and drive its window). Run `npm run build` first: the tests use the compiled app in dist/.
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");

const TESTS = [
  { file: "labels.service.test.cjs", how: "electron-as-node" },
  { file: "labels.pdf.electron.cjs", how: "electron" },
  { file: "labels.render.electron.cjs", how: "electron" },
  { file: "labels.window.test.cjs", how: "node" },
  { file: "sales.window.test.cjs", how: "node" },
  { file: "payments.window.test.cjs", how: "node" },
  { file: "orderDetails.window.test.cjs", how: "node" },
  { file: "i18n.dictionary.test.cjs", how: "node" },
  { file: "i18n.window.test.cjs", how: "node" },
  { file: "setup.window.test.cjs", how: "node" },
  { file: "editMenu.test.cjs", how: "node" },
  { file: "setupRetry.test.cjs", how: "node" },
  { file: "refusalPaths.test.cjs", how: "node" },
  { file: "lensMatching.test.cjs", how: "node" },
  { file: "lensMatching.service.test.cjs", how: "node" },
  { file: "productSearch.test.cjs", how: "node" },
  { file: "newOrder.window.test.cjs", how: "node" },
  { file: "orderPlacement.test.cjs", how: "node" },
  { file: "documents.test.cjs", how: "node" },
  { file: "suppliers.test.cjs", how: "node" },
  { file: "suppliers.window.test.cjs", how: "node" },
  { file: "shopInfo.test.cjs", how: "node" },
  { file: "settings.window.test.cjs", how: "node" },
  { file: "newOrder.place.window.test.cjs", how: "node" },
  { file: "expiry.window.test.cjs", how: "node" },
  { file: "refusal.test.cjs", how: "node" },
  { file: "expiryCheck.test.cjs", how: "node" },
  { file: "licenseExpiry.test.cjs", how: "node" },
  { file: "register.test.cjs", how: "node" },
  { file: "infos.test.cjs", how: "node" },
];

const filter = process.argv[2] ?? "";
let failed = 0;
for (const test of TESTS.filter((t) => t.file.includes(filter))) {
  console.log(`\n=== ${test.file} (${test.how})`);
  const file = path.join(__dirname, test.file);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let result;
  if (test.how === "node") result = spawnSync(process.execPath, [file], { stdio: "inherit", env });
  else if (test.how === "electron") result = spawnSync(ELECTRON, [file], { stdio: ["ignore", "pipe", "inherit"], env, encoding: "utf8" });
  else result = spawnSync(ELECTRON, [file], { stdio: "inherit", env: { ...env, ELECTRON_RUN_AS_NODE: "1" } });
  if (test.how === "electron") process.stdout.write(result.stdout ?? ""); // Electron prints through a pipe, not to the console directly
  if (result.status !== 0) failed++;
}
console.log(failed === 0 ? "\nAll test files passed." : `\n${failed} test file(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
