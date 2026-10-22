// The Customers page: list, search, create, edit and delete.
// All data goes through window.electronAPI.customers (the same local-first service the rest of the
// app uses: it saves locally and syncs on its own), so no business rule is repeated here. The
// checks below only catch typing mistakes before a round trip; the service stays the authority and
// its errors ("[kind] message") are shown next to the field or in the dialog.
(() => {
  "use strict";

  const api = window.electronAPI.customers;
  const PAGE_SIZE = 25;
  const SEARCH_DELAY_MS = 200;

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

  /** "[kind] message" (see preload.ts) -> { kind, message }. */
  function parseError(error) {
    const text = String(error?.message ?? error);
    const match = /^\[([\w-]+)\]\s*(.*)$/s.exec(text);
    return { kind: match?.[1] ?? null, message: match?.[2] ?? text };
  }

  const dateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "");

  function initials(name) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
  }

  // ---- Toasts --------------------------------------------------------------------------------

  const toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
  document.body.append(toasts);

  function toast(message, kind = "success") {
    const el = h("div", { class: `toast toast--${kind}` }, icon(kind === "error" ? "alert" : "check"), h("span", null, message));
    toasts.append(el);
    setTimeout(() => el.remove(), kind === "error" ? 7000 : 4000);
  }

  // ---- State ---------------------------------------------------------------------------------

  const state = { status: "loading", error: "", customers: [], query: "", page: 1, token: 0 };
  let root = null; // the list page element while it is on screen
  let view = null; // "list", "details", or null when another page is showing
  let detailsFor = null; // the customer the details view shows
  let refs = {};

  async function load() {
    const token = ++state.token; // only the newest request may update the screen
    state.status = "loading";
    render();
    try {
      const query = state.query.trim();
      const customers = query ? await api.search(query) : await api.list();
      if (token !== state.token) return;
      state.customers = customers;
      state.status = "ready";
      state.page = Math.min(state.page, Math.max(1, Math.ceil(customers.length / PAGE_SIZE)));
    } catch (error) {
      if (token !== state.token) return;
      state.status = "error";
      state.error = parseError(error).message;
    }
    render();
  }

  // ---- Page ----------------------------------------------------------------------------------

  function build() {
    const searchInput = h("input", {
      class: "search__input",
      type: "search",
      placeholder: "Search by name, phone or email",
      "aria-label": "Search customers",
      autocomplete: "off",
    });
    const clear = h("button", { class: "search__clear", type: "button", "aria-label": "Clear search", hidden: true }, icon("x"));
    let timer;
    searchInput.addEventListener("input", () => {
      clear.hidden = !searchInput.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = searchInput.value;
        state.page = 1;
        load();
      }, SEARCH_DELAY_MS);
    });
    clear.addEventListener("click", () => {
      searchInput.value = "";
      clear.hidden = true;
      state.query = "";
      state.page = 1;
      searchInput.focus();
      load();
    });

    refs = { searchInput, count: h("p", { class: "toolbar__count" }), card: h("div", { class: "table-card" }) };

    return h(
      "section",
      { class: "page", "aria-labelledby": "customers-title" },
      h(
        "header",
        { class: "page__header" },
        h("div", null, h("h2", { class: "page__title", id: "customers-title" }, "Customers"), h("p", { class: "page__description" }, "Manage your customer records.")),
        h("button", { class: "btn btn--primary", type: "button", onclick: () => openForm(null) }, icon("plus"), "Add Customer"),
      ),
      h(
        "div",
        { class: "toolbar" },
        h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() }, icon("search"), searchInput, clear),
        refs.count,
      ),
      refs.card,
    );
  }

  function render() {
    if (!root) return;
    const { status, customers, query } = state;
    refs.count.textContent = status === "ready" ? `${customers.length} ${customers.length === 1 ? "customer" : "customers"}${query.trim() ? " found" : ""}` : "";
    refs.card.replaceChildren();
    if (status === "loading" && state.customers.length === 0) return refs.card.append(skeleton());
    if (status === "error") return refs.card.append(errorState());
    if (customers.length === 0) return refs.card.append(emptyState());
    refs.card.append(table(), pagination());
    if (status === "loading") refs.card.setAttribute("aria-busy", "true");
    else refs.card.removeAttribute("aria-busy");
  }

  const COLUMNS = [
    ["Name", ""],
    ["Phone", ""],
    ["Email", ""],
    ["Address", "col-address"],
    ["Date of birth", "col-dob"],
    ["Registered", "col-registered"],
  ];

  function table() {
    const start = (state.page - 1) * PAGE_SIZE;
    const rows = state.customers.slice(start, start + PAGE_SIZE);
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table" },
        h("thead", null, h("tr", null, COLUMNS.map(([label, cls]) => h("th", { scope: "col", class: cls }, label)), h("th", { scope: "col", class: "col-actions" }, h("span", { class: "visually-hidden" }, "Actions")))),
        h("tbody", null, rows.map(row)),
      ),
    );
  }

  function row(customer) {
    const text = (value, cls = "cell-secondary") => (value ? h("span", { class: `${cls} cell-truncate`, title: value }, value) : h("span", { class: "cell-empty" }, "—"));
    const menuButton = h(
      "button",
      {
        class: "row-menu-button",
        type: "button",
        "aria-label": `Actions for ${customer.name}`,
        "aria-haspopup": "menu",
        "aria-expanded": "false",
        onclick: (event) => toggleRowMenu(event.currentTarget, customer),
      },
      icon("more"),
    );
    return h(
      "tr",
      null,
      h("td", null, h("div", { class: "cell-name" }, h("span", { class: "avatar-initials", "aria-hidden": "true" }, initials(customer.name)), h("span", { class: "cell-name__stack" }, h("span", { class: "cell-name__text" }, customer.name), h("span", { class: "cell-name__sub", title: customer.address ?? "" }, customer.address ?? "")))),
      h("td", { class: "cell-number" }, customer.phone ? customer.phone : h("span", { class: "cell-empty" }, "—")),
      h("td", null, text(customer.email)),
      h("td", { class: "col-address" }, text(customer.address)),
      h("td", { class: "cell-number col-dob" }, customer.dateOfBirth ? formatDate(customer.dateOfBirth) : h("span", { class: "cell-empty" }, "—")),
      h("td", { class: "cell-number cell-secondary col-registered" }, formatDate(customer.createdAt)),
      h("td", { class: "col-actions" }, menuButton),
    );
  }

  function pagination() {
    const total = state.customers.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    const from = (state.page - 1) * PAGE_SIZE + 1;
    const to = Math.min(total, state.page * PAGE_SIZE);
    const go = (page) => {
      state.page = page;
      render();
      document.getElementById("content").scrollTo({ top: 0 });
    };
    return h(
      "div",
      { class: "pagination", hidden: pages <= 1 },
      h("span", null, `Showing ${from}–${to} of ${total}`),
      h(
        "div",
        { class: "pagination__buttons" },
        h("button", { class: "btn btn--secondary", type: "button", disabled: state.page <= 1, onclick: () => go(state.page - 1) }, icon("prev"), "Previous"),
        h("span", null, `Page ${state.page} of ${pages}`),
        h("button", { class: "btn btn--secondary", type: "button", disabled: state.page >= pages, onclick: () => go(state.page + 1) }, "Next", icon("next")),
      ),
    );
  }

  function skeleton() {
    const cell = () => h("td", null, h("span", { class: "skeleton" }));
    return h(
      "div",
      { class: "table-scroll", "aria-busy": "true", "aria-label": "Loading customers" },
      h(
        "table",
        { class: "table" },
        h("thead", null, h("tr", null, COLUMNS.map(([label, cls]) => h("th", { class: cls }, label)), h("th", { class: "col-actions" }))),
        h("tbody", null, Array.from({ length: 6 }, () => h("tr", null, COLUMNS.map(([, cls]) => h("td", { class: cls }, h("span", { class: "skeleton" }))), cell()))),
      ),
    );
  }

  function emptyState() {
    const searching = state.query.trim().length > 0;
    return h(
      "div",
      { class: "state" },
      h("span", { class: "state__icon" }, icon(searching ? "search" : "customers")),
      h("h3", { class: "state__title" }, searching ? "No customers match your search" : "No customers yet"),
      h("p", { class: "state__text" }, searching ? `Nothing found for “${state.query.trim()}”. Check the spelling or try a phone number or email.` : "Add your first customer to start building prescriptions and orders."),
      searching
        ? h("button", { class: "btn btn--secondary", type: "button", onclick: () => refs.card.parentElement.querySelector(".search__clear").click() }, "Clear search")
        : h("button", { class: "btn btn--primary", type: "button", onclick: () => openForm(null) }, icon("plus"), "Add Customer"),
    );
  }

  function errorState() {
    return h(
      "div",
      { class: "state state--error", role: "alert" },
      h("span", { class: "state__icon" }, icon("alert")),
      h("h3", { class: "state__title" }, "Customers couldn't be loaded"),
      h("p", { class: "state__text" }, state.error),
      h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again"),
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

  function toggleRowMenu(button, customer) {
    if (popupOwner === button) return closePopup(false);
    closePopup(false);
    popup.replaceChildren(
      h("button", { class: "popup__item", type: "button", role: "menuitem", onclick: () => { closePopup(false); location.hash = `customers/${encodeURIComponent(customer.id)}`; } }, icon("eye"), "Details"),
      h("button", { class: "popup__item", type: "button", role: "menuitem", onclick: () => { closePopup(false); openForm(customer); } }, icon("edit"), "Edit"),
      h("button", { class: "popup__item popup__item--danger", type: "button", role: "menuitem", onclick: () => { closePopup(false); openDelete(customer); } }, icon("trash"), "Delete"),
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

  // ---- Create / edit dialog ------------------------------------------------------------------

  const FIELDS = [
    { name: "name", label: "Full name", required: true, autocomplete: "off", wide: true },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "dateOfBirth", label: "Date of birth", type: "date" },
    { name: "address", label: "Address", wide: true },
    { name: "notes", label: "Notes", textarea: true, wide: true },
  ];

  const toInputDate = (iso) => (iso ? iso.slice(0, 10) : "");
  const todayInput = () => new Date().toISOString().slice(0, 10);

  /** Typing checks only; whatever the service rejects is shown from its own message. */
  function validate(values) {
    const errors = {};
    if (!values.name) errors.name = "Enter the customer's name.";
    if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) errors.email = "Enter a valid email address, like name@example.com.";
    if (values.dateOfBirth && values.dateOfBirth > todayInput()) errors.dateOfBirth = "The date of birth can't be in the future.";
    return errors;
  }

  function openForm(customer) {
    const editing = customer !== null;
    const inputs = {};
    const errorEls = {};

    const fieldEls = FIELDS.map((f) => {
      const id = `customer-${f.name}`;
      const control = f.textarea
        ? h("textarea", { class: "input", id, name: f.name, rows: 3, "aria-describedby": `${id}-error` })
        : h("input", { class: "input", id, name: f.name, type: f.type ?? "text", autocomplete: f.autocomplete ?? "off", max: f.type === "date" ? todayInput() : false, "aria-describedby": `${id}-error` });
      control.value = f.name === "dateOfBirth" ? toInputDate(customer?.dateOfBirth) : (customer?.[f.name] ?? "");
      if (f.required) control.setAttribute("required", "");
      inputs[f.name] = control;
      errorEls[f.name] = h("p", { class: "field__error", id: `${id}-error`, hidden: true });
      control.addEventListener("input", () => setFieldError(f.name, ""));
      return h(
        "div",
        { class: `field${f.wide ? " field--wide" : ""}` },
        h("label", { class: "field__label", for: id }, f.label, f.required ? h("span", { class: "field__required", "aria-hidden": "true" }, "*") : h("span", { class: "field__hint" }, "Optional")),
        control,
        errorEls[f.name],
      );
    });

    function setFieldError(name, message) {
      errorEls[name].textContent = message;
      errorEls[name].hidden = !message;
      if (message) inputs[name].setAttribute("aria-invalid", "true");
      else inputs[name].removeAttribute("aria-invalid");
    }

    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const showBanner = (message) => {
      banner.querySelector("span").textContent = message;
      banner.hidden = !message;
    };

    const submit = h("button", { class: "btn btn--primary", type: "submit" }, editing ? "Save changes" : "Add customer");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h(
        "div",
        { class: "dialog__header" },
        h("div", null, h("h2", { class: "dialog__title", id: "customer-dialog-title" }, editing ? "Edit customer" : "Add customer"), h("p", { class: "dialog__subtitle" }, editing ? `Update the record for ${customer.name}.` : "Fields marked * are required.")),
        close,
      ),
      h("div", { class: "dialog__body" }, banner, h("div", { class: "form-grid" }, fieldEls)),
      h("div", { class: "dialog__footer" }, cancel, submit),
    );
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "customer-dialog-title" }, form);
    document.body.append(dialog);

    let busy = false;
    const dismiss = () => {
      if (busy) return;
      dialog.close();
    };
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return; // a second click or Enter while saving does nothing
      showBanner("");
      const values = Object.fromEntries(FIELDS.map((f) => [f.name, inputs[f.name].value.trim()]));
      const errors = validate(values);
      for (const f of FIELDS) setFieldError(f.name, errors[f.name] ?? "");
      const first = FIELDS.find((f) => errors[f.name]);
      if (first) return inputs[first.name].focus(); // typed values stay as they are

      const data = {
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        address: values.address || null,
        notes: values.notes || null,
        dateOfBirth: values.dateOfBirth ? `${values.dateOfBirth}T00:00:00.000Z` : null,
      };

      busy = true;
      submit.disabled = cancel.disabled = close.disabled = true;
      submit.replaceChildren(h("span", { class: "btn__spinner" }), editing ? "Saving…" : "Adding…");
      try {
        const saved = editing ? await api.update(customer.id, data) : await api.insert(data);
        busy = false;
        dialog.close();
        toast(editing ? `${saved.name} was updated.` : `${saved.name} was added.`);
        await load();
      } catch (error) {
        busy = false;
        submit.disabled = cancel.disabled = close.disabled = false;
        submit.replaceChildren(editing ? "Save changes" : "Add customer");
        const { kind, message } = parseError(error);
        if (kind === "not-found") {
          dialog.close();
          toast("This customer no longer exists.", "error");
          await load();
        } else if (/dateOfBirth/.test(message)) {
          setFieldError("dateOfBirth", "That date isn't valid.");
          inputs.dateOfBirth.focus();
        } else {
          showBanner(message);
        }
      }
    });

    dialog.showModal();
    inputs.name.focus();
  }

  // ---- Delete confirmation -------------------------------------------------------------------

  function openDelete(customer) {
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const remove = h("button", { class: "btn btn--danger", type: "button" }, "Delete");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const contact = [customer.phone, customer.email].filter(Boolean).join(" · ");

    const dialog = h(
      "dialog",
      { class: "dialog dialog--narrow", "aria-labelledby": "delete-dialog-title", "aria-describedby": "delete-dialog-text" },
      h(
        "div",
        { class: "dialog__form" },
        h("div", { class: "dialog__header" }, h("h2", { class: "dialog__title", id: "delete-dialog-title" }, "Delete this customer?")),
        h(
          "div",
          { class: "dialog__body", id: "delete-dialog-text" },
          h("p", null, h("strong", null, customer.name), contact ? ` (${contact})` : ""),
          h("p", null, "This removes the customer, here and on the server. Only a customer with no prescriptions, orders, payments or invoices can be deleted. It cannot be undone."),
          banner,
        ),
        h("div", { class: "dialog__footer" }, cancel, remove),
      ),
    );
    document.body.append(dialog);

    let busy = false;
    cancel.addEventListener("click", () => !busy && dialog.close());
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());

    remove.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      banner.hidden = true;
      remove.disabled = cancel.disabled = true;
      remove.replaceChildren(h("span", { class: "btn__spinner" }), "Deleting…");
      try {
        const result = await api.delete(customer.id);
        busy = false;
        dialog.close();
        toast(result.sentToServer ? `${customer.name} was deleted.` : `${customer.name} was deleted from this computer. The server will be told when it can be reached.`);
        await load();
      } catch (error) {
        busy = false;
        remove.disabled = cancel.disabled = false;
        remove.replaceChildren("Delete");
        const { kind, message } = parseError(error);
        if (kind === "not-found") {
          dialog.close();
          toast("This customer was already deleted.", "error");
          await load();
          return;
        }
        banner.querySelector("span").textContent = message; // the service says why (for example: an order uses one of their prescriptions)
        banner.hidden = false;
      }
    });

    dialog.showModal();
    cancel.focus();
  }

  // ---- Mounting ------------------------------------------------------------------------------
  // The page lives in the shell's content area while the URL hash is #customers.

  // ---- Details view: the customer, and their prescriptions ------------------------------------

  function buildDetails(customerId) {
    const body = h("div", { class: "customer-details" }, h("p", { class: "rx__loading" }, "Loading the customer…"));
    const section = h(
      "section",
      { class: "page", "aria-label": "Customer details" },
      h("button", { class: "back-button", type: "button", "aria-label": "Back to customers", onclick: () => (location.hash = "customers") }, icon("arrow-left")),
      body,
    );
    (async () => {
      try {
        const customer = await api.get(customerId);
        if (!body.isConnected) return; // the person left the page meanwhile
        if (!customer) {
          body.replaceChildren(h("div", { class: "state panel-state" }, h("h4", { class: "state__title" }, "This customer no longer exists"), h("button", { class: "btn btn--secondary", type: "button", onclick: () => (location.hash = "customers") }, "Back to customers")));
          return;
        }
        const contact = [customer.phone, customer.email].filter(Boolean).join(" · ");
        body.replaceChildren(
          h("div", { class: "customer-head" }, h("span", { class: "avatar-initials", "aria-hidden": "true" }, initials(customer.name)), h("div", null, h("h2", { class: "customer-head__name" }, customer.name), contact ? h("p", { class: "customer-head__contact" }, contact) : null)),
        );
        window.mountCustomerInfo(body, customer);
        window.mountCustomerSummary(body, customer);
        // The Orders tab opens first; the Prescriptions tab is the existing section, mounted the first time it opens.
        let rx = null;
        let orders = null;
        const tabs = window.mountCustomerTabs(body, [
          // A placed order shows in the Orders tab at once, and the prescription it used is now "used" in the Prescriptions tab.
          { id: "orders", label: "Orders", mount: (panel) => (orders = window.mountCustomerOrders(panel, customer, { showPrescriptions: (id) => showPrescription(id), onPrescriptionChosen: () => rx?.reload(), onNewOrder: () => window.openNewOrderForm(customer, { onPlaced: () => { orders?.reload(); rx?.reload(); } }) })) },
          { id: "prescriptions", label: "Prescriptions", mount: (panel) => (rx = window.mountPrescriptions(panel, customer)) },
        ]);
        const showPrescription = (id) => {
          tabs.select("prescriptions", true);
          setTimeout(() => body.querySelector(`.rx-card[data-id="${id}"]`)?.scrollIntoView({ block: "center" }), 150); // the cards load asynchronously
        };
      } catch (error) {
        if (body.isConnected) body.replaceChildren(h("div", { class: "state panel-state state--error" }, h("h4", { class: "state__title" }, "The customer couldn't be loaded"), h("p", { class: "state__text" }, parseError(error).message)));
      }
    })();
    return section;
  }

  function route() {
    const content = document.getElementById("content");
    const [page, detailsId] = location.hash.slice(1).split("/");
    const wanted = page !== "customers" ? null : detailsId ? "details" : "list";
    if (wanted === view && (wanted !== "details" || detailsId === detailsFor)) return; // a link to another customer's details rebuilds the view
    closePopup(false);
    root?.remove();
    if (view === "details") content.replaceChildren();
    root = null;
    state.token++; // drop any request still in flight
    view = wanted;
    detailsFor = wanted === "details" ? detailsId : null;
    if (wanted === "list") {
      root = build();
      content.replaceChildren(root);
      load();
    } else if (wanted === "details") {
      content.replaceChildren(buildDetails(decodeURIComponent(detailsId)));
      content.querySelector(".back-button").focus();
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
