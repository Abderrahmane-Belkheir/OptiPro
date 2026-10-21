// The prescriptions of one customer, shown on the customer's details page: the history (newest first), the form for a new
// prescription, correcting one, and deleting one. Used by pages/customers.js:
//   window.mountPrescriptions(container, customer)
// All data goes through window.electronAPI.prescriptions (listForCustomer / create / edit / delete): the service validates and enforces
// the rules (a prescription an order uses cannot be changed or deleted); the checks here only show what the service answers.
(() => {
  "use strict";

  const api = window.electronAPI.prescriptions;

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

  function toast(message) {
    let box = document.querySelector(".toasts");
    if (!box) {
      box = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.append(box);
    }
    const el = h("div", { class: "toast toast--success" }, icon("check"), h("span", null, message));
    box.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  const dayFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  const formatDay = (iso) => dayFormat.format(new Date(iso));
  const today = () => new Date().toISOString().slice(0, 10);

  // ---- How the values are written -------------------------------------------------------------

  /** Sphere, cylinder and add: always two decimals and a sign for the plus ("+2.00", "-1.25", "0.00"). */
  const diopter = (v) => (v === null || v === undefined ? "" : `${v > 0 ? "+" : ""}${v.toFixed(2)}`);
  const axis = (v) => (v === null || v === undefined ? "" : `${v}°`);
  const mm = (v) => (v === null || v === undefined ? "" : `${Number.isInteger(v) ? v : v.toFixed(1)}`);

  /** The columns of the eye table: field suffix, title, how to write it. */
  const COLUMNS = [
    ["Sphere", "Sphere", diopter],
    ["Cylinder", "Cylinder", diopter],
    ["Axis", "Axis", axis],
    ["Add", "Add", diopter],
  ];
  const WRITE = { Sphere: diopter, Cylinder: diopter, Axis: axis, Add: diopter };

  // ---- The section ----------------------------------------------------------------------------

  function mount(container, customer) {
    const state = { status: "loading", entries: [], error: "", token: 0 };
    const list = h("div", { class: "rx-list", "aria-live": "polite" });
    const newButton = h("button", { class: "btn btn--primary", type: "button", id: "new-prescription", onclick: () => openForm(null) }, icon("plus"), "New prescription");
    const section = h(
      "section",
      { class: "rx", "aria-labelledby": "rx-title" },
      h("div", { class: "rx__header" }, h("div", null, h("h3", { class: "rx__title", id: "rx-title" }, "Prescriptions"), h("p", { class: "rx__hint" }, "Newest first. A new exam is a new prescription; one an order uses is kept exactly as it was ordered.")), newButton),
      list,
    );
    container.append(section);

    async function load() {
      const token = ++state.token;
      state.status = "loading";
      render();
      try {
        const entries = await api.listForCustomer(customer.id);
        if (token !== state.token) return;
        state.entries = entries;
        state.status = "ready";
      } catch (error) {
        if (token !== state.token) return;
        state.status = "error";
        state.error = errorText(error);
      }
      render();
    }

    function render() {
      list.replaceChildren();
      list.dataset.status = state.status;
      if (state.status === "loading") return list.append(h("p", { class: "rx__loading" }, "Loading the prescriptions…"));
      if (state.status === "error") {
        return list.append(h("div", { class: "state panel-state", "data-state": "error" }, h("h4", { class: "state__title" }, "The prescriptions couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
      }
      if (state.entries.length === 0) {
        return list.append(h("div", { class: "state panel-state", "data-state": "empty" }, h("h4", { class: "state__title" }, "No prescription yet"), h("p", { class: "state__text" }, `${customer.name} has no prescription on file.`), h("button", { class: "btn btn--primary", type: "button", onclick: () => openForm(null) }, icon("plus"), "New prescription")));
      }
      if (state.entries.length > 1) list.append(h("p", { class: "rx__legend" }, h("span", { class: "rx-changed" }, "Highlighted"), " values changed since the previous prescription."));
      state.entries.forEach((entry, index) => list.append(card(entry, state.entries[index + 1] ?? null)));
    }

    // ---- One prescription ----
    function card(entry, older) {
      const changed = (key) => older !== null && (entry[key] ?? null) !== (older[key] ?? null);
      const cell = (key, write) => {
        const value = entry[key] ?? null;
        const el = h("td", { class: `rx-cell${value === null ? " rx-cell--empty" : ""}${changed(key) ? " rx-changed" : ""}`, "data-field": key }, value === null ? "—" : write(value));
        if (changed(key)) el.title = `Was ${older[key] === null ? "empty" : write(older[key])}`;
        return el;
      };
      const eyeRow = (side, label) =>
        h("tr", null, h("th", { scope: "row" }, label), COLUMNS.map(([suffix]) => cell(`${side}${suffix}`, WRITE[suffix])));
      const pd = entry.pd === null ? null : `${mm(entry.pd)} mm${entry.pdRight !== null && entry.pdLeft !== null ? ` (${mm(entry.pdRight)} + ${mm(entry.pdLeft)})` : ""}`;
      const fitting = entry.fittingHeightRight !== null || entry.fittingHeightLeft !== null ? `${entry.fittingHeightRight === null ? "—" : mm(entry.fittingHeightRight)} · ${entry.fittingHeightLeft === null ? "—" : mm(entry.fittingHeightLeft)} mm` : null;
      const meta = [
        pd !== null ? h("div", { class: `rx-meta__item${changed("pd") ? " rx-changed" : ""}`, title: changed("pd") ? `Was ${older.pd === null ? "empty" : `${mm(older.pd)} mm`}` : null }, h("span", { class: "rx-meta__key" }, "PD"), pd) : null,
        fitting !== null ? h("div", { class: "rx-meta__item" }, h("span", { class: "rx-meta__key" }, "Fitting height R · L"), fitting) : null,
        entry.prescriberName ? h("div", { class: "rx-meta__item" }, h("span", { class: "rx-meta__key" }, "Prescriber"), entry.prescriberName) : null,
      ].filter(Boolean);
      const used = entry.usedByOrders > 0;
      return h(
        "article",
        { class: `rx-card${entry.current ? " rx-card--current" : ""}`, "data-id": entry.id, "data-current": String(entry.current), "data-editable": String(entry.editable) },
        h(
          "header",
          { class: "rx-card__header" },
          h("div", { class: "rx-card__title" }, h("span", { class: "rx-card__date" }, formatDay(entry.prescribedAt)), entry.current ? h("span", { class: "rx-badge" }, "Current") : null, used ? h("span", { class: "rx-badge rx-badge--used", title: "An order uses this prescription, so it cannot be changed or deleted" }, `Used in ${entry.usedByOrders} ${entry.usedByOrders === 1 ? "order" : "orders"}`) : null),
          entry.editable
            ? h("div", { class: "rx-card__actions" }, h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-action": "edit", onclick: () => openForm(entry) }, icon("edit"), "Edit"), h("button", { class: "btn btn--secondary btn--sm btn--danger-text", type: "button", "data-action": "delete", onclick: () => openDelete(entry) }, icon("trash"), "Delete"))
            : h("p", { class: "rx-card__locked" }, "Kept as ordered"),
        ),
        h("table", { class: "rx-table" }, h("thead", null, h("tr", null, h("th", null, ""), COLUMNS.map(([, title]) => h("th", { scope: "col" }, title)))), h("tbody", null, eyeRow("right", "Right"), eyeRow("left", "Left"))),
        meta.length ? h("div", { class: "rx-meta" }, meta) : null,
        entry.notes ? h("p", { class: "rx-notes" }, entry.notes) : null,
      );
    }

    // ---- The form (new, or correcting one) ----
    const FIELDS = ["prescribedAt", "prescriberName", "rightSphere", "rightCylinder", "rightAxis", "rightAdd", "leftSphere", "leftCylinder", "leftAxis", "leftAdd", "pd", "pdRight", "pdLeft", "fittingHeightRight", "fittingHeightLeft", "notes"];
    const NUMERIC = FIELDS.filter((f) => !["prescribedAt", "prescriberName", "notes"].includes(f));
    const LABELS = { rightSphere: "Right sphere", rightCylinder: "Right cylinder", rightAxis: "Right axis", rightAdd: "Right add", leftSphere: "Left sphere", leftCylinder: "Left cylinder", leftAxis: "Left axis", leftAdd: "Left add", pd: "PD", pdRight: "Right PD", pdLeft: "Left PD", fittingHeightRight: "Right fitting height", fittingHeightLeft: "Left fitting height" };

    function openForm(entry) {
      const editing = entry !== null;
      const title = editing ? "Edit prescription" : "New prescription";
      const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
      const input = (name, attrs = {}) => h("input", { class: "input", name, id: `rx-${name}`, type: "text", autocomplete: "off", ...attrs });
      const errorLine = (key) => h("p", { class: "field__error", "data-error-for": key, hidden: true });
      const numeric = (name, placeholder) => input(name, { inputmode: "decimal", placeholder, "aria-label": LABELS[name] });

      const eyeInput = (side, suffix, placeholder) => h("td", null, numeric(`${side}${suffix}`, placeholder));
      const gridErrors = h("div", { class: "rx-form__errors" }, ["rightSphere", "rightCylinder", "rightAxis", "rightAdd", "leftSphere", "leftCylinder", "leftAxis", "leftAdd"].map(errorLine));
      const grid = h(
        "table",
        { class: "rx-form__grid" },
        h("thead", null, h("tr", null, h("th", null, ""), COLUMNS.map(([, t]) => h("th", { scope: "col" }, t)))),
        h(
          "tbody",
          null,
          h("tr", null, h("th", { scope: "row" }, "Right"), eyeInput("right", "Sphere", "0.00"), eyeInput("right", "Cylinder", "0.00"), eyeInput("right", "Axis", "0"), eyeInput("right", "Add", "0.00")),
          h("tr", null, h("th", { scope: "row" }, "Left"), eyeInput("left", "Sphere", "0.00"), eyeInput("left", "Cylinder", "0.00"), eyeInput("left", "Axis", "0"), eyeInput("left", "Add", "0.00")),
        ),
      );
      const field = (label, control, key, { wide = false, hint = "" } = {}) =>
        h("div", { class: `field${wide ? " field--wide" : ""}` }, h("label", { class: "field__label", for: control.id }, label, hint ? h("span", { class: "field__hint" }, hint) : null), control, errorLine(key));

      const fill = (source) => {
        for (const name of FIELDS) {
          const el = form.querySelector(`[name="${name}"]`);
          if (!el || source[name] === null || source[name] === undefined) continue;
          el.value = name === "prescribedAt" ? String(source[name]).slice(0, 10) : String(source[name]);
        }
      };
      const current = state.entries[0] ?? null;
      const copy = !editing && current ? h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-action": "copy-current", onclick: () => { fill({ ...current, prescribedAt: today(), notes: null }); } }, icon("refresh"), "Fill from the current prescription") : null;

      const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
      const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
      const save = h("button", { class: "btn btn--primary", type: "submit", "data-action": "save" }, editing ? "Save changes" : "Save prescription");
      const form = h(
        "form",
        { class: "dialog__form", novalidate: true },
        h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "rx-dialog-title" }, title), h("p", { class: "dialog__subtitle" }, customer.name)), close),
        h(
          "div",
          { class: "dialog__body rx-form" },
          banner,
          h("div", { class: "rx-form__top" }, field("Date of the prescription", input("prescribedAt", { type: "date", max: today(), required: true }), "prescribedAt"), field("Prescriber", input("prescriberName", { placeholder: "Doctor's name", maxlength: "120" }), "prescriberName", { hint: "optional" }), copy),
          h("div", { class: "rx-form__section" }, h("h4", { class: "rx-form__heading" }, "Glasses"), grid, gridErrors),
          h(
            "div",
            { class: "rx-form__section" },
            h("h4", { class: "rx-form__heading" }, "Measurements (mm)"),
            h(
              "div",
              { class: "rx-form__pd" },
              field("PD", numeric("pd", "63"), "pd", { hint: "both eyes" }),
              field("Right PD", numeric("pdRight", "31.5"), "pdRight", { hint: "optional" }),
              field("Left PD", numeric("pdLeft", "31.5"), "pdLeft", { hint: "optional" }),
              field("Right fitting height", numeric("fittingHeightRight", "18"), "fittingHeightRight", { hint: "optional" }),
              field("Left fitting height", numeric("fittingHeightLeft", "18"), "fittingHeightLeft", { hint: "optional" }),
            ),
          ),
          field("Notes", h("textarea", { class: "input", name: "notes", id: "rx-notes", rows: "2", maxlength: "2000", placeholder: "Anything worth remembering" }), "notes", { wide: true }),
        ),
        h("div", { class: "dialog__footer" }, cancel, save),
      );
      const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": "rx-dialog-title", "data-prescription-form": editing ? "edit" : "new" }, form);
      document.body.append(dialog);

      // starting values
      if (editing) fill(entry);
      else form.querySelector('[name="prescribedAt"]').value = today();

      let busy = false;
      const lock = (on) => {
        busy = on;
        for (const el of dialog.querySelectorAll("button, input, textarea")) el.disabled = on;
      };
      const dismiss = () => {
        if (!busy) dialog.close();
      };
      cancel.addEventListener("click", dismiss);
      close.addEventListener("click", dismiss);
      dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
      dialog.addEventListener("close", () => dialog.remove());

      const clearErrors = () => {
        banner.hidden = true;
        for (const el of dialog.querySelectorAll("[data-error-for]")) {
          el.hidden = true;
          el.textContent = "";
        }
        for (const el of dialog.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
      };
      form.addEventListener("input", (event) => {
        const name = event.target?.name;
        if (!name) return;
        event.target.removeAttribute("aria-invalid");
        const line = dialog.querySelector(`[data-error-for="${name}"]`);
        if (line) line.hidden = true;
      });
      const showErrors = (errors) => {
        let first = null;
        const general = [];
        for (const [key, message] of Object.entries(errors)) {
          const line = dialog.querySelector(`[data-error-for="${key}"]`);
          const control = dialog.querySelector(`[name="${key}"]`);
          if (line) {
            line.textContent = message;
            line.hidden = false;
            if (control) {
              control.setAttribute("aria-invalid", "true");
              first ??= control;
            }
          } else general.push(message);
        }
        if (general.length) {
          banner.querySelector("span").textContent = general.join(" ");
          banner.hidden = false;
        }
        first?.focus();
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy) return;
        clearErrors();
        const values = Object.fromEntries(FIELDS.map((name) => [name, form.querySelector(`[name="${name}"]`).value]));
        lock(true);
        save.replaceChildren(h("span", { class: "btn__spinner" }), "Saving…");
        const unlock = () => {
          lock(false);
          save.replaceChildren(editing ? "Save changes" : "Save prescription");
        };
        try {
          const result = editing ? await api.edit(entry.id, values) : await api.create({ ...values, customerId: customer.id });
          if (result.status === "invalid") {
            unlock();
            return showErrors(result.errors);
          }
          busy = false;
          dialog.close();
          toast(result.sentToServer ? `The prescription was ${editing ? "updated" : "saved"}.` : `The prescription was ${editing ? "updated" : "saved"} on this computer. The server will get it when it can be reached.`);
          await load();
        } catch (error) {
          unlock();
          banner.querySelector("span").textContent = errorText(error); // for example: an order started using it meanwhile
          banner.hidden = false;
        }
      });

      dialog.showModal();
      form.querySelector(editing ? '[name="rightSphere"]' : '[name="prescribedAt"]').focus();
    }

    // ---- Delete one that no order uses ----
    function openDelete(entry) {
      const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
      const confirm = h("button", { class: "btn btn--danger", type: "submit", "data-action": "confirm-delete" }, icon("trash"), "Delete prescription");
      const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
      const form = h(
        "form",
        { class: "dialog__form", novalidate: true },
        h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "rx-delete-title" }, "Delete this prescription?"), h("p", { class: "dialog__subtitle" }, `${customer.name} · ${formatDay(entry.prescribedAt)}`))),
        h("div", { class: "dialog__body" }, banner, h("p", null, "It is removed from this computer and from the server. It cannot be undone.")),
        h("div", { class: "dialog__footer" }, cancel, confirm),
      );
      const dialog = h("dialog", { class: "dialog dialog--narrow", "aria-labelledby": "rx-delete-title", "data-prescription-delete": entry.id }, form);
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
        confirm.replaceChildren(h("span", { class: "btn__spinner" }), "Deleting…");
        try {
          const result = await api.delete(entry.id);
          busy = false;
          dialog.close();
          toast(result.sentToServer ? "The prescription was deleted." : "The prescription was deleted from this computer. The server will be told when it can be reached.");
          await load();
        } catch (error) {
          busy = false;
          confirm.disabled = cancel.disabled = false;
          confirm.replaceChildren(icon("trash"), "Delete prescription");
          banner.querySelector("span").textContent = errorText(error); // the service says why (an order started using it meanwhile)
          banner.hidden = false;
        }
      });
      dialog.showModal();
      cancel.focus();
    }

    load();
    return { reload: load };
  }

  window.mountPrescriptions = mount;
})();
