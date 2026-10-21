// Label printing through Electron's real print pipeline, written to PDF (OPTIPRO_LABEL_PDF_DIR) so it can be looked at: one page per label, each page
// exactly the label's size. Run with ELECTRON (not node mode), after `npm run build`:  npm run test:labels-pdf
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");

const ROOT = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-label-pdf-"));
process.env.SQLITE_DATABASE_URL = path.join(dir, "local.db");
process.env.OPTIPRO_LABEL_PDF_DIR = path.join(dir, "pdf");
const cfg = path.join(dir, "c.properties");
process.env.OPTIPRO_CONFIG_FILE = cfg;

const results = [];
const check = (ok, label, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const mmToPt = (mm) => (mm * 72) / 25.4;
const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

function pdfInfo(file) {
  const text = fs.readFileSync(file).toString("latin1");
  const counts = [...text.matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { pages: counts.length ? Math.max(...counts) : 0, width: box ? Number(box[1]) : NaN, height: box ? Number(box[2]) : NaN };
}

// The hidden print windows are the only windows here: do not quit when the last one closes (the real app always has its main window).
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  try {
    const { localLabelService: L, setLabelPrinter } = require(path.join(ROOT, "dist/local/labelService.js"));
    const { electronLabelPrinter } = require(path.join(ROOT, "dist/labelPrinter.js"));
    setLabelPrinter(electronLabelPrinter);

    for (const [w, h, copies] of [[30, 20, 3], [40, 25, 1], [50, 30, 5]]) {
      fs.writeFileSync(cfg, ["server.url=https://shop.example.com", "tenant.key=t1", `label.width=${w}`, `label.height=${h}`, ""].join("\n"));
      const r = await L.print({ kind: "frame", code: "abc-123", copies });
      check(r.status === "saved" && r.labels === copies && fs.existsSync(r.file), `${w} x ${h} mm, ${copies} label(s): the pipeline wrote a PDF`, r.file);
      const info = pdfInfo(r.file);
      check(info.pages === copies, `  ${copies} label(s) = ${copies} page(s) (one per label, no blank page at the end)`, `pages ${info.pages}`);
      check(near(info.width, mmToPt(w)) && near(info.height, mmToPt(h)), `  every page is ${w} x ${h} mm (${mmToPt(w).toFixed(1)} x ${mmToPt(h).toFixed(1)} pt)`, `got ${info.width} x ${info.height} pt`);
    }

    // an accessory too, and the file name carries the code
    fs.writeFileSync(cfg, ["server.url=https://shop.example.com", "tenant.key=t1", ""].join("\n"));
    const acc = await L.print({ kind: "accessory", code: "xyz-111", copies: 2 });
    const accInfo = pdfInfo(acc.file);
    check(/labels-xyz-111-2\.pdf$/.test(acc.file) && accInfo.pages === 2 && near(accInfo.width, mmToPt(40)) && near(accInfo.height, mmToPt(25)), "an accessory's labels too (the default 40 x 25 mm, 2 pages)", JSON.stringify(accInfo));
  } catch (error) {
    check(false, "ERR", error.stack);
  }
  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} passed`);
  app.exit(passed === results.length ? 0 : 1);
});
