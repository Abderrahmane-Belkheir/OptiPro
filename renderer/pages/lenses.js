// The Lenses page (#inventory/lenses): the lenses the shop sells, each with its power interval, price and details.
// All data goes through window.electronAPI.lenses (listWithUsage / create / edit / setActive / delete): the service validates and enforces the
// rules (a lens an order line uses cannot be deleted, only retired); the checks here only show what the service answers.
//
// A lens is a catalog entry. Its price is a plain amount: it is not tied to a pair or to one lens, the order line says how many and which eye.
// Every limit is optional ("no limit known"), and the design and material are free text with the usual ones suggested, so any shop can use it.
(() => {
  "use strict";

  const api = window.electronAPI.lenses;
  const CURRENCY = "DZD"; // the shop's currency; the same constant as the dashboard until orders and settings carry one
  const DESIGNS = [["single_vision", "Single vision"], ["bifocal", "Bifocal"], ["progressive", "Progressive"]];
  const MATERIALS = [["organic", "Organic"], ["polycarbonate", "Polycarbonate"], ["mineral", "Mineral"], ["high_index", "High index"]];

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
  const kindOf = (error) => /^\[([\w-]+)\]/.exec(String(error?.message ?? ""))?.[1] ?? null;

  const wholeFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
  const exactFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  /** 24000.00 -> "DZD 24,000"; 180.50 -> "DZD 180.50" (the decimals only when there are some). */
  const money = (cents) => (cents % 100 === 0 ? wholeFormat : exactFormat).format(cents / 100);

  /** "single_vision" -> "Single vision"; a code the app does not know is shown the way it was typed. */
  function label(code, list) {
    const known = list.find(([c]) => c === code);
    if (known) return known[1];
    const text = String(code ?? "").replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Diopters with a sign for the plus and two decimals: "+2.00", "-1.25", "0.00". */
  const diopter = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;

  /** One interval in words: "-10.00 to +7.00", "from -10.00", "up to +7.00", or null when nothing is known. */
  function interval(min, max) {
    if (min !== null && max !== null) return `${diopter(min)} to ${diopter(max)}`;
    if (min !== null) return `from ${diopter(min)}`;
    if (max !== null) return `up to ${diopter(max)}`;
    return null;
  }

  function limits(lens) {
    const parts = [["Sph", interval(lens.sphereMin, lens.sphereMax)], ["Cyl", interval(lens.cylinderMin, lens.cylinderMax)], ["Add", interval(lens.addMin, lens.addMax)]].filter(([, text]) => text);
    if (lens.combinedLimit !== null) parts.push(["S+C", `up to ${lens.combinedLimit.toFixed(2)}`, "The largest |sphere + cylinder| the maker allows"]);
    return parts;
  }

  /** The lab's lead time and the smallest fitting height, when known. */
  function details(lens) {
    const parts = [lens.leadTimeDays !== null ? `${lens.leadTimeDays} ${lens.leadTimeDays === 1 ? "day" : "days"}` : null, lens.minFittingHeight !== null ? `min. fitting height ${lens.minFittingHeight} mm` : null].filter(Boolean);
    return parts.length ? h("span", { class: "cell-name__sub", "data-cell": "details" }, parts.join(" · ")) : null;
  }

  function extras(lens) {
    return [lens.antiReflective && "Anti-reflective", lens.blueLightFilter && "Blue-light", lens.photochromic && "Photochromic", lens.polarized && "Polarized", lens.tint && `Tint: ${lens.tint}`].filter(Boolean);
  }

  // ---- Toasts --------------------------------------------------------------------------------

  function toast(message, kind = "success") {
    let box = document.querySelector(".toasts");
    if (!box) {
      box = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.append(box);
    }
    const el = h("div", { class: `toast toast--${kind}` }, icon(kind === "error" ? "alert" : "check"), h("span", null, message));
    box.append(el);
    setTimeout(() => el.remove(), kind === "error" ? 7000 : 4000);
  }

  // ---- State and loading ---------------------------------------------------------------------

  const state = { status: "loading", lenses: [], error: "", query: "", showRetired: false, token: 0 };
  let root = null;
  let refs = null;

  async function load() {
    const token = ++state.token;
    state.status = "loading";
    render();
    try {
      const lenses = await api.listWithUsage();
      if (token !== state.token) return;
      state.lenses = lenses;
      state.status = "ready";
    } catch (error) {
      if (token !== state.token) return;
      state.status = "error";
      state.error = errorText(error);
    }
    render();
  }

  function visible() {
    const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    return state.lenses.filter((lens) => {
      if (!state.showRetired && !lens.isActive) return false;
      const haystack = [lens.name, lens.brand, lens.reference, label(lens.design, DESIGNS), label(lens.material, MATERIALS), lens.tint].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }

  // ---- The page ------------------------------------------------------------------------------

  function build() {
    const searchInput = h("input", { class: "search__input", type: "search", placeholder: "Search by name, maker, code or design", "aria-label": "Search lenses", autocomplete: "off" });
    const clear = h("button", { class: "search__clear", type: "button", "aria-label": "Clear search", hidden: true }, icon("x"));
    searchInput.addEventListener("input", () => {
      clear.hidden = !searchInput.value;
      state.query = searchInput.value;
      render();
    });
    clear.addEventListener("click", () => {
      searchInput.value = "";
      clear.hidden = true;
      state.query = "";
      searchInput.focus();
      render();
    });
    const retired = h("input", { type: "checkbox", id: "lens-show-retired", "data-filter": "retired" });
    retired.checked = state.showRetired;
    retired.addEventListener("change", () => {
      state.showRetired = retired.checked;
      render();
    });
    refs = { count: h("p", { class: "toolbar__count" }), card: h("div", { class: "table-card" }) };
    return h(
      "section",
      { class: "page", "aria-labelledby": "lenses-title" },
      h(
        "header",
        { class: "page__header" },
        h("div", null, h("h2", { class: "page__title", id: "lenses-title" }, "Lenses"), h("p", { class: "page__description" }, "What you sell: each lens with the power interval it can be made for, its price and details.")),
        h("button", { class: "btn btn--primary", type: "button", id: "add-lens", onclick: () => openForm(null) }, icon("plus"), "Add lens"),
      ),
      h("div", { class: "toolbar" }, h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() }, icon("search"), searchInput, clear), h("label", { class: "lens-filter" }, retired, "Show retired"), refs.count),
      refs.card,
    );
  }

  function render() {
    if (!root) return;
    const lenses = visible();
    const retiredCount = state.lenses.filter((l) => !l.isActive).length;
    refs.count.textContent = state.status === "ready" ? `${lenses.length} ${lenses.length === 1 ? "lens" : "lenses"}${state.query.trim() ? " found" : ""}${!state.showRetired && retiredCount ? ` · ${retiredCount} retired hidden` : ""}` : "";
    refs.card.replaceChildren();
    refs.card.dataset.status = state.status;
    if (state.status === "loading" && state.lenses.length === 0) return refs.card.append(h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the lenses…")));
    if (state.status === "error") {
      return refs.card.append(h("div", { class: "state state--error", role: "alert" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, "The lenses couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
    }
    if (lenses.length === 0) return refs.card.append(emptyState());
    refs.card.append(table(lenses));
  }

  function emptyState() {
    const searching = state.query.trim().length > 0;
    const onlyRetired = !searching && state.lenses.length > 0 && !state.showRetired;
    return h(
      "div",
      { class: "state", "data-state": "empty" },
      h("span", { class: "state__icon" }, icon(searching ? "search" : "lens")),
      h("h3", { class: "state__title" }, searching ? "No lens matches your search" : onlyRetired ? "Every lens is retired" : "No lens yet"),
      h("p", { class: "state__text" }, searching ? `Nothing found for “${state.query.trim()}”.` : onlyRetired ? "Tick “Show retired” to see them, or add a new one." : "Add the lenses you sell, with their price and the power interval each can be made for. Every limit is optional."),
      h("button", { class: "btn btn--primary", type: "button", onclick: () => openForm(null) }, icon("plus"), "Add lens"),
    );
  }

  function table(lenses) {
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table lens-table" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Lens"), h("th", { scope: "col" }, "Type"), h("th", { scope: "col" }, "Power interval"), h("th", { scope: "col", class: "lens-money" }, "Price"), h("th", { scope: "col", class: "lens-money" }, "Cost"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col", class: "col-actions" }, h("span", { class: "visually-hidden" }, "Actions")))),
        h("tbody", null, lenses.map(row)),
      ),
    );
  }

  function row(lens) {
    const parts = limits(lens);
    const more = extras(lens);
    const menuButton = h("button", { class: "row-menu-button", type: "button", "aria-label": `Actions for ${lens.name}`, "aria-haspopup": "menu", "aria-expanded": "false", onclick: (event) => toggleRowMenu(event.currentTarget, lens) }, icon("more"));
    return h(
      "tr",
      { "data-id": lens.id, "data-active": String(lens.isActive), class: lens.isActive ? null : "lens-row--retired" },
      h("td", null, h("div", { class: "cell-name__stack" }, h("span", { class: "cell-name__text" }, lens.name), h("span", { class: "cell-name__sub" }, [lens.brand, lens.reference].filter(Boolean).join(" · ")))),
      h("td", null, h("div", { class: "cell-name__stack" }, h("span", null, label(lens.design, DESIGNS)), h("span", { class: "cell-name__sub" }, [label(lens.material, MATERIALS), lens.refractiveIndex !== null ? `index ${lens.refractiveIndex}` : null].filter(Boolean).join(" · ")), details(lens), more.length ? h("span", { class: "lens-extras" }, more.map((m) => h("span", { class: "lens-tag" }, m))) : null)),
      h("td", { "data-cell": "interval" }, parts.length ? h("div", { class: "lens-limits" }, parts.map(([k, v, tip]) => h("span", { class: "lens-limit", title: tip ?? false }, h("span", { class: "lens-limit__key" }, k), v))) : h("span", { class: "cell-empty" }, "No limit set")),
      h("td", { class: "lens-money", "data-cell": "price" }, money(lens.priceCents)),
      h("td", { class: "lens-money cell-secondary", "data-cell": "cost" }, lens.costCents ? money(lens.costCents) : h("span", { class: "cell-empty" }, "—")),
      h("td", null, h("span", { class: `lens-status lens-status--${lens.isActive ? "active" : "retired"}` }, lens.isActive ? "Active" : "Retired"), lens.usedByOrderLines > 0 ? h("span", { class: "cell-name__sub", "data-cell": "used" }, `used in ${lens.usedByOrderLines} order ${lens.usedByOrderLines === 1 ? "line" : "lines"}`) : null),
      h("td", { class: "col-actions" }, menuButton),
    );
  }

  // ---- Row menu ------------------------------------------------------------------------------

  const popup = h("div", { class: "popup", role: "menu", hidden: true });
  document.body.append(popup);
  let popupOwner = null;

  function closePopup(returnFocus) {
    if (popup.hidden) return;
    popup.hidden = true;
    popupOwner?.setAttribute("aria-expanded", "false");
    if (returnFocus) popupOwner?.focus();
    popupOwner = null;
  }

  function toggleRowMenu(button, lens) {
    if (popupOwner === button) return closePopup(false);
    closePopup(false);
    popup.replaceChildren(
      h("button", { class: "popup__item", type: "button", role: "menuitem", "data-action": "edit", onclick: () => { closePopup(false); openForm(lens); } }, icon("edit"), "Edit"),
      h("button", { class: "popup__item", type: "button", role: "menuitem", "data-action": "toggle", onclick: () => { closePopup(false); setActive(lens, !lens.isActive); } }, icon(lens.isActive ? "eye" : "refresh"), lens.isActive ? "Retire" : "Bring back"),
      h("button", { class: "popup__item popup__item--danger", type: "button", role: "menuitem", "data-action": "delete", onclick: () => { closePopup(false); openDelete(lens); } }, icon("trash"), "Delete"),
    );
    popup.hidden = false;
    const rect = button.getBoundingClientRect();
    const menu = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, rect.right - menu.width)}px`;
    popup.style.top = `${rect.bottom + menu.height + 12 > window.innerHeight ? rect.top - menu.height - 4 : rect.bottom + 4}px`;
    button.setAttribute("aria-expanded", "true");
    popupOwner = button;
    popup.querySelector("button").focus();
  }

  popup.addEventListener("keydown", (event) => {
    const items = [...popup.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown") items[(index + 1) % items.length].focus();
    else if (event.key === "ArrowUp") items[(index - 1 + items.length) % items.length].focus();
    else if (event.key === "Escape") closePopup(true);
    else if (event.key === "Tab") closePopup(false);
    else return;
    event.preventDefault();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".popup, .row-menu-button")) closePopup(false);
  });
  window.addEventListener("resize", () => closePopup(false));
  document.addEventListener("scroll", () => closePopup(false), true);

  async function setActive(lens, isActive) {
    try {
      await api.setActive(lens.id, isActive);
      toast(isActive ? `${lens.name} is offered again.` : `${lens.name} was retired. It stays in your records.`);
    } catch (error) {
      toast(errorText(error), "error");
    }
    await load();
  }

  // ---- Create / edit dialog ------------------------------------------------------------------

  /** The number fields of the power interval, in the order they are shown. */
  const INTERVAL = [
    ["Sphere", "sphereMin", "sphereMax"],
    ["Cylinder", "cylinderMin", "cylinderMax"],
    ["Add", "addMin", "addMax"],
  ];
  const TEXT_FIELDS = ["name", "design", "material", "refractiveIndex", "price", "cost", "leadTimeDays", "tint", "sphereMin", "sphereMax", "cylinderMin", "cylinderMax", "addMin", "addMax", "combinedLimit", "minFittingHeight", "brand", "reference", "notes"];
  const FLAGS = [["antiReflective", "Anti-reflective"], ["blueLightFilter", "Blue-light filter"], ["photochromic", "Photochromic"], ["polarized", "Polarized"]];

  const shown = (v) => (v === null || v === undefined ? "" : String(v));

  function openForm(lens) {
    const editing = lens !== null;
    const inputs = {};
    const errorEls = {};

    const control = (name, props = {}) => {
      const id = `lens-${name}`;
      const el = props.textarea ? h("textarea", { class: "input", id, name, rows: 3, "aria-describedby": `${id}-error` }) : h("input", { class: "input", id, name, type: "text", autocomplete: "off", inputmode: props.numeric ? "decimal" : false, list: props.list ?? false, placeholder: props.placeholder ?? false, "aria-describedby": `${id}-error` });
      inputs[name] = el;
      errorEls[name] = h("p", { class: "field__error", id: `${id}-error`, hidden: true });
      el.addEventListener("input", () => setFieldError(name, ""));
      return el;
    };
    const field = (name, text, props = {}) => {
      const el = control(name, props);
      return h("div", { class: `field${props.wide ? " field--wide" : ""}` }, h("label", { class: "field__label", for: `lens-${name}` }, text, props.required ? h("span", { class: "field__required", "aria-hidden": "true" }, "*") : h("span", { class: "field__hint" }, "Optional")), el, props.hint ? h("p", { class: "field__help" }, props.hint) : null, errorEls[name]);
    };
    const flagBox = (name, text) => {
      const box = h("input", { type: "checkbox", id: `lens-${name}`, name });
      inputs[name] = box;
      return h("label", { class: "lens-check" }, box, text);
    };

    // the values to start from
    const start = lens ?? {};
    const intervalRow = ([text, minKey, maxKey]) => {
      const lo = control(minKey, { numeric: true, placeholder: "min" });
      const hi = control(maxKey, { numeric: true, placeholder: "max" });
      return h("tr", null, h("th", { scope: "row" }, text), h("td", null, lo, errorEls[minKey]), h("td", null, hi, errorEls[maxKey]));
    };

    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const showBanner = (message) => {
      banner.querySelector("span").textContent = message;
      banner.hidden = !message;
    };

    const nameField = field("name", "Name", { required: true, wide: true, placeholder: "Progressive 1.6 blue-cut" });
    const designField = field("design", "Design", { list: "lens-designs", placeholder: "Single vision", hint: "Pick one or type your own." });
    const materialField = field("material", "Material", { list: "lens-materials", placeholder: "Organic" });
    const indexField = field("refractiveIndex", "Index", { numeric: true, placeholder: "1.6" });
    const priceField = field("price", "Price", { numeric: true, placeholder: "0", hint: `In ${CURRENCY}. Not tied to a pair or one lens: the order line says how many.` });
    const costField = field("cost", "Cost", { numeric: true, placeholder: "0", hint: "What it normally costs you." });
    const leadField = field("leadTimeDays", "Lead time (days)", { numeric: true, placeholder: "7", hint: "How long the lab usually needs." });
    const tintField = field("tint", "Tint", { placeholder: "grey, brown…" });
    const flags = h("div", { class: "lens-checks" }, FLAGS.map(([n, t]) => flagBox(n, t)));
    const activeBox = flagBox("isActive", "Offered (untick to retire this lens)");
    const combined = field("combinedLimit", "Strongest meridian", { numeric: true, placeholder: "12.00", hint: "The largest |sphere + cylinder| the maker allows." });
    const fitting = field("minFittingHeight", "Minimum fitting height (mm)", { numeric: true, placeholder: "14", hint: "The smallest height a progressive can be made for (its corridor length)." });
    const intervalTable = h("table", { class: "lens-interval" }, h("thead", null, h("tr", null, h("th", null), h("th", null, "Smallest"), h("th", null, "Largest"))), h("tbody", null, INTERVAL.map(intervalRow)));
    const brandField = field("brand", "Maker", { placeholder: "Essilor, Zeiss…" });
    const referenceField = field("reference", "Code", { placeholder: "the maker's or supplier's code" });
    const notesField = field("notes", "Notes", { textarea: true, wide: true });

    const submit = h("button", { class: "btn btn--primary", type: "submit", "data-action": "save" }, editing ? "Save changes" : "Add lens");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    const datalists = [
      h("datalist", { id: "lens-designs" }, DESIGNS.map(([, text]) => h("option", { value: text }))),
      h("datalist", { id: "lens-materials" }, MATERIALS.map(([, text]) => h("option", { value: text }))),
    ];

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "lens-dialog-title" }, editing ? "Edit lens" : "Add lens"), h("p", { class: "dialog__subtitle" }, editing ? `Update ${lens.name}. Orders already made keep their price.` : "Only the name is required. Every limit is optional.")), close),
      h(
        "div",
        { class: "dialog__body" },
        banner,
        h("div", { class: "form-grid" }, nameField, designField, materialField, indexField, h("div", { class: "field" }), priceField, costField, leadField),
        h("h3", { class: "lens-section" }, "Options"),
        flags,
        h("div", { class: "form-grid" }, tintField),
        h("h3", { class: "lens-section" }, "Power interval", h("span", { class: "field__hint" }, "Optional")),
        h("p", { class: "field__help" }, "The values this lens can be made for, written like a prescription (cylinder usually minus). Leave a side empty when you don't know the limit."),
        intervalTable,
        h("div", { class: "form-grid" }, combined, fitting),
        h("h3", { class: "lens-section" }, "More information"),
        h("div", { class: "form-grid" }, brandField, referenceField, notesField),
        activeBox,
        ...datalists,
      ),
      h("div", { class: "dialog__footer" }, cancel, submit),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": "lens-dialog-title", "data-lens-form": editing ? lens.id : "new" }, form);
    document.body.append(dialog);

    // fill in
    inputs.name.value = shown(start.name);
    inputs.design.value = editing ? label(start.design, DESIGNS) : "";
    inputs.material.value = editing ? label(start.material, MATERIALS) : "";
    inputs.refractiveIndex.value = shown(start.refractiveIndex);
    inputs.price.value = editing ? shown(start.priceCents / 100) : "";
    inputs.cost.value = editing && start.costCents ? shown(start.costCents / 100) : "";
    inputs.tint.value = shown(start.tint);
    for (const [, minKey, maxKey] of INTERVAL) {
      inputs[minKey].value = shown(start[minKey]);
      inputs[maxKey].value = shown(start[maxKey]);
    }
    inputs.combinedLimit.value = shown(start.combinedLimit);
    inputs.leadTimeDays.value = shown(start.leadTimeDays);
    inputs.minFittingHeight.value = shown(start.minFittingHeight);
    inputs.brand.value = shown(start.brand);
    inputs.reference.value = shown(start.reference);
    inputs.notes.value = shown(start.notes);
    for (const [n] of FLAGS) inputs[n].checked = Boolean(start[n]);
    inputs.isActive.checked = editing ? start.isActive : true;

    function setFieldError(name, message) {
      if (!errorEls[name]) return;
      errorEls[name].textContent = message;
      errorEls[name].hidden = !message;
      if (message) inputs[name].setAttribute("aria-invalid", "true");
      else inputs[name].removeAttribute("aria-invalid");
    }

    let busy = false;
    const dismiss = () => !busy && dialog.close();
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      showBanner("");
      for (const n of TEXT_FIELDS) setFieldError(n, "");
      const values = Object.fromEntries(TEXT_FIELDS.map((n) => [n, inputs[n].value.trim()]));
      for (const [n] of FLAGS) values[n] = inputs[n].checked;
      values.isActive = inputs.isActive.checked;

      busy = true;
      submit.disabled = cancel.disabled = close.disabled = true;
      submit.replaceChildren(h("span", { class: "btn__spinner" }), editing ? "Saving…" : "Adding…");
      const reopen = () => {
        busy = false;
        submit.disabled = cancel.disabled = close.disabled = false;
        submit.replaceChildren(editing ? "Save changes" : "Add lens");
      };
      try {
        const result = editing ? await api.edit(lens.id, values) : await api.create(values);
        if (result.status === "invalid") {
          reopen();
          for (const [n, message] of Object.entries(result.errors)) setFieldError(n, message);
          const first = TEXT_FIELDS.find((n) => result.errors[n]);
          if (first) inputs[first].focus();
          else showBanner("Some values are not valid.");
          return;
        }
        busy = false;
        dialog.close();
        toast(result.status === "created" ? `${result.lens.name} was added.` : `${result.lens.name} was updated.`);
        await load();
      } catch (error) {
        reopen();
        if (kindOf(error) === "not-found") {
          dialog.close();
          toast("This lens no longer exists.", "error");
          await load();
        } else showBanner(errorText(error));
      }
    });

    dialog.showModal();
    inputs.name.focus();
  }

  // ---- Delete --------------------------------------------------------------------------------

  function openDelete(lens) {
    const used = lens.usedByOrderLines;
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const confirm = used > 0
      ? h("button", { class: "btn btn--primary", type: "submit", "data-action": "retire-instead" }, "Retire it instead")
      : h("button", { class: "btn btn--danger", type: "submit", "data-action": "confirm-delete" }, icon("trash"), "Delete lens");
    const text = used > 0
      ? `“${lens.name}” is used by ${used} order ${used === 1 ? "line" : "lines"}, so it can't be deleted: those orders keep it. You can retire it instead. It is no longer offered, and nothing is lost.`
      : "It is removed from this computer and from the server. It cannot be undone.";
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "lens-delete-title" }, used > 0 ? "This lens is in use" : "Delete this lens?"), h("p", { class: "dialog__subtitle" }, lens.name))),
      h("div", { class: "dialog__body" }, banner, h("p", null, text)),
      h("div", { class: "dialog__footer" }, cancel, confirm),
    );
    const dialog = h("dialog", { class: "dialog dialog--narrow", "aria-labelledby": "lens-delete-title", "data-lens-delete": lens.id }, form);
    document.body.append(dialog);
    let busy = false;
    cancel.addEventListener("click", () => !busy && dialog.close());
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      banner.hidden = true;
      busy = true;
      confirm.disabled = cancel.disabled = true;
      try {
        if (used > 0) {
          await api.setActive(lens.id, false);
          busy = false;
          dialog.close();
          toast(`${lens.name} was retired. It stays in your records.`);
        } else {
          const result = await api.delete(lens.id);
          busy = false;
          dialog.close();
          toast(result.sentToServer ? `${lens.name} was deleted.` : `${lens.name} was deleted from this computer. The server will be told when it can be reached.`);
        }
        await load();
      } catch (error) {
        busy = false;
        confirm.disabled = cancel.disabled = false;
        if (kindOf(error) === "not-found") {
          dialog.close();
          toast("This lens was already deleted.", "error");
          await load();
          return;
        }
        banner.querySelector("span").textContent = errorText(error); // the service says why (an order line started using it meanwhile)
        banner.hidden = false;
      }
    });
    dialog.showModal();
    cancel.focus();
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const here = location.hash.slice(1) === "inventory/lenses";
    if (here && !root) {
      root = build();
      content.replaceChildren(root);
      load(); // read again each time the page is opened
    } else if (!here && root) {
      closePopup(false);
      root.remove();
      root = null;
      state.token++;
      state.query = "";
      state.showRetired = false;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
