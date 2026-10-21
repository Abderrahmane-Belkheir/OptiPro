// Languages: English (the language the pages are written in), French and Arabic (right to left).
//
// The pages build their screens with English texts. This file, loaded first, translates what lands on the screen: every text and the placeholder /
// aria-label / title / alt of every element, as pages add them (a MutationObserver), using the dictionaries in i18n/fr.js and i18n/ar.js.
//   - A dictionary maps an English text to its translation. A text with holes, "Page {0} of {1}", matches whatever fills the holes, and the
//     translation uses the same holes: "Page {0} sur {1}". What fills a hole is translated too when it is a known text ("frames", "January").
//   - The language is chosen from the profile menu and kept in localStorage; the page reloads so dates and numbers (Intl) are made in it too.
//   - Arabic turns the window right to left (<html dir="rtl">). Numbers stay in Latin digits (as shops in Algeria write them).
//   - window.i18n.t("text", {0: value}) translates a text from code.
(() => {
  "use strict";

  const LANGUAGES = [
    ["en", "English"],
    ["fr", "Français"],
    ["ar", "العربية"],
  ];
  const LOCALE = { en: undefined, fr: "fr-FR", ar: "ar-DZ" };
  const KEY = "optipro.lang";

  const read = (storage) => {
    try {
      return storage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const valid = (lang) => LANGUAGES.some(([code]) => code === lang);
  const stored = [read(window.sessionStorage), read(window.localStorage)].find(valid);
  const lang = stored ?? "en";

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  // ---- Dictionaries ----------------------------------------------------------------------------

  const dictionaries = {}; // lang -> { exact: Map, patterns: [{ re, to }] }

  function register(code, entries) {
    const exact = new Map();
    const patterns = [];
    for (const [english, translation] of Object.entries(entries)) {
      if (!/\{\d+\}/.test(english)) {
        exact.set(english, translation);
        continue;
      }
      const source = english
        .split(/(\{\d+\})/)
        .map((part) => (/^\{\d+\}$/.test(part) ? "(.+?)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("");
      const literal = english.replace(/\{\d+\}/g, "").length;
      patterns.push({ re: new RegExp(`^${source}$`, "s"), to: translation, literal });
    }
    patterns.sort((a, b) => b.literal - a.literal);
    dictionaries[code] = { exact, patterns, values: new Set(Object.values(entries)) };
  }

  /** The translation of a text (without its surrounding spaces), or null when the dictionary has none. */
  function lookup(core, depth = 0) {
    const dict = dictionaries[lang];
    if (!dict) return null;
    const direct = dict.exact.get(core);
    if (direct !== undefined) return direct;
    if (depth > 2) return null;
    for (const { re, to } of dict.patterns) {
      const m = re.exec(core);
      if (!m) continue;
      return to.replace(/\{(\d+)\}/g, (_, n) => {
        const part = m[Number(n) + 1] ?? "";
        return lookup(part, depth + 1) ?? part;
      });
    }
    return null;
  }

  /** The texts shown that the dictionary has no translation for (the tests list them; the app never reads it). */
  const missing = new Set();

  function translate(text) {
    if (lang === "en" || typeof text !== "string") return text;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    if (!m[2]) return text;
    const done = lookup(m[2]);
    if (done === null && /[A-Za-z]{2}/.test(m[2]) && !dictionaries[lang]?.values.has(m[2])) missing.add(m[2]);
    return done === null ? text : m[1] + done + m[3];
  }

  function t(text, values) {
    const filled = values ? text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? "")) : text;
    return translate(filled);
  }

  // ---- The page --------------------------------------------------------------------------------

  const ATTRIBUTES = ["placeholder", "aria-label", "title", "alt"];
  const textState = new WeakMap(); // text node -> { src: the English text, shown: what it shows }
  const attrState = new WeakMap(); // element -> { name: { src, shown } }

  const skipped = (el) => !el || el.closest?.("script, style, textarea, [translate=no]");

  function doText(node) {
    if (skipped(node.parentElement)) return;
    const seen = textState.get(node);
    if (seen && node.data === seen.shown) return; // set by this file
    const src = node.data;
    const shown = translate(src);
    textState.set(node, { src, shown });
    if (shown !== src) node.data = shown;
  }

  function doAttributes(el) {
    if (skipped(el)) return;
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value === null) continue;
      const states = attrState.get(el) ?? {};
      if (states[name] && states[name].shown === value) continue;
      const shown = translate(value);
      states[name] = { src: value, shown };
      attrState.set(el, states);
      if (shown !== value) el.setAttribute(name, shown);
    }
  }

  function walk(root) {
    if (lang === "en") return;
    if (root.nodeType === Node.TEXT_NODE) return doText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    doAttributes(root);
    const tree = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let node = tree.nextNode(); node; node = tree.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) doText(node);
      else doAttributes(node);
    }
  }

  function start() {
    for (const button of document.querySelectorAll("[data-lang]")) {
      button.setAttribute("aria-checked", String(button.dataset.lang === lang));
      button.addEventListener("click", () => (button.dataset.lang === lang ? null : setLang(button.dataset.lang)));
    }
    if (lang === "en") return;
    walk(document.documentElement);
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "childList") r.addedNodes.forEach(walk);
        else if (r.type === "characterData") doText(r.target);
        else if (r.type === "attributes") doAttributes(r.target);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  }

  // Dates and numbers are made in the language (the pages ask for the default locale).
  if (LOCALE[lang]) {
    for (const name of ["NumberFormat", "DateTimeFormat"]) {
      const Original = Intl[name];
      const Wrapped = function (locales, options) {
        return new Original(locales === undefined ? LOCALE[lang] : locales, options);
      };
      Wrapped.prototype = Original.prototype;
      Wrapped.supportedLocalesOf = Original.supportedLocalesOf.bind(Original);
      Intl[name] = Wrapped;
    }
  }

  /** Chooses the language and reloads the window (so every date and number is made in it). persist=false keeps it for this window only. */
  function setLang(code, { persist = true } = {}) {
    if (!valid(code)) return;
    try {
      (persist ? window.localStorage : window.sessionStorage).setItem(KEY, code);
      if (persist) window.sessionStorage.removeItem(KEY);
    } catch {
      /* storage refused: the language is not kept */
    }
    window.location.reload();
  }

  window.i18n = { missing,  lang, languages: LANGUAGES, register, t, translate, setLang, isRtl: lang === "ar" };
  window.I18N = window.i18n; // the dictionary files call I18N.register(code, entries)

  // The dictionaries load after this file (they call register), so the page is translated once everything is read.
  document.addEventListener("DOMContentLoaded", start);
})();
