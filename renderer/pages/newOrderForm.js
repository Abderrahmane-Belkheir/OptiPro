// The New order form, opened from a customer's Orders tab:  window.openNewOrderForm(customer)
// UI ONLY: nothing is saved and no order is placed. What it SHOWS is real: the frames and accessories come from a search of the shop's own
// products, and the prescriptions are the customer's own. The steps, top to bottom:
//   1. a frame (search, optional)      2. an accessory (search, optional, separate)      3. a deposit      4. a prescription (optional)
//
//   window.newOrderData   <- THE ONE PLACE TO WIRE THE LOGIC. The screen calls nothing else.
//     searchFrames(text)          real frames          (electronAPI.frames.search)
//     searchAccessories(text)     real accessories     (electronAPI.accessories.search)
//     prescriptionsFor(customerId) the customer's prescriptions, newest first (electronAPI.prescriptions.listForCustomer)
//     parseScan(text)             reads what a barcode scanner typed (a product code, or a label's QR address): { kind, code } or null
//     placeOrder(draft)           NOT BUILT YET: it is never called. The draft it will receive is
//                                 { customerId, frameId | null, accessoryId | null, depositCents, prescriptionId | null }.
(() => {
  "use strict";

  const CURRENCY = "DZD";
  const SEARCH_DELAY_MS = 200;
  const BROWSE_COUNT = 8; // what a picker shows before anything is typed

  const newOrderData = {
    searchFrames: (text) => window.electronAPI.frames.search(text, BROWSE_COUNT * 3),
    searchAccessories: (text) => window.electronAPI.accessories.search(text, BROWSE_COUNT * 3),
    prescriptionsFor: (customerId) => window.electronAPI.prescriptions.listForCustomer(customerId),
    /** What a scanner typed: { kind, code } for a product code or the address on a label's QR code, null for anything else. */
    parseScan: (text) => window.electronAPI.labels.parseScan(text),
    /** Not built yet. When it is: validate the draft, save the order, its lines and the deposit in one local transaction, and resolve with the order. */
    async placeOrder() {
      throw new Error("Placing an order is not built yet.");
    },
  };
  window.newOrderData = newOrderData;

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
   * kind: "frame" | "accessory". Answers { el, chosen() }. The search runs against the real products as the person types (and once at the start,
   * to show the first ones); choosing one replaces the box with a card and a "Change" button.
   */
  function picker(kind, search, onChange) {
    const noun = kind === "frame" ? "frame" : "accessory";
    const state = { chosen: null, token: 0, timer: 0 };
    const input = h("input", { class: "input", type: "search", id: `order-${kind}-search`, "data-picker": kind, placeholder: kind === "frame" ? "Search or scan: name, code, brand or reference" : "Search or scan: name or code", autocomplete: "off", "aria-label": `Search ${noun}s` });
    const results = h("div", { class: "pick-results", role: "listbox", "aria-label": `${noun} results`, "data-results": kind });
    const search_ = h("div", { class: "pick-search" }, h("div", { class: "search pick-search__box" }, icon("search"), input), results);
    const card = h("div", { class: "pick-chosen", "data-chosen": kind, hidden: true });
    const el = h("div", { class: "pick", "data-kind": kind }, search_, card);

    function showResults(items, query) {
      results.replaceChildren();
      results.dataset.status = "ready";
      if (items.length === 0) {
        results.append(h("p", { class: "pick-results__empty" }, query.trim() ? `No ${noun} matches “${query.trim()}”.` : `There is no ${noun} in the shop yet.`));
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

    async function run() {
      const token = ++state.token;
      const query = input.value;
      results.dataset.status = "loading";
      try {
        const items = await search(query);
        if (token !== state.token) return;
        showResults(items, query);
      } catch (error) {
        if (token !== state.token) return;
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
      input.focus();
      onChange();
    }

    input.addEventListener("input", () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(run, SEARCH_DELAY_MS);
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
        const items = await search(scan.code);
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
    run(); // the first ones, so the picker shows real products at once
    return { el, chosen: () => state.chosen };
  }

  // ---- The form -------------------------------------------------------------------------------

  function open(customer) {
    const frame = picker("frame", (q) => newOrderData.searchFrames(q), update);
    const accessory = picker("accessory", (q) => newOrderData.searchAccessories(q), update);

    const deposit = h("input", { class: "input", type: "text", inputmode: "decimal", id: "order-deposit", name: "deposit", placeholder: "0", autocomplete: "off", "aria-describedby": "order-deposit-error" });
    const depositError = h("p", { class: "field__error", id: "order-deposit-error", hidden: true });

    const usePrescription = h("input", { type: "checkbox", id: "order-use-rx", name: "usePrescription" });
    const rxBox = h("div", { class: "rx-pick", "data-rx-list": "", hidden: true });
    let rxLoaded = false;
    let chosenRx = null;

    const summary = h("dl", { class: "order-summary", "data-summary": "" });
    const placeButton = h("button", { class: "btn btn--primary", type: "submit", disabled: true, title: "Placing an order is not built yet", "data-action": "place" }, "Place order");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));

    /** The deposit as typed: null when empty, NaN when it is not an amount. */
    function depositValue() {
      const text = deposit.value.trim().replace(",", ".");
      if (text === "") return null;
      return /^\d+(\.\d{1,2})?$/.test(text) ? Number(text) : Number.NaN;
    }

    function update() {
      const f = frame.chosen();
      const a = accessory.chosen();
      const priced = [f, a].filter((x) => x && x.price !== null && x.price !== undefined);
      const items = priced.reduce((sum, x) => sum + x.price, 0);
      const dep = depositValue();
      summary.replaceChildren();
      const row = (key, label, value) => summary.append(h("div", { class: "order-summary__row" }, h("dt", null, label), h("dd", { "data-field": key }, value)));
      row("items", "Frame and accessory", f || a ? price(items, null) : "—");
      row("deposit", "Deposit", dep === null || Number.isNaN(dep) ? "—" : price(dep, null));
      if ((f || a) && dep !== null && !Number.isNaN(dep)) row("left", "Left to pay (lenses not included)", price(Math.max(0, items - dep), null));
      dialog.dataset.frame = f ? f.code ?? f.id : "";
      dialog.dataset.accessory = a ? a.code ?? a.id : "";
      dialog.dataset.prescription = chosenRx ?? "";
    }

    deposit.addEventListener("input", () => {
      const dep = depositValue();
      const bad = Number.isNaN(dep);
      depositError.textContent = bad ? "Enter an amount, like 5000 or 5000.50." : "";
      depositError.hidden = !bad;
      if (bad) deposit.setAttribute("aria-invalid", "true");
      else deposit.removeAttribute("aria-invalid");
      update();
    });

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
      }
      update();
    });

    const section = (title, ...children) => h("section", { class: "order-form__section" }, h("h3", { class: "order-form__heading" }, title), ...children);
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "new-order-title" }, "New order"), h("p", { class: "dialog__subtitle" }, `For ${customer.name}. Nothing is saved yet: this form only shows how the order will be made.`)), close),
      h(
        "div",
        { class: "dialog__body" },
        section("Frame", h("p", { class: "field__help" }, "Optional. Search your frames."), frame.el),
        section("Accessory", h("p", { class: "field__help" }, "Optional. Search your accessories."), accessory.el),
        section("Deposit", h("div", { class: "field" }, h("label", { class: "field__label", for: "order-deposit" }, `Paid now (${CURRENCY})`, h("span", { class: "field__hint" }, "Optional")), deposit, depositError)),
        section("Prescription", h("label", { class: "lens-check" }, usePrescription, "Use one of this customer's prescriptions"), rxBox),
        h("div", { class: "order-form__summary" }, summary),
      ),
      h("div", { class: "dialog__footer" }, h("span", { class: "order-form__note" }, "Placing the order is not built yet."), cancel, placeButton),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": "new-order-title", "data-new-order": customer.id }, form);
    document.body.append(dialog);
    const dismiss = () => dialog.close();
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("close", () => dialog.remove());
    form.addEventListener("submit", (event) => event.preventDefault()); // nothing is placed
    update();
    dialog.showModal();
    document.getElementById("order-frame-search").focus();
  }

  window.openNewOrderForm = open;
})();
