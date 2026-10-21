// The French and Arabic dictionaries: the same texts in both, the same holes in every translation, and every English text the pages are written with
// (found by scripts/i18n-extract.mjs) has a translation in both. Plain node, no window.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL  ${name}\n      ${String(error.message).split("\n").slice(0, 30).join("\n      ")}`);
  }
}

function load(code) {
  let entries = null;
  global.I18N = { register: (_, e) => (entries = e) };
  new Function(fs.readFileSync(path.join(ROOT, "renderer", "i18n", `${code}.js`), "utf8"))();
  return entries;
}
const holes = (s) => (s.match(/\{\d+\}/g) ?? []).sort().join();

(async () => {
  const fr = load("fr");
  const ar = load("ar");
  const { extract } = await import(pathToFileURL(path.join(ROOT, "scripts", "i18n-extract.mjs")).href);

  test("French and Arabic have the same texts", () => {
    const onlyFr = Object.keys(fr).filter((k) => !(k in ar));
    const onlyAr = Object.keys(ar).filter((k) => !(k in fr));
    assert.deepEqual({ onlyFr, onlyAr }, { onlyFr: [], onlyAr: [] });
  });
  test("no translation is empty", () => {
    for (const [name, d] of [["fr", fr], ["ar", ar]]) for (const [k, v] of Object.entries(d)) assert.ok(typeof v === "string" && v.trim() !== "", `${name}: "${k}"`);
  });
  test("a translation uses the holes of its English text (Arabic may leave out a plural hole)", () => {
    const bad = [];
    for (const [name, d] of [["fr", fr], ["ar", ar]]) {
      for (const [k, v] of Object.entries(d)) {
        const want = new Set(k.match(/\{\d+\}/g) ?? []);
        const have = new Set(v.match(/\{\d+\}/g) ?? []);
        for (const h of have) if (!want.has(h)) bad.push(`${name}: "${k}" uses ${h}`);
        for (const h of want) if (!have.has(h) && !/\{\d+\}$|\{\d+\}[^ ]/.test(k.replace(/\{0\}/g, "")) && name === "fr") bad.push(`${name}: "${k}" drops ${h}`);
      }
    }
    assert.deepEqual(bad, []);
  });
  test("every English text of the pages has a French and an Arabic translation", () => {
    const code = /^(btn|dialog|dash-|status|toast|table|toolbar|state|page|search|creation__|frame-|input|lens-|order__|od-|pick-|popup|rx-|skeleton|summary|cell-|button|Arrow|use strict|\(max|:hover)/;
    const artifact = /\$\{|\\|^\{0\}|\{0\}[%/°]|T00:00|cell-truncate|^ ?: |^ ?[·×] \{0\}|^\s*\(\{0\}\)$|^\{0\} \{1\}|^(End|English|Français|Size ?)$/;
    const missing = extract().filter((s) => !code.test(s) && !/^[a-z_-]+( [a-z_-]+)*$/.test(s) && !/--|__/.test(s) && !artifact.test(s) && !(s in fr && s in ar) && !(s.trim() in fr && s.trim() in ar));
    assert.deepEqual(missing, []);
  });

  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((error) => {
  console.log("ERR", error.stack);
  process.exit(1);
});
