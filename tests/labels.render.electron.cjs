// Do the printed labels come out right, without a printer? Each label is drawn at a label printer's real resolution (203 and 300 dpi), reduced to pure
// black and white the way a thermal head prints it, and the QR code is DECODED: it must say the product's address. Nothing may be cut off at the edges,
// and the code must be there below the QR code. Also: the options handed to the printer, a printer that does not exist, and the pages of the PDF.
// Run with ELECTRON (not node mode), after `npm run build`:  npm test -- labels.render
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { app, BrowserWindow } = require("electron");
const jsQR = require("jsqr");

const ROOT = path.resolve(__dirname, "..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "op-label-render-"));
process.env.SQLITE_DATABASE_URL = path.join(dir, "local.db");
const cfg = path.join(dir, "c.properties");
process.env.OPTIPRO_CONFIG_FILE = cfg;
const settingsFile = (...lines) => fs.writeFileSync(cfg, [...lines, ""].join("\n"));

const results = [];
const check = (ok, label, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
};
const info = (text) => console.log(`      ${text}`);

// The hidden windows are the only windows here: do not quit when the last one closes (the real app always has its main window).
app.on("window-all-closed", () => {});

/** The label drawn as a printer would: `dpi` dots per inch, every dot black or white. Answers { width, height, dark(x, y) }. */
async function rasterize(html, widthMm, heightMm, dpi) {
  const px = (mm) => Math.round((mm / 25.4) * dpi);
  const win = new BrowserWindow({ show: false, width: px(widthMm), height: px(heightMm), useContentSize: true, webPreferences: { zoomFactor: dpi / 96, sandbox: true } });
  try {
    const file = path.join(dir, `label-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, html);
    await win.loadFile(file);
    await win.webContents.insertCSS("html, body { overflow: hidden !important; }");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const image = await win.webContents.capturePage();
    const { width, height } = image.getSize();
    const bgra = image.toBitmap();
    const dark = new Uint8Array(width * height);
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const gray = 0.114 * bgra[i * 4] + 0.587 * bgra[i * 4 + 1] + 0.299 * bgra[i * 4 + 2];
      const black = gray < 140 ? 1 : 0; // a thermal head: a dot is burnt or it is not
      dark[i] = black;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = black ? 0 : 255;
      rgba[i * 4 + 3] = 255;
    }
    return { width, height, rgba, grid: dark, dark: (x, y) => dark[y * width + x] === 1 };
  } finally {
    win.destroy();
  }
}

/** The label as a printer with dot gain makes it: every black dot bleeds into the dots next to it (up, down, left, right). */
function withDotGain(raster) {
  const { width, height, grid } = raster;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      out[i] = grid[i] || (x > 0 && grid[i - 1]) || (x < width - 1 && grid[i + 1]) || (y > 0 && grid[i - width]) || (y < height - 1 && grid[i + width]) ? 1 : 0;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = out[i] ? 0 : 255;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function pdfStreams(file) {
  const buffer = fs.readFileSync(file);
  const text = buffer.toString("latin1");
  const out = [];
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out.push(zlib.inflateSync(buffer.subarray(start, end)).toString("latin1"));
    } catch {
      /* not a compressed stream (an image or a font): skip it */
    }
  }
  return out;
}

app.whenReady().then(async () => {
  try {
    const L = require(path.join(ROOT, "dist/local/labelService.js"));
    const P = require(path.join(ROOT, "dist/labelPrinter.js"));
    const SERVER = "https://maison-clair.example.com";
    settingsFile(`server.url=${SERVER}`, "tenant.key=t1");
    const qr = await L.localLabelService.qr("frame", "abc-123");
    const expected = `${SERVER}/frames/abc-123`;
    check(qr.url === expected, "set-up: the address the QR code must carry", expected);

    // ------------------------------------------------------------------ the QR code decodes, at printer resolution
    console.log("\n-- drawn at a label printer's resolution, black and white, then decoded");
    const sizes = [[30, 20], [40, 25], [50, 30], [58, 40], [30, 25], [25, 15]];
    /** What the card would say about this label size for this server address (read from the settings file, as the app does). */
    const riskOf = (w, h, server = SERVER) => {
      settingsFile(`server.url=${server}`, "tenant.key=t1", `label.width=${w}`, `label.height=${h}`);
      const result = L.labelSettings();
      settingsFile(`server.url=${SERVER}`, "tenant.key=t1");
      return result;
    };
    check(riskOf(30, 20).scanRisk === true && riskOf(40, 25).scanRisk === false, "the card's warning agrees with the measurements below: 30 x 20 is flagged, 40 x 25 is not", `30x20 ${riskOf(30, 20).dotsPerModule} dots per square, 40x25 ${riskOf(40, 25).dotsPerModule}`);
    for (const dpi of [203, 300]) {
      for (const [w, h] of sizes) {
        const html = L.labelsHtml({ svg: qr.svg, code: "abc-123", copies: 1, widthMm: w, heightMm: h });
        const raster = await rasterize(html, w, h, dpi);
        const found = jsQR(raster.rgba, raster.width, raster.height, { inversionAttempts: "dontInvert" });
        const g = L.labelGeometry(w, h);
        const mustScan = !riskOf(w, h).scanRisk;
        const ok = found?.data === expected;
        if (mustScan) check(ok, `${w} x ${h} mm at ${dpi} dpi (QR code ${g.qrMm} mm): decodes to the address`, found ? found.data : "NOT DECODED");
        else info(`${w} x ${h} mm at ${dpi} dpi (QR code ${g.qrMm} mm, flagged by the card): ${ok ? "still decodes" : "does not decode"}`);

        // nothing cut off: no black dot within half a millimetre of the label's edge
        const margin = Math.floor(((0.5 / 25.4) * dpi));
        let touching = 0;
        for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.dark(x, y) && (x < margin || y < margin || x >= raster.width - margin || y >= raster.height - margin)) touching++;
        if (mustScan) check(touching === 0, `  nothing touches the label's edge (nothing is cut off)`, touching ? `${touching} dots in the margin` : "");

        // the code is there, below the QR code
        const qrBottom = Math.round(((1 + g.qrMm) / 25.4) * dpi);
        let textDots = 0;
        for (let y = qrBottom + 1; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.dark(x, y)) textDots++;
        if (mustScan) check(textDots > (dpi / 203) * 150, `  the code's text is printed below the QR code`, `${textDots} dots`);
      }
    }

    // a real printer is not perfect: its dots bleed (dot gain), and a roll may print at a resolution that does not line up with the QR modules
    console.log("\n-- a harsher printer: every black dot bleeds into its neighbours (dot gain), and an off-grid resolution");
    for (const [w, h] of sizes) {
      const g = L.labelGeometry(w, h);
      const html = L.labelsHtml({ svg: qr.svg, code: "abc-123", copies: 1, widthMm: w, heightMm: h });
      for (const dpi of [203, 180]) {
        const raster = await rasterize(html, w, h, dpi);
        const bled = withDotGain(raster);
        const ok = jsQR(bled.rgba, bled.width, bled.height, { inversionAttempts: "dontInvert" })?.data === expected;
        const risk = riskOf(w, h);
        if (!risk.scanRisk) check(ok, `${w} x ${h} mm at ${dpi} dpi with dot gain (QR code ${g.qrMm} mm, ${risk.dotsPerModule} dots per square): the card does not warn, and it decodes`, ok ? "" : "NOT DECODED");
        else info(`${w} x ${h} mm at ${dpi} dpi with dot gain (QR code ${g.qrMm} mm, ${risk.dotsPerModule} dots per square, flagged by the card): ${ok ? "still decodes" : "does NOT decode"}`);
      }
    }

    // ------------------------------------------------------------------ a different code, an accessory, a long address
    console.log("\n-- other products and addresses");
    {
      const acc = await L.localLabelService.qr("accessory", "xyz-007");
      const r = await rasterize(L.labelsHtml({ svg: acc.svg, code: "xyz-007", copies: 1, widthMm: 30, heightMm: 20 }), 30, 20, 203);
      check(jsQR(r.rgba, r.width, r.height)?.data === `${SERVER}/accessories/xyz-007`, "an accessory's label decodes to its /accessories/ address");
      const LONG = "https://optique-boutique-algerie-alger-centre.example.com";
      settingsFile(`server.url=${LONG}`, "tenant.key=t1");
      const long = await L.localLabelService.qr("accessory", "xyz-111");
      settingsFile(`server.url=${SERVER}`, "tenant.key=t1");
      info(`a long server address: ${long.url.length} characters`);
      for (const [w, h] of [[40, 25], [50, 30]]) {
        const risk = riskOf(w, h, LONG);
        const html = L.labelsHtml({ svg: long.svg, code: "xyz-111", copies: 1, widthMm: w, heightMm: h });
        const raster = await rasterize(html, w, h, 203);
        check(jsQR(raster.rgba, raster.width, raster.height)?.data === long.url, `a long address on a ${w} x ${h} label at 203 dpi decodes in ideal conditions`);
        const bled = withDotGain(raster);
        const ok = jsQR(bled.rgba, bled.width, bled.height)?.data === long.url;
        if (!risk.scanRisk) check(ok, `  with dot gain, too: the card does not warn (${risk.dotsPerModule} dots per square), and it decodes`);
        else check(true, `  the card WARNS for a ${w} x ${h} label with this long address (${risk.dotsPerModule} dots per square)`, ok ? "(it still decodes under dot gain)" : "(and it fails under dot gain: the warning is right)");
      }
      check(riskOf(40, 25, LONG).scanRisk === true, "a long server address on the default 40 x 25 label is flagged (the QR code is denser)");
    }

    // ------------------------------------------------------------------ what is asked of the printer
    console.log("\n-- the options handed to the printer");
    {
      const a = P.printOptions({ widthMm: 30, heightMm: 20, printer: null });
      check(a.silent === false && a.deviceName === undefined, "no printer named: the system's print dialog opens (not silent)");
      check(a.pageSize.width === 30000 && a.pageSize.height === 20000, "the paper is the label: 30 x 20 mm in microns (30000 x 20000)", JSON.stringify(a.pageSize));
      check(a.margins.marginType === "none" && a.printBackground === true, "no margins, and what is black is printed black");
      const b = P.printOptions({ widthMm: 40.5, heightMm: 25, printer: "Xprinter XP-365B" });
      check(b.silent === true && b.deviceName === "Xprinter XP-365B" && b.pageSize.width === 40500, "a printer named: it prints straight to it, by that name, on a 40.5 mm wide label (40500 microns)");
    }

    // ------------------------------------------------------------------ a printer that is not there
    console.log("\n-- a printer that does not exist");
    {
      let printers = [];
      try {
        const probe = new BrowserWindow({ show: false });
        printers = await probe.webContents.getPrintersAsync();
        probe.destroy();
      } catch {
        printers = [];
      }
      info(`printers on this computer: ${printers.length ? printers.map((p) => p.name).join(", ") : "none"}`);
      settingsFile(`server.url=${SERVER}`, "tenant.key=t1", "label.printer=No Such Printer 12345");
      L.setLabelPrinter(P.electronLabelPrinter);
      const saved = process.env.OPTIPRO_LABEL_PDF_DIR;
      delete process.env.OPTIPRO_LABEL_PDF_DIR;
      let outcome = "";
      try {
        const r = await Promise.race([L.localLabelService.print({ kind: "frame", code: "abc-123", copies: 1 }), new Promise((_, reject) => setTimeout(() => reject(new Error("TIMED OUT waiting for the printer")), 20000))]);
        outcome = `answered ${JSON.stringify(r)}`;
      } catch (error) {
        outcome = `error: ${error.message}`;
      }
      if (saved) process.env.OPTIPRO_LABEL_PDF_DIR = saved;
      info(`printing to a printer that is not there: ${outcome}`);
      check(outcome.startsWith("error:") && !/TIMED OUT/.test(outcome), "printing to a printer that is not installed fails with a message (it does not pretend it printed, and it does not hang)");
      check(!/answered .*"status":"sent"/.test(outcome), "and it never reports \"sent\"");
      settingsFile(`server.url=${SERVER}`, "tenant.key=t1");
    }

    // ------------------------------------------------------------------ the PDF
    console.log("\n-- the PDF the pipeline writes");
    {
      process.env.OPTIPRO_LABEL_PDF_DIR = path.join(dir, "pdf");
      L.setLabelPrinter(P.electronLabelPrinter);
      const r = await L.localLabelService.print({ kind: "frame", code: "abc-123", copies: 4 });
      // Each page has its own drawing stream (the QR code's shapes and the text). Chromium draws the pages one under another, so the streams are the same
      // apart from where the page starts (the transform, the background rectangle and the text line's position).
      const pages = pdfStreams(r.file).filter((x) => / cm\n/.test(x));
      info(`${pages.length} page streams, ${pages[0]?.split("\n").length} lines each`);
      check(pages.length === 4, "the PDF has a drawing stream for each of the 4 labels", String(pages.length));
      check(pages.every((x) => x.split("\n").length > 800), "each is a real drawing (the QR code's shapes and the code's text), not a blank page");
      let sameLabel = true;
      let moved = 0;
      const base = pages[0].split("\n");
      for (const page of pages.slice(1)) {
        const lines = page.split("\n");
        if (lines.length !== base.length) { sameLabel = false; continue; }
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === base[i]) continue;
          moved++;
          if (!/( cm| re| Tm)$/.test(lines[i])) sameLabel = false;
        }
      }
      check(sameLabel, "the 4 pages are the same label: they differ only in where the page starts (position lines), not in a single shape", `${moved} position lines differ`);
    }
  } catch (error) {
    check(false, "ERR", error.stack);
  }
  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} passed`);
  app.exit(passed === results.length ? 0 : 1);
});
