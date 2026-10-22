// The Suppliers page (#suppliers): who the shop buys from (a lab, a frame or lens maker, an accessories seller): what each supplies and how to reach it.
// All data goes through window.electronAPI.suppliers (list / create / edit / setActive / delete): the service validates and enforces the rules;
// the checks here only show what the service answers. Only the name is required.
(() => {
  "use strict";

  const api = window.electronAPI.suppliers;
  const KINDS = [["lab", "Lab"], ["frames", "Frames"], ["lenses", "Lenses"], ["accessories", "Accessories"], ["other", "Other"]];
  const KIND_LABEL = Object.fromEntries(KINDS);

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
  const shown = (v) => (v === null || v === undefined ? "" : String(v));
  /** "lab,lenses" -> ["lab", "lenses"] */
  const kindsOf = (supplier) => String(supplier.kinds ?? "").split(",").filter((k) => KIND_LABEL[k]);

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

  const state = { status: "loading", suppliers: [], error: "", query: "", kind: "all", showRetired: false, token: 0 };
  let root = null;
  let refs = null;

  async function load() {
    const token = ++state.token;
    state.status = "loading";
    render();
    try {
      const suppliers = await api.list();
      if (token !== state.token) return;
      state.suppliers = suppliers;
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
    return state.suppliers.filter((s) => {
      if (!state.showRetired && !s.isActive) return false;
      if (state.kind !== "all" && !kindsOf(s).includes(state.kind)) return false;
      const haystack = [s.name, s.contactName, s.phone, s.email, s.address, s.notes, ...kindsOf(s).map((k) => KIND_LABEL[k])].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }

  // ---- The page ------------------------------------------------------------------------------

  function build() {
    const searchInput = h("input", { class: "search__input", type: "search", placeholder: "Search by name, contact, phone or city", "aria-label": "Search suppliers", autocomplete: "off" });
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
    const retired = h("input", { type: "checkbox", id: "supplier-show-retired", "data-filter": "retired" });
    retired.checked = state.showRetired;
    retired.addEventListener("change", () => {
      state.showRetired = retired.checked;
      render();
    });
    refs = {
      count: h("p", { class: "toolbar__count" }),
      card: h("div", { class: "table-card" }),
      chips: h("div", { class: "chips", role: "group", "aria-label": "Show suppliers of a kind", "data-kind-filter": "" }),
    };
    return h(
      "section",
      { class: "page", "aria-labelledby": "suppliers-title", "data-suppliers-page": "" },
      h(
        "header",
        { class: "page__header" },
        h("div", null, h("h2", { class: "page__title", id: "suppliers-title" }, "Suppliers"), h("p", { class: "page__description" }, "Who you buy from: labs, frame and lens makers, accessories. What each supplies and how to reach it.")),
        h("button", { class: "btn btn--primary", type: "button", id: "add-supplier", onclick: () => openForm(null) }, icon("plus"), "Add supplier"),
      ),
      h("div", { class: "toolbar" }, h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() }, icon("search"), searchInput, clear), h("label", { class: "lens-filter" }, retired, "Show retired"), refs.count),
      refs.chips,
      refs.card,
    );
  }

  function renderChips() {
    refs.chips.replaceChildren(
      ...[["all", "All"], ...KINDS].map(([key, text]) => {
        const count = state.suppliers.filter((s) => (state.showRetired || s.isActive) && (key === "all" || kindsOf(s).includes(key))).length;
        return h("button", { class: "chip", type: "button", "data-kind": key, "aria-pressed": String(state.kind === key), onclick: () => { state.kind = key; render(); } }, text, h("span", { class: "chip__count" }, String(count)));
      }),
    );
  }

  function render() {
    if (!root) return;
    const suppliers = visible();
    const retiredCount = state.suppliers.filter((s) => !s.isActive).length;
    refs.count.textContent = state.status === "ready" ? `${suppliers.length} ${suppliers.length === 1 ? "supplier" : "suppliers"}${state.query.trim() ? " found" : ""}${!state.showRetired && retiredCount ? ` · ${retiredCount} retired hidden` : ""}` : "";
    renderChips();
    refs.card.replaceChildren();
    refs.card.dataset.status = state.status;
    if (state.status === "loading" && state.suppliers.length === 0) return refs.card.append(h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the suppliers…")));
    if (state.status === "error") {
      return refs.card.append(h("div", { class: "state state--error", role: "alert" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, "The suppliers couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
    }
    if (suppliers.length === 0) return refs.card.append(emptyState());
    refs.card.append(table(suppliers));
  }

  function emptyState() {
    const filtering = state.query.trim().length > 0 || state.kind !== "all";
    const onlyRetired = !filtering && state.suppliers.length > 0 && !state.showRetired;
    return h(
      "div",
      { class: "state", "data-state": "empty" },
      h("span", { class: "state__icon" }, icon(filtering ? "search" : "suppliers")),
      h("h3", { class: "state__title" }, filtering ? "No supplier matches" : onlyRetired ? "Every supplier is retired" : "No supplier yet"),
      h("p", { class: "state__text" }, filtering ? (state.query.trim() ? `Nothing found for “${state.query.trim()}”.` : "No supplier of this kind yet.") : onlyRetired ? "Tick “Show retired” to see them, or add a new one." : "Add the labs and makers you buy from, with a phone number so you always know who to call. Only the name is required."),
      h("button", { class: "btn btn--primary", type: "button", onclick: () => openForm(null) }, icon("plus"), "Add supplier"),
    );
  }

  function table(suppliers) {
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table lens-table supplier-table" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Supplier"), h("th", { scope: "col" }, "Supplies"), h("th", { scope: "col" }, "Contact"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col", class: "col-actions" }, h("span", { class: "visually-hidden" }, "Actions")))),
        h("tbody", null, suppliers.map(row)),
      ),
    );
  }

  function row(supplier) {
    const kinds = kindsOf(supplier);
    const contact = [supplier.phone && ["phone", supplier.phone], supplier.email && ["email", supplier.email], supplier.address && ["address", supplier.address]].filter(Boolean);
    const menuButton = h("button", { class: "row-menu-button", type: "button", "aria-label": `Actions for ${supplier.name}`, "aria-haspopup": "menu", "aria-expanded": "false", onclick: (event) => toggleRowMenu(event.currentTarget, supplier) }, icon("more"));
    return h(
      "tr",
      { "data-id": supplier.id, "data-active": String(supplier.isActive), class: supplier.isActive ? null : "lens-row--retired" },
      h("td", null, h("div", { class: "cell-name__stack" }, h("span", { class: "cell-name__text", "data-cell": "name" }, supplier.name), supplier.contactName ? h("span", { class: "cell-name__sub", "data-cell": "contact-name" }, supplier.contactName) : null, supplier.notes ? h("span", { class: "cell-name__sub supplier-notes", "data-cell": "notes" }, supplier.notes) : null)),
      h("td", { "data-cell": "kinds" }, kinds.length ? h("span", { class: "lens-extras" }, kinds.map((k) => h("span", { class: "lens-tag", "data-kind": k }, KIND_LABEL[k]))) : h("span", { class: "cell-empty" }, "—")),
      h("td", { "data-cell": "reach" }, contact.length ? h("div", { class: "supplier-reach" }, contact.map(([key, value]) => h("span", { "data-reach": key }, value))) : h("span", { class: "cell-empty" }, "—")),
      h("td", null, h("span", { class: `lens-status lens-status--${supplier.isActive ? "active" : "retired"}` }, supplier.isActive ? "Active" : "Retired")),
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

  function toggleRowMenu(button, supplier) {
    if (popupOwner === button) return closePopup(false);
    closePopup(false);
    popup.replaceChildren(
      h("button", { class: "popup__item", type: "button", role: "menuitem", "data-action": "edit", onclick: () => { closePopup(false); openForm(supplier); } }, icon("edit"), "Edit"),
      h("button", { class: "popup__item", type: "button", role: "menuitem", "data-action": "toggle", onclick: () => { closePopup(false); setActive(supplier, !supplier.isActive); } }, icon(supplier.isActive ? "eye" : "refresh"), supplier.isActive ? "Retire" : "Bring back"),
      h("button", { class: "popup__item popup__item--danger", type: "button", role: "menuitem", "data-action": "delete", onclick: () => { closePopup(false); openDelete(supplier); } }, icon("trash"), "Delete"),
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

  async function setActive(supplier, isActive) {
    try {
      await api.setActive(supplier.id, isActive);
      toast(isActive ? `${supplier.name} is back in your list.` : `${supplier.name} was retired. It stays in your records.`);
    } catch (error) {
      toast(errorText(error), "error");
    }
    await load();
  }

  // ---- Create / edit dialog ------------------------------------------------------------------

  const TEXT_FIELDS = ["name", "contactName", "phone", "email", "address", "notes"];

  function openForm(supplier) {
    const editing = supplier !== null;
    const inputs = {};
    const errorEls = {};

    const control = (name, props = {}) => {
      const id = `supplier-${name}`;
      const el = props.textarea ? h("textarea", { class: "input", id, name, rows: 3, "aria-describedby": `${id}-error` }) : h("input", { class: "input", id, name, type: props.type ?? "text", autocomplete: "off", inputmode: props.inputmode ?? false, placeholder: props.placeholder ?? false, "aria-describedby": `${id}-error` });
      inputs[name] = el;
      errorEls[name] = h("p", { class: "field__error", id: `${id}-error`, hidden: true });
      el.addEventListener("input", () => setFieldError(name, ""));
      return el;
    };
    const field = (name, text, props = {}) => {
      const el = control(name, props);
      return h("div", { class: `field${props.wide ? " field--wide" : ""}` }, h("label", { class: "field__label", for: `supplier-${name}` }, text, props.required ? h("span", { class: "field__required", "aria-hidden": "true" }, "*") : h("span", { class: "field__hint" }, "Optional")), el, errorEls[name]);
    };

    const start = supplier ?? {};
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const showBanner = (message) => {
      banner.querySelector("span").textContent = message;
      banner.hidden = !message;
    };

    const nameField = field("name", "Name", { required: true, wide: true, placeholder: "Essilor Algérie" });
    const contactField = field("contactName", "Contact person", { placeholder: "Who to ask for" });
    const phoneField = field("phone", "Phone", { inputmode: "tel", placeholder: "0550 12 34 56" });
    const emailField = field("email", "Email", { type: "email", placeholder: "contact@example.com" });
    const addressField = field("address", "Address", { wide: true, placeholder: "Street, city" });
    const notesField = field("notes", "Notes", { textarea: true, wide: true });

    errorEls.kinds = h("p", { class: "field__error", id: "supplier-kinds-error", hidden: true });
    const kindBoxes = {};
    const kindsRow = h("div", { class: "lens-checks", role: "group", "aria-label": "What they supply" }, KINDS.map(([key, text]) => {
      const box = h("input", { type: "checkbox", id: `supplier-kind-${key}`, name: `kind-${key}`, "data-kind-box": key });
      box.checked = kindsOf(start).includes(key);
      kindBoxes[key] = box;
      box.addEventListener("change", () => setFieldError("kinds", ""));
      return h("label", { class: "lens-check" }, box, text);
    }));
    const activeBox = h("input", { type: "checkbox", id: "supplier-isActive", name: "isActive" });
    activeBox.checked = editing ? start.isActive : true;

    const submit = h("button", { class: "btn btn--primary", type: "submit", "data-action": "save" }, editing ? "Save changes" : "Add supplier");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "supplier-dialog-title" }, editing ? "Edit supplier" : "Add supplier"), h("p", { class: "dialog__subtitle" }, editing ? `Update ${supplier.name}.` : "Only the name is required.")), close),
      h(
        "div",
        { class: "dialog__body" },
        banner,
        h("div", { class: "form-grid" }, nameField),
        h("h3", { class: "lens-section" }, "What they supply", h("span", { class: "field__hint" }, "Optional")),
        kindsRow,
        errorEls.kinds,
        h("h3", { class: "lens-section" }, "How to reach them"),
        h("div", { class: "form-grid" }, contactField, phoneField, emailField, addressField, notesField),
        editing ? h("label", { class: "lens-check" }, activeBox, "In use (untick to retire this supplier)") : null,
      ),
      h("div", { class: "dialog__footer" }, cancel, submit),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": "supplier-dialog-title", "data-supplier-form": editing ? supplier.id : "new" }, form);
    document.body.append(dialog);

    for (const n of TEXT_FIELDS) inputs[n].value = shown(start[n]);

    function setFieldError(name, message) {
      const box = errorEls[name];
      if (!box) return;
      box.textContent = message;
      box.hidden = !message;
      if (inputs[name]) {
        if (message) inputs[name].setAttribute("aria-invalid", "true");
        else inputs[name].removeAttribute("aria-invalid");
      }
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
      for (const n of [...TEXT_FIELDS, "kinds"]) setFieldError(n, "");
      const values = Object.fromEntries(TEXT_FIELDS.map((n) => [n, inputs[n].value.trim()]));
      values.kinds = KINDS.map(([key]) => key).filter((key) => kindBoxes[key].checked);
      if (editing) values.isActive = activeBox.checked;

      busy = true;
      submit.disabled = cancel.disabled = close.disabled = true;
      submit.replaceChildren(h("span", { class: "btn__spinner" }), editing ? "Saving…" : "Adding…");
      const reopen = () => {
        busy = false;
        submit.disabled = cancel.disabled = close.disabled = false;
        submit.replaceChildren(editing ? "Save changes" : "Add supplier");
      };
      try {
        const result = editing ? await api.edit(supplier.id, values) : await api.create(values);
        if (result.status === "invalid") {
          reopen();
          for (const [n, message] of Object.entries(result.errors)) setFieldError(n, message);
          const first = TEXT_FIELDS.find((n) => result.errors[n]);
          if (first) inputs[first].focus();
          else if (!result.errors.kinds) showBanner("Some values are not valid.");
          return;
        }
        busy = false;
        dialog.close();
        toast(result.status === "created" ? `${result.supplier.name} was added.` : `${result.supplier.name} was updated.`);
        await load();
      } catch (error) {
        reopen();
        if (kindOf(error) === "not-found") {
          dialog.close();
          toast("This supplier no longer exists.", "error");
          await load();
        } else showBanner(errorText(error));
      }
    });

    dialog.showModal();
    inputs.name.focus();
  }

  // ---- Delete --------------------------------------------------------------------------------

  function openDelete(supplier) {
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const confirm = h("button", { class: "btn btn--danger", type: "submit", "data-action": "confirm-delete" }, icon("trash"), "Delete supplier");
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "supplier-delete-title" }, "Delete this supplier?"), h("p", { class: "dialog__subtitle" }, supplier.name))),
      h("div", { class: "dialog__body" }, banner, h("p", null, "It is removed from this computer and from the server. It cannot be undone. To keep it in your records without using it, retire it instead.")),
      h("div", { class: "dialog__footer" }, cancel, confirm),
    );
    const dialog = h("dialog", { class: "dialog dialog--narrow", "aria-labelledby": "supplier-delete-title", "data-supplier-delete": supplier.id }, form);
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
        const result = await api.delete(supplier.id);
        busy = false;
        dialog.close();
        toast(result.sentToServer ? `${supplier.name} was deleted.` : `${supplier.name} was deleted from this computer. The server will be told when it can be reached.`);
        await load();
      } catch (error) {
        busy = false;
        confirm.disabled = cancel.disabled = false;
        if (kindOf(error) === "not-found") {
          dialog.close();
          toast("This supplier was already deleted.", "error");
          await load();
          return;
        }
        banner.querySelector("span").textContent = errorText(error);
        banner.hidden = false;
      }
    });
    dialog.showModal();
    cancel.focus();
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const here = location.hash.slice(1) === "suppliers";
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
      state.kind = "all";
      state.showRetired = false;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
