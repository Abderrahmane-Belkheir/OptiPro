// "Send the lab sheets to the lenses supplier", opened from the Orders page (Confirmed):  window.openLabSend({ file, orders, numbers })
// The PDF has just been made (one lab sheet per page). The steps:
//   1. the person chooses the lenses supplier (the shop's active suppliers that supply lenses): with ONE it is already chosen, with several they are asked to choose,
//      with none they are told to add one. Download keeps the PDF on this computer (a "save as" window). Send goes on.
//   2. HOW to send it: the ways the supplier can be reached, each only when the supplier has what it needs: Email (the supplier has an email address) and WhatsApp (it
//      has a phone number). A supplier with neither is told so.
//   3. Email / WhatsApp: a form with the address (or the number), the files, and a message. Its button OPENS the message in the browser (Gmail's compose page, or a
//      WhatsApp chat) with the address and the text filled in, and puts the lab sheet of each order in the person's "optician" folder, one file per order (CMD-….pdf),
//      skipping the ones already there: a link can not attach a file, so the person attaches them from that folder and presses Send in the browser. The file explorer
//      is not opened. Nothing is sent by the app.
(() => {
  "use strict";

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
  /** Whether a supplier supplies lenses (an old "lab" counts as lenses). */
  const suppliesLenses = (s) => String(s.kinds ?? "").split(",").map((k) => k.trim()).some((k) => k === "lenses" || k === "lab");
  const fileName = (file) => String(file).split(/[\\/]/).pop();
  /** What the supplier has typed for a way of contact; null (or only spaces) = it has none, and the way is not offered. */
  const filled = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

  function open(pdf) {
    const state = { chosen: "", suppliers: [] };
    const close = h("button", { class: "icon-btn", type: "button", "aria-label": "Close" }, icon("x"));
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Close");
    const back = h("button", { class: "btn btn--secondary", type: "button", "data-action": "back" }, "Back");
    const download = h("button", { class: "btn btn--secondary", type: "button", "data-action": "download-lab-pdf" }, icon("printer"), "Download");
    const saved = h("p", { class: "field__help", role: "status", "data-saved": "", hidden: true });
    download.addEventListener("click", async () => {
      download.disabled = true;
      saved.hidden = true;
      saved.classList.remove("field__error");
      try {
        const result = await window.electronAPI.documents.savePdf(pdf.file);
        if (result.status === "saved") { saved.textContent = `Saved to ${result.file}`; saved.hidden = false; }
      } catch (error) {
        saved.textContent = `The PDF couldn't be saved: ${errorText(error)}`;
        saved.classList.add("field__error");
        saved.hidden = false;
      }
      download.disabled = false;
    });
    const send = h("button", { class: "btn btn--primary", type: "submit", disabled: true, "data-action": "send-lab-pdf" }, "Send");
    const target = h("div", { class: "field", "data-supplier-part": "" }, h("p", { class: "field__help" }, "Looking for your lenses suppliers…"));
    const subtitle = h("p", { class: "dialog__subtitle", "data-pdf": "" }, `${pdf.orders} ${pdf.orders === 1 ? "lab sheet" : "lab sheets"} in one PDF: ${pdf.numbers.join(", ")}`);
    const pdfSection = h("section", { class: "order-form__section" }, h("h3", { class: "order-form__heading" }, "PDF"), h("p", { class: "field__help", "data-file": "", title: pdf.file }, h("b", null, fileName(pdf.file))), download, saved);
    const supplierSection = h("section", { class: "order-form__section" }, h("h3", { class: "order-form__heading" }, "Supplier"), target);
    const body = h("div", { class: "dialog__body" });
    const footer = h("div", { class: "dialog__footer" });

    const refresh = () => {
      send.disabled = state.chosen === "";
    };
    const chosenSupplier = () => state.suppliers.find((s) => s.id === state.chosen) ?? null;

    // ---- step 1: the supplier
    function showSupplier() {
      body.dataset.step = "supplier";
      body.replaceChildren(pdfSection, supplierSection);
      footer.replaceChildren(cancel, send);
    }

    // ---- step 2: how to send it
    function showMethods() {
      const supplier = chosenSupplier();
      if (!supplier) return;
      const email = filled(supplier.email);
      const phone = filled(supplier.phone);
      body.dataset.step = "methods";
      const method = (key, label, detail, onclick) =>
        h("button", { class: "btn btn--secondary lab-send__method", type: "button", "data-method": key, onclick }, h("b", null, label), h("span", { class: "lab-send__detail", "data-detail": key }, detail));
      const methods = [];
      if (email) methods.push(method("email", "Email", email, () => showCompose("email", supplier, email)));
      if (phone) methods.push(method("whatsapp", "WhatsApp", phone, () => showCompose("whatsapp", supplier, phone)));
      body.replaceChildren(
        h(
          "section",
          { class: "order-form__section" },
          h("h3", { class: "order-form__heading" }, "How do you want to send it?"),
          h("p", { class: "field__help", "data-supplier-name": "" }, `Choose how to reach ${supplier.name}`),
          methods.length > 0
            ? h("div", { class: "lab-send__methods", role: "group", "aria-label": "Ways to contact the supplier", "data-methods": "" }, methods)
            : h("p", { class: "field__error", role: "alert", "data-state": "no-method" }, "This supplier has no email address and no phone number: add one in Suppliers."),
        ),
      );
      footer.replaceChildren(back, cancel);
    }

    // ---- step 3: the email, or the WhatsApp message
    function showCompose(kind, supplier, address) {
      const email = kind === "email";
      body.dataset.step = kind;
      const message = h("textarea", { class: "input", id: "lab-send-message", rows: "5", maxlength: "2000", "data-email-message": "", placeholder: "Add a message to send with the file (optional)." });
      const opened = h("p", { class: "field__help", role: "status", "data-opened": "", hidden: true });
      const open = h("button", { class: "btn btn--primary", type: "button", "data-action": email ? "send-email" : "send-whatsapp" }, icon("check"), email ? "Open email" : "Open WhatsApp");
      open.addEventListener("click", async () => {
        open.disabled = true;
        opened.hidden = true;
        opened.classList.remove("field__error");
        try {
          const result = email
            ? await window.electronAPI.contact.openEmail({ to: address, lang: window.i18n?.lang, numbers: pdf.numbers, message: message.value, file: pdf.file })
            : await window.electronAPI.contact.openWhatsApp({ phone: address, message: message.value, file: pdf.file });
          const made = result.sheets.filter((s) => s.saved).length;
          const already = result.sheets.filter((s) => !s.saved && s.path).length;
          const failed = result.sheets.filter((s) => !s.path).length;
          const folder = (result.sheets.find((s) => s.path)?.path ?? "").replace(/[\\/][^\\/]*$/, "");
          opened.textContent = failed === 0
            ? `Opened in your browser. The lab sheets are in ${folder}: ${made} saved now, ${already} already there. Attach them from there.`
            : `Opened in your browser. ${failed} lab sheet(s) could not be saved in your optician folder: use Download to save the PDF.`;
          opened.dataset.made = String(made);
          opened.dataset.already = String(already);
          opened.dataset.failed = String(failed);
        } catch (error) {
          opened.textContent = `The message couldn't be opened: ${errorText(error)}`;
          opened.classList.add("field__error");
        }
        opened.hidden = false;
        open.disabled = false;
      });
      body.replaceChildren(
        h(
          "section",
          { class: "order-form__section", "data-email-form": "", "data-kind": kind },
          h("h3", { class: "order-form__heading" }, email ? "Email" : "WhatsApp"),
          h("div", { class: "field" }, h("label", { class: "field__label", for: "lab-send-to" }, "To"), h("input", { class: "input", id: "lab-send-to", type: email ? "email" : "tel", value: address, readonly: true, "data-email-to": "" }), h("p", { class: "field__help" }, supplier.name)),
          h("div", { class: "field" }, h("span", { class: "field__label" }, "File to send"), h("p", { class: "field__help", "data-email-file": "", title: pdf.file }, icon("printer"), h("b", null, pdf.numbers.map((n) => `${n}.pdf`).join(", ")))),
          h("div", { class: "field" }, h("label", { class: "field__label", for: "lab-send-message" }, "Message"), message),
          opened,
        ),
      );
      footer.replaceChildren(h("span", { class: "order-form__note" }, "A link can't attach a file: the lab sheets are saved in your optician folder so you can attach them."), back, cancel, open);
    }

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "lab-send-title" }, "Send to the lenses supplier"), subtitle), close),
      body,
      footer,
    );
    const dialog = h("dialog", { class: "dialog", "aria-labelledby": "lab-send-title", "data-lab-send": "" }, form);
    document.body.append(dialog);
    const dismiss = () => dialog.close();
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    back.addEventListener("click", () => (body.dataset.step === "email" || body.dataset.step === "whatsapp" ? showMethods() : showSupplier()));
    dialog.addEventListener("close", () => dialog.remove());
    // Send (with a supplier chosen) goes on to the ways of sending it; nothing is sent
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (body.dataset.step === "supplier" && state.chosen !== "") showMethods();
    });
    showSupplier();
    dialog.showModal();

    (async () => {
      try {
        const list = (await window.electronAPI.suppliers.list()).filter((s) => s.isActive && suppliesLenses(s)).sort((a, b) => a.name.localeCompare(b.name));
        state.suppliers = list;
        target.replaceChildren();
        if (list.length === 0) {
          target.append(h("p", { class: "field__error", role: "alert", "data-state": "none" }, "You have no lenses supplier yet: add one in Suppliers."));
        } else {
          // the person chooses from the lenses suppliers; with only one, it is already chosen
          const only = list.length === 1;
          const select = h("select", { class: "input", id: "lab-send-supplier", "data-supplier-select": "" }, only ? null : h("option", { value: "" }, "Choose a supplier"), list.map((s) => h("option", { value: s.id }, s.name)));
          if (only) { select.value = list[0].id; state.chosen = list[0].id; select.dataset.chosen = list[0].id; }
          select.addEventListener("change", () => { state.chosen = select.value; refresh(); });
          target.append(h("label", { class: "field__label", for: "lab-send-supplier" }, only ? "Your lenses supplier" : "You have several lenses suppliers: choose the one to send this to"), select);
        }
        refresh();
      } catch (error) {
        target.replaceChildren(h("p", { class: "field__error", role: "alert" }, `The suppliers couldn't be loaded: ${errorText(error)}`));
      }
    })();
  }

  window.openLabSend = open;
})();
