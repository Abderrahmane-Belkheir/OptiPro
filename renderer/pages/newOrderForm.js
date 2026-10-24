// The New order form, opened from a customer's Orders tab:  window.openNewOrderForm(customer, { onPlaced(result) })
// What it shows is real: the frames and accessories come from a search of the shop's own products, the prescriptions are the customer's own, and
// the lenses are the shop's. Place order sends the draft to orderPlacement.place, which checks it again and saves the order, its lines and the
// deposit together. The steps, top to bottom:
//   1. a frame (search, optional)   2. an accessory (search, optional)   3. a deposit   4. a prescription (optional)
//   5. lenses: from the shop's list for the chosen prescription, or described in words   6. what was measured with the frame on
//   7. the promised day and notes (optional)
//
//   window.newOrderData   <- THE ONE PLACE TO WIRE THE LOGIC. The screen calls nothing else.
//     searchFrames(text, by)      real frames          (electronAPI.frames.search); by = "model" | "code"
//     searchAccessories(text, by) real accessories     (electronAPI.accessories.search)
//     prescriptionsFor(customerId) the customer's prescriptions, newest first (electronAPI.prescriptions.listForCustomer)
//     parseScan(text)             reads what a barcode scanner typed (a product code, or a label's QR address): { kind, code } or null
//     lenses()                    the shop's lenses (electronAPI.lenses.list)
//     lensFit(prescriptionId)     the lenses that can be made for a saved prescription, per eye (electronAPI.lenses.availableFor)
//     placeOrder(draft)           electronAPI.orderPlacement.place. The draft is what the form holds, as typed (see src/local/orderDraft.ts):
//                                 { customerId, prescriptionId, frameId, accessoryId, lensId, lensDescription, lensPrice, deposit,
//                                   pdRight, pdLeft, fittingHeightRight, fittingHeightLeft, promisedAt, notes }
//                                 It answers { status: "invalid", errors } (nothing saved) or { status: "placed", order, ... }.
(() => {
  "use strict";

  const CURRENCY = "DZD";
  const SEARCH_DELAY_MS = 150;
  const RESULTS_SHOWN = 20; // the list is scrollable; more than this and the person is asked to keep typing

  const newOrderData = {
    /** by: "model" (name, reference, brand) or "code" (the code on the label). One more than is shown is asked for, to know whether there are more. */
    searchFrames: (text, by) => window.electronAPI.frames.search(text, RESULTS_SHOWN + 1, by, { inStock: true }), // (only what is in stock can be sold)
    searchAccessories: (text, by) => window.electronAPI.accessories.search(text, RESULTS_SHOWN + 1, by, { inStock: true }),
    prescriptionsFor: (customerId) => window.electronAPI.prescriptions.listForCustomer(customerId),
    /** What a scanner typed: { kind, code } for a product code or the address on a label's QR code, null for anything else. */
    parseScan: (text) => window.electronAPI.labels.parseScan(text),
    /** The shop's lenses (electronAPI.lenses.list); the retired ones are left out by the screen. */
    lenses: () => window.electronAPI.lenses.list(),
    /** Which lenses can be made for a saved prescription, per eye (electronAPI.lenses.availableFor). Advice only: nothing is blocked. */
    lensFit: (prescriptionId) => window.electronAPI.lenses.availableFor(prescriptionId),
    /** Checks the draft and saves the order, its lines and the deposit in one local transaction. */
    placeOrder: (draft) => window.electronAPI.orderPlacement.place(draft),
  };
  window.newOrderData = newOrderData;

  // ---- What may be typed in a search box -----------------------------------------------------
  // The same rules as src/local/productSearch.ts (checkSearchInput), which applies them again before searching: tests/newOrder.window.test.cjs and
  // tests/productSearch.test.cjs run the same inputs through both. A label's address (a scanner types it, then Enter) is not searched as typed.
  const CODE_HELP = "A code is 3 letters, a dash and 3 digits, like abc-123.";
  const CODE_PARTIAL = /^(?:[a-z]{1,3}|[a-z]{3}-?[0-9]{0,3}|[0-9]{1,3})$/;
  const MODEL_CHARS = /^[\p{L}\p{M}\p{N} .,'’&+\-/()]+$/u;

  /** { ok: true, query } (the text to search for), { ok: true, scan: true } (a label's address: Enter uses it), or { ok: false, message }. */
  function checkQuery(text, by) {
    const trimmed = String(text ?? "").trim();
    if (trimmed === "") return { ok: true, query: "" };
    if (/^https?:\/\//i.test(trimmed)) return { ok: true, scan: true };
    if (by === "code") {
      const code = trimmed.toLowerCase().replace(/\s+/g, "");
      return CODE_PARTIAL.test(code) ? { ok: true, query: code } : { ok: false, message: CODE_HELP };
    }
    const clean = trimmed.replace(/\s+/g, " ");
    if (clean.length > 60) return { ok: false, message: "That is too long: at most 60 characters." };
    if (!MODEL_CHARS.test(clean)) return { ok: false, message: "Only letters, digits, spaces and . , ' & + - / ( ) can be searched." };
    if (clean.split(" ").length > 6) return { ok: false, message: "Use at most 6 words." };
    return { ok: true, query: clean };
  }
  newOrderData.checkQuery = checkQuery;

  // ---- Small helpers -------------------------------------------------------------------------

  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
    return el;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  const errorText = (error) => String(error?.message ?? error).replace(/^\[[\w-]+\]\s*/, "");
  const dayFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const formatDay = (iso) => dayFormat.format(new Date(iso));

  /** A price as stored (in the product's own currency, not cents): "DZD 18,500", "DZD 180.50"; "No price" when there is none. */
  function price(value, currency) {
    if (value === null || value === undefined) return "No price";
    const code = /^[A-Za-z]{3}$/.test(currency ?? "") ? currency.toUpperCase() : CURRENCY;
    const whole = Number.isInteger(value);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: code, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
    } catch {
      return `${value} ${code}`;
    }
  }

  /** Centimes as the text of an amount box: 2000000 -> "20000", 18050 -> "180.50". */
  const amountOf = (cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

  const diopter = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
  /** "R +2.00 / -1.25 × 90° · L ..." : a prescription in one line. */
  function rxLine(entry) {
    const eye = (side) => {
      const s = entry[`${side}Sphere`];
      const c = entry[`${side}Cylinder`];
      const a = entry[`${side}Axis`];
      if (s === null && c === null) return "—";
      return `${s === null ? "" : diopter(s)}${c === null ? "" : ` / ${diopter(c)}${a === null ? "" : ` × ${a}°`}`}`;
    };
    return `R ${eye("right")}  ·  L ${eye("left")}`;
  }

  // ---- A product picker: a search box and its results, then the chosen product ------------------

  /**
   * kind: "frame" | "accessory". Answers { el, chosen() }. The person picks how to search (By model, the default, or By code) and types: the list below
   * (scrollable) is made again at every keystroke from the real products. Nothing is listed until something is typed. Choosing one replaces the box with
   * a card and a "Change" button.
   */
  function picker(kind, search, onChange) {
    const noun = kind === "frame" ? "frame" : "accessory";
    const state = { chosen: null, token: 0, timer: 0, by: "model" };
    const PLACEHOLDER = {
      model: kind === "frame" ? "Search by model: name, reference or brand" : "Search by model: name or description",
      code: "Search by code, or scan the label",
    };
    const input = h("input", { class: "search__input", type: "search", id: `order-${kind}-search`, "data-picker": kind, placeholder: PLACEHOLDER.model, autocomplete: "off", "aria-label": `Search ${noun}s` });
    const modes = h(
      "div",
      { class: "chips pick-modes", role: "group", "aria-label": "Search by" },
      [["model", "By model"], ["code", "By code"]].map(([mode, label]) =>
        h("button", { class: "chip", type: "button", "data-mode": mode, "aria-pressed": String(mode === state.by), onclick: () => setMode(mode) }, label),
      ),
    );
    const START = kind === "frame" ? "Start typing to find a frame." : "Start typing to find an accessory.";
    const hint = h("p", { class: "pick-hint", "data-hint": kind, role: "status" }, START);
    const results = h("div", { class: "pick-results", role: "listbox", "aria-label": `${noun} results`, "data-results": kind, hidden: true });
    const search_ = h("div", { class: "pick-search" }, modes, h("div", { class: "search pick-search__box" }, icon("search"), input), hint, results);

    /** Switches between searching by model and by code; what is typed is searched again in the new way. */
    function setMode(mode) {
      state.by = mode;
      for (const button of modes.children) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
      input.setAttribute("placeholder", PLACEHOLDER[mode]);
      input.focus();
      clearTimeout(state.timer);
      run();
    }
    const card = h("div", { class: "pick-chosen", "data-chosen": kind, hidden: true });
    const el = h("div", { class: "pick", "data-kind": kind }, search_, card);

    function showResults(found, query) {
      results.hidden = false;
      hint.hidden = true;
      results.replaceChildren();
      results.dataset.status = "ready";
      const items = found.slice(0, RESULTS_SHOWN);
      if (items.length === 0) {
        results.append(h("p", { class: "pick-results__empty" }, state.by === "code" ? `No ${noun} has a code like “${query.trim()}”.` : `No ${noun} matches “${query.trim()}”.`));
        return;
      }
      for (const item of items) {
        const sub = [item.brand, item.code, item.reference && item.reference !== item.code ? item.reference : null].filter(Boolean).join(" · ");
        results.append(
          h(
            "button",
            { class: "pick-result", type: "button", role: "option", "data-id": item.id, "data-code": item.code ?? "", onclick: () => choose(item) },
            h("span", { class: "pick-result__main" }, h("span", { class: "pick-result__name" }, item.name), h("span", { class: "pick-result__sub" }, sub)),
            h("span", { class: "pick-result__side" }, h("span", { class: "pick-result__price" }, price(item.price, item.currency)), item.stock <= 0 ? h("span", { class: "pick-result__stock pick-result__stock--out" }, "Out of stock") : h("span", { class: "pick-result__stock" }, `${item.stock} in stock`)),
          ),
        );
      }
    }

    /** Back to nothing listed (nothing typed): the hint is shown instead. */
    function clearResults() {
      say(START, false);
    }

    /** Nothing listed; the line under the box says `text` (in red when the input is wrong, with the box marked). */
    function say(text, wrong) {
      state.token += 1; // an answer still on its way is ignored
      results.hidden = true;
      results.replaceChildren();
      results.dataset.status = "idle";
      hint.hidden = false;
      hint.textContent = text;
      hint.classList.toggle("pick-hint--invalid", wrong);
      if (wrong) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }

    async function run() {
      const query = input.value;
      if (query.trim() === "") return clearResults();
      const check = checkQuery(query, state.by);
      if (!check.ok) return say(check.message, true); // the structure is wrong: say what it should be, search nothing
      if (check.scan) return say("Press Enter to use this label.", false);
      input.removeAttribute("aria-invalid");
      const token = ++state.token;
      results.dataset.status = "loading";
      try {
        const items = await search(check.query, state.by);
        if (token !== state.token) return;
        showResults(items, query);
        if (items.length > RESULTS_SHOWN) results.append(h("p", { class: "pick-results__more", "data-more": "" }, `Showing the first ${RESULTS_SHOWN}. Keep typing to narrow it down.`));
      } catch (error) {
        if (token !== state.token) return;
        results.hidden = false;
        hint.hidden = true;
        results.dataset.status = "error";
        results.replaceChildren(h("p", { class: "pick-results__empty pick-results__empty--error", role: "alert" }, `The ${noun}s couldn't be searched: ${errorText(error)}`));
      }
    }

    function choose(item) {
      state.chosen = item;
      search_.hidden = true;
      card.hidden = false;
      card.replaceChildren(
        h("div", { class: "pick-chosen__main" }, h("span", { class: "pick-chosen__name" }, item.name), h("span", { class: "pick-chosen__sub" }, [item.brand, item.code].filter(Boolean).join(" · "))),
        h("span", { class: "pick-chosen__price" }, price(item.price, item.currency)),
        h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-action": "change", onclick: unchoose }, "Change"),
      );
      onChange();
    }

    function unchoose() {
      state.chosen = null;
      card.hidden = true;
      search_.hidden = false;
      input.value = ""; // a new search starts from nothing, like the first one
      clearResults();
      input.focus();
      onChange();
    }

    input.addEventListener("input", () => {
      clearTimeout(state.timer);
      if (input.value.trim() === "") return clearResults(); // nothing typed: nothing listed, at once
      const check = checkQuery(input.value, state.by);
      if (!check.ok) return say(check.message, true); // a wrong structure is said at once, without waiting
      if (check.scan) return say("Press Enter to use this label.", false); // a label's address (a scanner typed it): Enter uses it
      state.timer = setTimeout(run, SEARCH_DELAY_MS);
    });

    // Arrow keys walk the list: Down from the box to the first result, Up/Down between results, Up from the first back to the box.
    results.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = [...results.querySelectorAll(".pick-result")];
      const at = options.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      if (event.key === "ArrowDown") options[Math.min(at + 1, options.length - 1)]?.focus();
      else if (at === 0) input.focus();
      else options[at - 1].focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      const first = results.querySelector(".pick-result");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    });

    // A barcode scanner types what it reads like a keyboard and presses Enter: a product's code (abc-123), or the address on its label's QR code
    // (https://.../frames/abc-123). Either picks that product at once. Anything else is just text to search for.
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      clearTimeout(state.timer);
      let scan = null;
      try {
        scan = await newOrderData.parseScan(input.value);
      } catch {
        scan = null;
      }
      if (scan === null) return run(); // plain text: search now
      const token = ++state.token;
      const say = (text) => {
        results.dataset.status = "ready";
        results.replaceChildren(h("p", { class: "pick-results__empty pick-results__empty--error", role: "alert", "data-scan-message": "" }, text));
      };
      if (scan.kind !== null && scan.kind !== kind) return say(`That is ${scan.kind === "frame" ? "a frame's" : "an accessory's"} code. Scan it in the ${scan.kind === "frame" ? "Frame" : "Accessory"} box.`);
      try {
        const items = await search(scan.code, "code"); // a scanned code is always looked up by code, whichever way the box is set
        if (token !== state.token) return;
        const hit = items.find((item) => item.code === scan.code);
        if (hit) {
          input.value = "";
          choose(hit);
        } else say(`No ${noun} has the code ${scan.code}.`);
      } catch (error) {
        say(`The ${noun}s couldn't be searched: ${errorText(error)}`);
      }
    });
    return { el, chosen: () => state.chosen };
  }

  // ---- The lens picker: the shop's lenses, or a description instead -------------------------------

  const DESIGN_NAME = { single_vision: "Single vision", bifocal: "Bifocal", progressive: "Progressive" };
  const DESCRIPTION_MAX = 200;

  /** What the matcher says about one lens for the chosen prescription: { fits: true|false, why } or null when nothing was checked. */
  function fitOf(match, lensId) {
    const eyes = [["Right", match.right], ["Left", match.left]].filter(([, eye]) => eye.status === "ok");
    if (eyes.length === 0) return null;
    for (const [side, eye] of eyes) {
      const no = eye.unavailable.find((x) => x.lensId === lensId);
      if (no) return { fits: false, why: `${side} eye: ${no.reasons[0]?.message ?? "outside the lens's range"}` };
    }
    return eyes.every(([, eye]) => eye.available.some((x) => x.lensId === lensId)) ? { fits: true, why: "" } : null;
  }

  /**
   * One lens for the order, either picked from the shop's lenses (a scrollable list, empty at first) or described in words (a checkbox turns that on).
   * The list: with a prescription chosen it shows the lenses that fit it; typing searches all the shop's lenses (the ones that fit come first). Advice
   * only: a lens that does not fit can still be chosen. Answers { el, chosen(), description(), setPrescription(id | null) }.
   */
  function lensPicker(onChange) {
    const state = { chosen: null, all: null, fit: null, rx: null, token: 0, timer: 0, describing: false };
    const START = "Choose a prescription first: the lenses are listed for it.";
    const input = h("input", { class: "search__input", type: "search", disabled: true, id: "order-lens-search", "data-picker": "lens", placeholder: "Search by name, brand or reference", autocomplete: "off", "aria-label": "Search lenses" });
    const hint = h("p", { class: "pick-hint", "data-hint": "lens", role: "status" }, START);
    const results = h("div", { class: "pick-results", role: "listbox", "aria-label": "Lens results", "data-results": "lens", hidden: true });
    const search = h("div", { class: "pick-search" }, h("div", { class: "search pick-search__box" }, icon("search"), input), hint, results);
    const card = h("div", { class: "pick-chosen", "data-chosen": "lens", hidden: true });
    const catalogue = h("div", { class: "pick", "data-kind": "lens" }, search, card);

    const describe = h("input", { type: "checkbox", id: "order-lens-describe", name: "describeLens" });
    const text = h("textarea", { class: "input lens-description", id: "order-lens-description", name: "lensDescription", rows: "3", maxlength: String(DESCRIPTION_MAX), placeholder: "For example: progressive 1.6 with anti-reflective", "aria-describedby": "order-lens-description-count" });
    const count = h("p", { class: "field__help lens-description__count", id: "order-lens-description-count" }, `0 / ${DESCRIPTION_MAX}`);
    const written = h("div", { class: "field", "data-lens-text": "", hidden: true }, h("label", { class: "field__label", for: "order-lens-description" }, "Lens description"), text, count);
    const priceInput = h("input", { class: "input", type: "text", inputmode: "decimal", id: "order-lens-price", name: "lensPrice", placeholder: "0", autocomplete: "off" });
    const costInput = h("input", { class: "input", type: "text", inputmode: "decimal", id: "order-lens-cost", name: "lensCost", placeholder: "0", autocomplete: "off" });
    const priceField = h(
      "div",
      { class: "field", "data-lens-price": "", hidden: true },
      h("label", { class: "field__label", for: "order-lens-price" }, `Lens price (${CURRENCY})`),
      priceInput,
      h("p", { class: "field__help" }, "The price for the pair. A lens from your list starts at its price: you can change it."),
      h("label", { class: "field__label", for: "order-lens-cost" }, `Lens cost (${CURRENCY})`, h("span", { class: "field__hint" }, "Optional")),
      costInput,
      h("p", { class: "field__help" }, "What the pair costs you. It is kept with the order for the profit. A lens from your list starts at its cost, if it has one."),
    );
    const el = h("div", { class: "lens-picker" }, h("label", { class: "lens-check" }, describe, "Not from my lenses: describe the lens instead"), catalogue, written, priceField);

    /** The price box is there once there is a lens to price: one chosen from the list, or described. */
    function showPrice() {
      priceField.hidden = !(state.describing || state.chosen !== null);
    }
    const amountText = (cents) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

    /** The shop's active lenses, read once (and again after a failure). */
    async function lensList() {
      if (state.all === null) state.all = (await newOrderData.lenses()).filter((lens) => lens.isActive !== false);
      return state.all;
    }

    function say(message, wrong) {
      state.token += 1;
      results.hidden = true;
      results.replaceChildren();
      results.dataset.status = "idle";
      hint.hidden = false;
      hint.textContent = message;
      hint.classList.toggle("pick-hint--invalid", wrong);
      if (wrong) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }

    function detail(lens) {
      return [lens.brand, lens.reference, DESIGN_NAME[lens.design] ?? lens.design, lens.refractiveIndex ? `n ${lens.refractiveIndex}` : null].filter(Boolean).join(" · ");
    }

    function render(items, searched) {
      results.hidden = false;
      hint.hidden = true;
      results.dataset.status = "ready";
      results.replaceChildren();
      if (items.length === 0) {
        results.append(h("p", { class: "pick-results__empty", "data-state": "empty" }, searched ? `No lens matches “${input.value.trim()}”.` : "None of your lenses is known to fit this prescription. Type to search all of them, or describe the lens."));
        return;
      }
      for (const { lens, fit } of items.slice(0, RESULTS_SHOWN)) {
        const tag = fit === null ? null : fit.fits ? h("span", { class: "pick-result__fit" }, "Fits") : h("span", { class: "pick-result__fit pick-result__fit--no", title: fit.why }, "May not fit");
        results.append(
          h(
            "button",
            { class: "pick-result", type: "button", role: "option", "data-id": lens.id, "data-fit": fit === null ? "" : fit.fits ? "yes" : "no", onclick: () => choose(lens, fit) },
            h("span", { class: "pick-result__main" }, h("span", { class: "pick-result__name" }, lens.name), h("span", { class: "pick-result__sub" }, detail(lens)), fit && !fit.fits ? h("span", { class: "pick-result__sub pick-result__sub--no" }, fit.why) : null),
            h("span", { class: "pick-result__side" }, h("span", { class: "pick-result__price" }, price(lens.priceCents / 100, null)), tag),
          ),
        );
      }
      if (items.length > RESULTS_SHOWN) results.append(h("p", { class: "pick-results__more", "data-more": "" }, `Showing the first ${RESULTS_SHOWN}. Keep typing to narrow it down.`));
    }

    async function run() {
      const typed = input.value.trim();
      if (typed === "" && state.rx === null) return say(START, false);
      const check = checkQuery(typed, "model");
      if (!check.ok) return say(check.message, true);
      if (check.scan) return say("Lenses have no label to scan. Type a name, brand or reference.", true);
      input.removeAttribute("aria-invalid");
      const token = ++state.token;
      results.dataset.status = "loading";
      try {
        const all = await lensList();
        if (token !== state.token) return;
        const words = check.query.toLowerCase().split(" ").filter(Boolean);
        const rows = all.map((lens) => ({ lens, fit: state.fit ? fitOf(state.fit, lens.id) : null }));
        const hay = (lens) => [lens.name, lens.brand, lens.reference, lens.design, lens.material].filter(Boolean).join(" ").toLowerCase();
        const kept = words.length === 0 ? rows.filter((row) => row.fit?.fits) : rows.filter((row) => words.every((word) => hay(row.lens).includes(word)));
        const rank = (row) => (row.fit === null ? 1 : row.fit.fits ? 0 : 2);
        kept.sort((a, b) => rank(a) - rank(b)); // the sort is stable: the matcher's order (best first) and the list's order are kept within a group
        render(kept, words.length > 0);
      } catch (error) {
        if (token !== state.token) return;
        state.all = null;
        results.hidden = false;
        hint.hidden = true;
        results.dataset.status = "error";
        results.replaceChildren(h("p", { class: "pick-results__empty pick-results__empty--error", role: "alert" }, `The lenses couldn't be loaded: ${errorText(error)}`));
      }
    }

    function choose(lens, fit) {
      state.chosen = { lens, fit };
      priceInput.value = amountText(lens.priceCents);
      costInput.value = lens.costCents > 0 ? amountText(lens.costCents) : ""; // (a cost of 0 in the list is "not entered")
      showPrice();
      search.hidden = true;
      card.hidden = false;
      card.replaceChildren(
        h("div", { class: "pick-chosen__main" }, h("span", { class: "pick-chosen__name" }, lens.name), h("span", { class: "pick-chosen__sub" }, detail(lens)), fit && !fit.fits ? h("span", { class: "pick-chosen__sub pick-result__sub--no", "data-warning": "" }, `${fit.why} (advice only: you can still use it)`) : null),
        h("span", { class: "pick-chosen__price" }, price(lens.priceCents / 100, null)),
        h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-action": "change", onclick: unchoose }, "Change"),
      );
      onChange();
    }

    function unchoose() {
      state.chosen = null;
      priceInput.value = "";
      costInput.value = "";
      showPrice();
      card.hidden = true;
      search.hidden = false;
      input.value = "";
      run();
      input.focus();
      onChange();
    }

    /** The prescription changed (or was dropped): the matcher is asked again, and the list follows. A failure leaves the plain search. */
    async function setPrescription(id) {
      state.rx = id;
      state.fit = null;
      input.disabled = id === null; // the lenses can be chosen only for a chosen prescription
      if (id === null && state.chosen) unchoose(); // the lens was chosen for that prescription
      const token = ++state.token;
      if (id !== null) {
        try {
          const match = await newOrderData.lensFit(id);
          if (token !== state.token) return;
          state.fit = match;
        } catch {
          if (token !== state.token) return;
          state.fit = null;
        }
      }
      if (!state.describing) run();
    }

    input.addEventListener("input", () => {
      clearTimeout(state.timer);
      if (input.value.trim() === "") return run();
      const check = checkQuery(input.value, "model");
      if (!check.ok) return say(check.message, true);
      state.timer = setTimeout(run, SEARCH_DELAY_MS);
    });
    results.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const options = [...results.querySelectorAll(".pick-result")];
      const at = options.indexOf(document.activeElement);
      if (at < 0) return;
      event.preventDefault();
      if (event.key === "ArrowDown") options[Math.min(at + 1, options.length - 1)]?.focus();
      else if (at === 0) input.focus();
      else options[at - 1].focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown") return;
      const first = results.querySelector(".pick-result");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    });

    describe.addEventListener("change", () => {
      state.describing = describe.checked;
      priceInput.value = state.describing ? "" : state.chosen ? amountText(state.chosen.lens.priceCents) : ""; // each way of choosing starts from its own price
      costInput.value = state.describing ? "" : state.chosen && state.chosen.lens.costCents > 0 ? amountText(state.chosen.lens.costCents) : "";
      showPrice();
      catalogue.hidden = state.describing;
      written.hidden = !state.describing;
      if (state.describing) text.focus();
      else run();
      onChange();
    });
    text.addEventListener("input", () => {
      count.textContent = `${text.value.length} / ${DESCRIPTION_MAX}`;
      onChange();
    });
    priceInput.addEventListener("input", onChange);
    costInput.addEventListener("input", onChange);

    run();
    return {
      el,
      /** The lens picked from the list (null when none, or when describing instead). */
      chosen: () => (state.describing ? null : state.chosen?.lens ?? null),
      /** The written description (null unless "describe instead" is ticked and something is written). */
      description: () => (state.describing && text.value.trim() !== "" ? text.value.trim() : null),
      /** The price of the pair as typed ("" when there is no lens to price). */
      price: () => (priceField.hidden ? "" : priceInput.value.trim()),
      /** The pair's cost as typed ("" when none, or when there is no lens). */
      cost: () => (priceField.hidden ? "" : costInput.value.trim()),
      setPrescription,
    };
  }

  // ---- The form -------------------------------------------------------------------------------

  function open(customer, hooks = {}) {
    const frame = picker("frame", (q, by) => newOrderData.searchFrames(q, by), update);
    const accessory = picker("accessory", (q, by) => newOrderData.searchAccessories(q, by), update);

    const lens = lensPicker(update);

    const deposit = h("input", { class: "input", type: "text", inputmode: "decimal", id: "order-deposit", name: "deposit", placeholder: "0", autocomplete: "off", "aria-describedby": "order-deposit-error" });
    const depositError = h("p", { class: "field__error", id: "order-deposit-error", hidden: true });

    // The final price: what the customer pays for the whole order. It starts as the total of the items and follows it until something is typed; lowering it gives a
    // discount. Emptying the box brings the total back.
    const finalPrice = h("input", { class: "input", type: "text", inputmode: "decimal", id: "order-final-price", name: "finalPrice", placeholder: "0", autocomplete: "off", "aria-describedby": "order-final-price-error" });
    const finalError = h("p", { class: "field__error", id: "order-final-price-error", hidden: true });

    const usePrescription = h("input", { type: "checkbox", id: "order-use-rx", name: "usePrescription" });
    const rxBox = h("div", { class: "rx-pick", "data-rx-list": "", hidden: true });
    let rxLoaded = false;
    let chosenRx = null;

    // What was measured with the frame on. Chosen prescription's values start them off; whatever is typed is never overwritten.
    const MEASURES = [
      ["pdRight", "Right PD (mm)"],
      ["pdLeft", "Left PD (mm)"],
      ["fittingHeightRight", "Right fitting height (mm)"],
      ["fittingHeightLeft", "Left fitting height (mm)"],
    ];
    const measure = Object.fromEntries(MEASURES.map(([name]) => [name, h("input", { class: "input", type: "text", inputmode: "decimal", id: `order-${name}`, name, placeholder: "0", autocomplete: "off" })]));
    for (const input of Object.values(measure)) input.addEventListener("input", () => (input.dataset.typed = "1"));
    const promised = h("input", { class: "input", type: "date", id: "order-promised", name: "promisedAt" });
    const notes = h("textarea", { class: "input order-notes", id: "order-notes", name: "notes", rows: "2", maxlength: "2000", placeholder: "Anything the workshop or the customer should know" });

    const problems = h("div", { class: "order-form__problems", role: "alert", "data-problems": "", hidden: true });
    const summary = h("dl", { class: "order-summary", "data-summary": "" });
    const placeButton = h("button", { class: "btn btn--primary", type: "submit", disabled: true, "data-action": "place" }, "Place order");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    let placing = false;

    /** An amount as typed: null when empty, NaN when it is not an amount. Returns centimes. */
    function centsOf(input) {
      const text = String(input ?? "").trim().replace(",", ".");
      if (text === "") return null;
      return /^\d+(\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : Number.NaN;
    }
    const depositCents = () => centsOf(deposit.value);

    /** Something to sell: a frame, an accessory, a lens from the list, or a described lens. */
    const hasSomething = () => Boolean(frame.chosen() || accessory.chosen() || lens.chosen() || lens.description());

    function update() {
      const f = frame.chosen();
      const a = accessory.chosen();
      const priced = [f, a].filter((x) => x && x.price !== null && x.price !== undefined);
      const itemsCents = priced.reduce((sum, x) => sum + Math.round(x.price * 100), 0);
      const lensText = lens.price();
      const lensCents = lensText === "" ? null : centsOf(lensText);
      const lensKnown = lensCents !== null && !Number.isNaN(lensCents);
      const totalCents = itemsCents + (lensKnown ? lensCents : 0);
      const anything = Boolean(f || a || lensKnown);
      if (finalPrice.dataset.typed !== "1") finalPrice.value = anything ? amountOf(totalCents) : ""; // follows the items until it is edited
      const fin = centsOf(finalPrice.value);
      const finKnown = fin !== null && !Number.isNaN(fin);
      const finalCents = finKnown ? fin : totalCents;
      const finMessage = Number.isNaN(fin) ? "Enter an amount, like 20000 or 20000.50." : finKnown && fin > totalCents ? `The final price cannot be more than the items add up to (${price(totalCents / 100, null)}).` : "";
      finalError.textContent = finMessage;
      finalError.hidden = !finMessage;
      if (finMessage) finalPrice.setAttribute("aria-invalid", "true");
      else if (finalPrice.dataset.serverInvalid !== "1") finalPrice.removeAttribute("aria-invalid");
      const dep = depositCents();
      const depKnown = dep !== null && !Number.isNaN(dep);
      summary.replaceChildren();
      const row = (key, label, value) => summary.append(h("div", { class: "order-summary__row" }, h("dt", null, label), h("dd", { "data-field": key }, value)));
      const money = (cents) => price(cents / 100, null);
      row("items", "Frame and accessory", f || a ? money(itemsCents) : "—");
      row("lens", "Lenses", lensKnown ? money(lensCents) : "—");
      if (anything) row("total", "Items total", money(totalCents));
      if (anything && finKnown && fin < totalCents) row("discount", "Discount", money(totalCents - fin));
      if (anything) row("final", "Final price", money(finalCents));
      row("deposit", "Deposit", depKnown ? money(dep) : "—");
      if (anything && depKnown) row("left", "Left to pay", money(Math.max(0, finalCents - dep)));
      dialog.dataset.frame = f ? f.code ?? f.id : "";
      dialog.dataset.accessory = a ? a.code ?? a.id : "";
      dialog.dataset.prescription = chosenRx ?? "";
      dialog.dataset.lens = lens.chosen()?.id ?? "";
      dialog.dataset.lensDescription = lens.description() ?? "";
      placeButton.disabled = placing || !hasSomething();
    }

    finalPrice.addEventListener("input", () => {
      finalPrice.dataset.typed = finalPrice.value.trim() === "" ? "" : "1"; // emptied: the total of the items comes back
      update();
    });

    deposit.addEventListener("input", () => {
      const dep = depositCents();
      const bad = Number.isNaN(dep);
      depositError.textContent = bad ? "Enter an amount, like 5000 or 5000.50." : "";
      depositError.hidden = !bad;
      if (bad) deposit.setAttribute("aria-invalid", "true");
      else deposit.removeAttribute("aria-invalid");
      update();
    });

    /** The chosen prescription's PD and fitting heights start the boxes that nothing was typed in. */
    function startMeasures(entry) {
      for (const [name] of MEASURES) {
        const input = measure[name];
        if (input.dataset.typed === "1") continue;
        input.value = entry?.[name] === null || entry?.[name] === undefined ? "" : String(entry[name]);
      }
    }

    async function loadPrescriptions() {
      rxBox.replaceChildren(h("p", { class: "rx__loading" }, "Loading the prescriptions…"));
      try {
        const list = await newOrderData.prescriptionsFor(customer.id);
        rxLoaded = true;
        if (list.length === 0) {
          rxBox.replaceChildren(h("p", { class: "pick-results__empty", "data-state": "empty" }, `${customer.name} has no prescription on file.`));
          return;
        }
        rxBox.replaceChildren(
          ...list.map((entry) => {
            const radio = h("input", { type: "radio", name: "prescription", value: entry.id, "data-id": entry.id });
            radio.addEventListener("change", () => {
              chosenRx = entry.id;
              startMeasures(entry);
              lens.setPrescription(entry.id);
              update();
            });
            return h("label", { class: "rx-pick__option", "data-id": entry.id }, radio, h("span", { class: "rx-pick__main" }, h("span", { class: "rx-pick__date" }, formatDay(entry.prescribedAt), entry.current ? h("span", { class: "rx-badge" }, "Current") : null), h("span", { class: "rx-pick__line" }, rxLine(entry)), entry.prescriberName ? h("span", { class: "rx-pick__sub" }, entry.prescriberName) : null));
          }),
        );
      } catch (error) {
        rxLoaded = false;
        rxBox.replaceChildren(h("p", { class: "pick-results__empty pick-results__empty--error", role: "alert" }, `The prescriptions couldn't be loaded: ${errorText(error)}`), h("button", { class: "btn btn--secondary btn--sm", type: "button", onclick: loadPrescriptions }, "Try again"));
      }
    }

    usePrescription.addEventListener("change", () => {
      rxBox.hidden = !usePrescription.checked;
      if (usePrescription.checked) {
        if (!rxLoaded) loadPrescriptions();
      } else {
        chosenRx = null;
        for (const radio of rxBox.querySelectorAll("input[type=radio]")) radio.checked = false;
        startMeasures(null);
        lens.setPrescription(null);
      }
      update();
    });

    /** Says what is wrong, in a box at the top of the form, and marks the boxes the server named. */
    const INPUT_FOR = { deposit, finalPrice, lensCost: () => document.getElementById("order-lens-cost"), lensPrice: () => document.getElementById("order-lens-price"), lensDescription: () => document.getElementById("order-lens-description"), promisedAt: promised, notes, ...measure };
    function showProblems(messages, fields = []) {
      problems.replaceChildren(h("p", { class: "order-form__problems-lead" }, "The order was not placed:"), h("ul", { class: "order-form__problems-list" }, [...new Set(messages)].map((message) => h("li", null, message))));
      problems.hidden = false;
      for (const field of fields) {
        const target = INPUT_FOR[field];
        const box = typeof target === "function" ? target() : target;
        box?.setAttribute("aria-invalid", "true");
        if (box) box.dataset.serverInvalid = "1"; // cleared as soon as the box is edited, or on the next try
      }
      problems.scrollIntoView({ block: "nearest" });
    }

    function clearServerMark(box) {
      box.removeAttribute("aria-invalid");
      delete box.dataset.serverInvalid;
    }

    async function place() {
      if (placing || !hasSomething()) return;
      placing = true;
      placeButton.textContent = "Placing…";
      update();
      problems.hidden = true;
      for (const bad of dialog.querySelectorAll("[data-server-invalid]")) clearServerMark(bad);
      const lensChosen = lens.chosen();
      const lensDescription = lens.description();
      const draft = {
        customerId: customer.id,
        prescriptionId: chosenRx,
        frameId: frame.chosen()?.id ?? null,
        accessoryId: accessory.chosen()?.id ?? null,
        lensId: lensChosen?.id ?? null,
        lensDescription,
        lensPrice: lensChosen || lensDescription ? lens.price() : "",
        finalPrice: finalPrice.dataset.typed === "1" ? finalPrice.value : "", // untouched = the total of the items
        lensCost: lensChosen || lensDescription ? lens.cost() : "",
        deposit: deposit.value,
        pdRight: measure.pdRight.value,
        pdLeft: measure.pdLeft.value,
        fittingHeightRight: measure.fittingHeightRight.value,
        fittingHeightLeft: measure.fittingHeightLeft.value,
        promisedAt: promised.value,
        notes: notes.value,
      };
      try {
        const result = await newOrderData.placeOrder(draft);
        if (result.status !== "placed") {
          showProblems(Object.values(result.errors), Object.keys(result.errors));
          return;
        }
        dialog.close();
        hooks.onPlaced?.(result);
        window.showOrderPlaced?.(result); // the "Order placed" box, where the invoice and the lab sheet are printed
      } catch (error) {
        showProblems([errorText(error)]);
      } finally {
        placing = false;
        placeButton.textContent = "Place order";
        update();
      }
    }

    const section = (title, ...children) => h("section", { class: "order-form__section" }, h("h3", { class: "order-form__heading" }, title), ...children);
    const field = (label, id, input) => h("div", { class: "field" }, h("label", { class: "field__label", for: id }, label), input);
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "new-order-title" }, "New order"), h("p", { class: "dialog__subtitle" }, `For ${customer.name}.`)), close),
      h(
        "div",
        { class: "dialog__body" },
        section("Frame", h("p", { class: "field__help" }, "Optional. Search your frames."), frame.el),
        section("Accessory", h("p", { class: "field__help" }, "Optional. Search your accessories."), accessory.el),
        section("Deposit", h("div", { class: "field" }, h("label", { class: "field__label", for: "order-deposit" }, `Paid now (${CURRENCY})`, h("span", { class: "field__hint" }, "Optional")), deposit, depositError)),
        section("Prescription", h("label", { class: "lens-check" }, usePrescription, "Use one of this customer's prescriptions"), rxBox),
        section("Lenses", h("p", { class: "field__help" }, "Optional. The same lens for both eyes. Lenses are chosen for a prescription: choose one above, or describe the lens in words."), lens.el),
        section("Measurements", h("p", { class: "field__help" }, "Optional. Measured on the customer with the frame on. They start from the chosen prescription."), h("div", { class: "order-form__grid" }, MEASURES.map(([name, label]) => field(label, `order-${name}`, measure[name])))),
        section("Details", h("div", { class: "order-form__grid" }, field("Promised for", "order-promised", promised), field("Notes", "order-notes", notes))),
        section("Final price", h("p", { class: "field__help" }, "What the customer pays for everything. It starts as the total of the items: lower it to give a discount."), h("div", { class: "field" }, h("label", { class: "field__label", for: "order-final-price" }, `Final price (${CURRENCY})`), finalPrice, finalError)),
        h("div", { class: "order-form__summary" }, summary),
        problems,
      ),
      h("div", { class: "dialog__footer" }, cancel, placeButton),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": "new-order-title", "data-new-order": customer.id }, form);
    document.body.append(dialog);
    const dismiss = () => dialog.close();
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("input", (event) => {
      if (event.target?.dataset?.serverInvalid) clearServerMark(event.target); // a box the server marked wrong is cleared as soon as it is edited
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      place();
    });
    update();
    dialog.showModal();
    document.getElementById("order-frame-search").focus();
  }

  window.openNewOrderForm = open;
})();
