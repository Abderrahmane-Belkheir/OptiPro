// Lists the English texts the window can show, found in renderer/ (the JS pages and index.html), so the French and Arabic dictionaries
// (renderer/i18n/fr.js, ar.js) can be checked against them:  node scripts/i18n-extract.mjs        (one text per line)
//                                                              node scripts/i18n-extract.mjs --json
// A text is a quoted string that reads like a sentence or a label (a letter, no code-looking characters) or an attribute of index.html
// (placeholder, aria-label, title, alt). Strings with ${...} are listed as patterns with {0}, {1}... for each hole.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), "..", "renderer");

/** Quoted strings that are not words for the code: ids, class names, selectors, events, paths, keys. */
function looksLikeText(s) {
  if (!/[A-Za-zÀ-ɏ]/.test(s)) return false;
  if (/^[a-z][a-z0-9_-]*$/.test(s)) return false; // one lowercase word: a class, id, key, value
  if (/^[a-z]+(?:[-_.:/#][a-z0-9]+)+$/i.test(s) && !/\s/.test(s)) return false; // kebab-case, a path
  if (/^[#.\[]|^\w+\[|=|=>|\bfunction\b|\breturn\b|<\/?[a-z]|^(?:https?:|#i-|data-|aria-)/i.test(s)) return false;
  if (/^[A-Z_]{2,}$/.test(s)) return false; // CONSTANT
  if (/^\d/.test(s) && !/\s[A-Za-z]{3,}/.test(s)) return false;
  if (/^[\w.]+\(.*\)$/.test(s)) return false;
  if (/^(?:[a-z]+[A-Z]\w*)$/.test(s)) return false; // camelCase identifier
  if (/\\u/.test(s) && s.length < 4) return false;
  return true;
}

function fromJs(source) {
  const found = new Set();
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  // double quotes, and backticks (template literals, which may hold ${...})
  for (const m of withoutComments.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    let s = m[1] ?? m[2];
    if (s === undefined) continue;
    s = s.replace(/\\u2014/g, "—").replace(/\\u2026/g, "…").replace(/\\"/g, '"').replace(/\\n/g, "\n");
    let n = 0;
    const text = s.replace(/\$\{[^}]*\}/g, () => `{${n++}}`);
    if (/^\{\d+\}$/.test(text)) continue;
    if (looksLikeText(text.replace(/\{\d+\}/g, "x"))) found.add(text);
  }
  return found;
}

function fromHtml(source) {
  const found = new Set();
  const body = source.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<symbol[\s\S]*?<\/symbol>/g, "");
  for (const m of body.matchAll(/(?:placeholder|aria-label|title|alt)="([^"]+)"/g)) found.add(m[1]);
  for (const m of body.matchAll(/>([^<>]+)</g)) {
    const t = m[1].replace(/\s+/g, " ").trim();
    if (t && /[A-Za-z]/.test(t)) found.add(t);
  }
  return found;
}

export function extract() {
  const all = new Set();
  const files = [join(RENDERER, "shell.js"), join(RENDERER, "expired.js"), ...readdirSync(join(RENDERER, "pages")).filter((f) => f.endsWith(".js")).map((f) => join(RENDERER, "pages", f))];
  for (const f of files) for (const s of fromJs(readFileSync(f, "utf8"))) all.add(s);
  for (const page of ["index.html", "setup.html", "expired.html"]) for (const s of fromHtml(readFileSync(join(RENDERER, page), "utf8"))) all.add(s);
  return [...all].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const list = extract();
  console.log(process.argv.includes("--json") ? JSON.stringify(list, null, 1) : list.join("\n"));
  console.error(`${list.length} texts`);
}
