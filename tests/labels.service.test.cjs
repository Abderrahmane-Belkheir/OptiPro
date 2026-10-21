// Label printing, service level (no window, no printer): the settings, the layout of a label, reading a scan, and the checks before printing.
// Run (from the project folder, after `npm run build`):  npm run test:labels-service
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-label-svc-"));
process.env.SQLITE_DATABASE_URL = path.join(dir, "local.db");
const cfg = path.join(dir, "c.properties");
process.env.OPTIPRO_CONFIG_FILE = cfg;
const write = (...lines) => fs.writeFileSync(cfg, [...lines, ""].join("\n"));

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${String(error.message).split("\n").slice(0, 3).join("\n      ")}`);
  }
}
const rejects = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected it to fail");
};

(async () => {
  const L = require(path.join(ROOT, "dist/local/labelService.js"));
  const svc = L.localLabelService;
  const base = ["server.url=https://shop.example.com", "tenant.key=t1"];

  // ---- settings
  await test("settings: defaults are 40 x 25 mm and no printer", async () => {
    write(...base);
    const s = await svc.settings();
    assert.equal(s.widthMm, 40);
    assert.equal(s.heightMm, 25);
    assert.equal(s.printer, null);
  });
  await test("settings: the QR code is measured in printer dots per square: 40 x 25 is safe, 30 x 20 is flagged (it fails under dot gain: see labels.render)", async () => {
    write(...base, "label.width=40", "label.height=25");
    const ok = await svc.settings();
    assert.ok(ok.qrModules >= 29 && ok.qrModules <= 45, String(ok.qrModules));
    assert.ok(ok.dotsPerModule >= L.MIN_DOTS_PER_MODULE, String(ok.dotsPerModule));
    assert.equal(ok.scanRisk, false);
    write(...base, "label.width=30", "label.height=20");
    const small = await svc.settings();
    assert.ok(small.dotsPerModule < L.MIN_DOTS_PER_MODULE, String(small.dotsPerModule));
    assert.equal(small.scanRisk, true);
  });
  await test("settings: a longer server address makes the QR code denser, so the same label gets riskier", async () => {
    write("server.url=https://a.dz", "tenant.key=t1", "label.width=40", "label.height=25");
    const short = await svc.settings();
    write("server.url=https://optique-boutique-algerie-alger-centre.example.com", "tenant.key=t1", "label.width=40", "label.height=25");
    const long = await svc.settings();
    assert.ok(long.qrModules > short.qrModules, `${long.qrModules} vs ${short.qrModules}`);
    assert.ok(long.dotsPerModule < short.dotsPerModule);
    assert.equal(short.scanRisk, false);
    assert.equal(long.scanRisk, true);
  });
  await test("settings: without server.url the address cannot be measured (no module count), and a small label is still flagged", async () => {
    write("tenant.key=t1", "label.width=40", "label.height=25");
    const a = await svc.settings();
    assert.equal(a.qrModules, null);
    assert.equal(a.dotsPerModule, null);
    assert.equal(a.scanRisk, false);
    write("tenant.key=t1", "label.width=40", "label.height=12");
    assert.equal((await svc.settings()).scanRisk, true);
  });
  await test("settings: label.width, label.height and label.printer are read (a comma decimal is fine)", async () => {
    write(...base, "label.width=40", "label.height=25,5", "label.printer=Xprinter XP-365B");
    const s = await svc.settings();
    assert.equal(s.widthMm, 40);
    assert.equal(s.heightMm, 25.5);
    assert.equal(s.printer, "Xprinter XP-365B");
  });
  await test("settings: a size that is not a number of millimetres (or out of 10 to 200) is a ConfigError that says how to fix it", async () => {
    for (const bad of ["abc", "5", "250", "-3"]) {
      write(...base, `label.width=${bad}`);
      const e = await rejects(svc.settings());
      assert.equal(e.name, "ConfigError", bad);
      assert.match(e.message, /label\.width/);
    }
  });

  // ---- layout
  await test("geometry: on a 30 x 20 label the QR code is about 13.9 mm (big enough to scan), code text 10 pt", () => {
    const g = L.labelGeometry(30, 20);
    assert.ok(g.qrMm >= 12 && g.qrMm <= 15, `qr ${g.qrMm}`);
    assert.equal(g.fontPt, 10);
  });
  await test("geometry: a very flat label makes the QR code too small, and the number says so (MIN_QR_MM = 12)", () => {
    assert.ok(L.labelGeometry(40, 12).qrMm < L.MIN_QR_MM);
    assert.ok(L.labelGeometry(50, 30).qrMm >= L.MIN_QR_MM);
  });
  await test("geometry: the QR code never exceeds the label's width, and text and QR fit the height", () => {
    for (const [w, h] of [[15, 40], [30, 20], [100, 100], [10, 10]]) {
      const g = L.labelGeometry(w, h);
      assert.ok(g.qrMm <= w - 2 + 1e-9 && g.qrMm >= 0, `${w}x${h}`);
      assert.ok(g.qrMm + g.fontPt * 0.3528 + 2 <= h + 0.7, `${w}x${h}`);
    }
  });
  await test("labelsHtml: one label per page, the page is the label's size, the QR code with the code below it", () => {
    const html = L.labelsHtml({ svg: "<svg id=qr></svg>", code: "abc-123", copies: 3, widthMm: 30, heightMm: 20 });
    assert.match(html, /@page \{ size: 30mm 20mm; margin: 0; \}/);
    assert.equal((html.match(/class="label"/g) || []).length, 3);
    assert.equal((html.match(/<svg id=qr><\/svg>/g) || []).length, 3);
    assert.equal((html.match(/<div class="code">abc-123<\/div>/g) || []).length, 3);
    assert.ok(html.indexOf('class="qr"') < html.indexOf('class="code"'), "the code is after the QR code");
    assert.match(html, /break-after: page/);
    assert.match(html, /\.label:last-child \{ break-after: auto/); // no empty page after the last label
    assert.match(html, /#000000/);
    assert.match(html, /#ffffff/);
  });
  await test("labelsHtml: the code is escaped (nothing typed can inject markup)", () => {
    const html = L.labelsHtml({ svg: "", code: '<b>"x"&', copies: 1, widthMm: 30, heightMm: 20 });
    assert.ok(!html.includes("<b>"));
    assert.match(html, /&lt;b&gt;&quot;x&quot;&amp;/);
  });

  // ---- scans
  await test("parseScan: a bare code (any case, spaces) is read", () => {
    assert.deepEqual(L.parseScan("abc-123"), { kind: null, code: "abc-123" });
    assert.deepEqual(L.parseScan("  ABC-123\n"), { kind: null, code: "abc-123" });
  });
  await test("parseScan: the address on a label's QR code says the kind and the code", () => {
    assert.deepEqual(L.parseScan("https://shop.example.com/frames/abc-123"), { kind: "frame", code: "abc-123" });
    assert.deepEqual(L.parseScan("http://localhost:8080/accessories/XYZ-007"), { kind: "accessory", code: "xyz-007" });
    assert.deepEqual(L.parseScan("https://shop.example.com/sub/path/frames/abc-123?x=1#y"), { kind: "frame", code: "abc-123" });
  });
  await test("parseScan: anything else is not a scan (it is just text to search for)", () => {
    for (const text of ["", "aviator", "abc-12", "abcd-123", "abc123", "https://shop.example.com/", "https://shop.example.com/lenses/abc-123", "https://shop.example.com/frames/not-a-code", "ftp://x/frames/abc-123", "javascript:alert(1)", null, 5, undefined]) {
      assert.equal(L.parseScan(text), null, String(text));
    }
  });

  // ---- printing
  const jobs = [];
  L.setLabelPrinter(async (html, settings, job) => {
    jobs.push({ html, settings, job });
    return { status: "sent", labels: job.copies };
  });
  await test("print: the labels are laid out at the label size and handed to the printer, with what to print", async () => {
    write(...base, "label.width=40", "label.height=25", "label.printer=My Printer");
    jobs.length = 0;
    const r = await svc.print({ kind: "frame", code: "ABC-123", copies: 4 });
    assert.deepEqual(r, { status: "sent", labels: 4 });
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].job, { kind: "frame", code: "abc-123", copies: 4 });
    assert.equal(jobs[0].settings.printer, "My Printer");
    assert.equal(jobs[0].settings.widthMm, 40);
    assert.match(jobs[0].html, /size: 40mm 25mm/);
    assert.equal((jobs[0].html.match(/class="label"/g) || []).length, 4);
    assert.match(jobs[0].html, /<svg/);
  });
  await test("print: the QR code on the page is the one for server.url + /accessories/ + the code (made here, not by the window)", async () => {
    write(...base);
    jobs.length = 0;
    await svc.print({ kind: "accessory", code: "xyz-111", copies: 1 });
    const QR = require(path.join(ROOT, "node_modules/qrcode"));
    const expected = await QR.toString("https://shop.example.com/accessories/xyz-111", { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
    assert.ok(jobs[0].html.includes(expected));
  });
  await test("print: copies must be a whole number from 1 to 200", async () => {
    write(...base);
    jobs.length = 0;
    for (const copies of [0, 201, 2.5, -1, "3", null, undefined, NaN]) {
      const e = await rejects(svc.print({ kind: "frame", code: "abc-123", copies }));
      assert.equal(e.kind, "invalid-input", String(copies));
    }
    assert.equal(jobs.length, 0, "nothing reached the printer");
    await svc.print({ kind: "frame", code: "abc-123", copies: 200 });
    assert.equal(jobs.length, 1);
  });
  await test("print: a bad code or kind is refused, and nothing reaches the printer", async () => {
    write(...base);
    jobs.length = 0;
    assert.equal((await rejects(svc.print({ kind: "frame", code: "nope", copies: 1 }))).kind, "invalid-input");
    assert.equal((await rejects(svc.print({ kind: "lens", code: "abc-123", copies: 1 }))).kind, "invalid-input");
    assert.equal((await rejects(svc.print(null))).kind, "invalid-input");
    assert.equal(jobs.length, 0);
  });
  await test("print: without server.url it says what to add (no QR address can be made); with a bad label size it says so", async () => {
    write("tenant.key=t1");
    assert.match((await rejects(svc.print({ kind: "frame", code: "abc-123", copies: 1 }))).message, /server\.url/);
    write(...base, "label.height=zzz");
    assert.match((await rejects(svc.print({ kind: "frame", code: "abc-123", copies: 1 }))).message, /label\.height/);
  });
  await test("print: what the printer answers comes back (cancelled in the dialog, or an error)", async () => {
    write(...base);
    L.setLabelPrinter(async () => ({ status: "cancelled", labels: 0 }));
    assert.deepEqual(await svc.print({ kind: "frame", code: "abc-123", copies: 1 }), { status: "cancelled", labels: 0 });
    L.setLabelPrinter(async () => {
      throw new Error("The printer did not take the labels: offline");
    });
    assert.match((await rejects(svc.print({ kind: "frame", code: "abc-123", copies: 1 }))).message, /offline/);
  });
  await test("print: with no printer plugged in (outside the app) it says so instead of doing nothing", async () => {
    L.setLabelPrinter(null);
    write(...base);
    assert.match((await rejects(svc.print({ kind: "frame", code: "abc-123", copies: 1 }))).message, /no printer/);
  });

  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.log("ERR", error.stack);
  process.exit(1);
});
