// Printing an order's papers, from two places: the "Order placed" box that opens when the New order form saves an order, and the Documents section of the
// order's page.
//   window.orderPrintBar(orderId, { supplier })   "Print invoice" (for the customer) and a line saying what happened. With supplier: true (a confirmed order,
//                                   which always has lenses) also "Print PDF for the lenses supplier": the button is there, it does nothing yet.
//                                   (The lab sheet is not printed per order any more.)
//   window.showOrderPlaced(result)  the box shown after an order is placed (result = what orderPlacement.place answered)
// Both go through electronAPI.documents.print(orderId, kind, language). The system's print dialog opens (where "save as PDF" is a printer too).
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
  const money = (cents) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: "DZD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
    } catch {
      return `${cents / 100} DZD`;
    }
  };

  /** The document is written in the language the app is showing. */
  const language = () => window.i18n?.lang ?? "en";

  function orderPrintBar(orderId, { supplier = false } = {}) {
    const status = h("p", { class: "od-hint order-print__status", role: "status", "data-print-status": "" });
    let busy = false;
    const buttons = [];
    async function print(kind) {
      if (busy) return;
      busy = true;
      for (const b of buttons) b.disabled = true;
      status.classList.remove("order-print__status--error");
      status.textContent = "";
      try {
        const result = await window.electronAPI.documents.print(orderId, kind, language());
        status.textContent = result.status === "sent" ? "Sent to the printer." : result.status === "cancelled" ? "Printing was cancelled." : `Saved: ${result.file}`;
        status.dataset.result = result.status;
      } catch (error) {
        status.classList.add("order-print__status--error");
        status.textContent = errorText(error);
        status.dataset.result = "error";
      } finally {
        busy = false;
        for (const b of buttons) b.disabled = false;
      }
    }
    /** Added for later: no logic behind it yet (no click handler, no document). */
    const supplierButton = () => h("button", { class: "btn btn--secondary", type: "button", id: "print-supplier-pdf", "data-print-supplier": "" }, icon("printer"), "Print PDF for the lenses supplier");
    const button = (kind, label) => {
      const b = h("button", { class: "btn btn--secondary", type: "button", "data-print": kind, onclick: () => print(kind) }, icon("printer"), label);
      buttons.push(b);
      return b;
    };
    return h("div", { class: "order-print", "data-order-print": orderId }, h("div", { class: "order-print__buttons" }, button("invoice", "Print invoice"), supplier ? supplierButton() : null), status);
  }

  function showOrderPlaced(result) {
    const order = result.order;
    const left = Math.max(0, result.totalCents - result.depositCents);
    const close = h("button", { class: "btn btn--primary", type: "button", "data-action": "close-placed" }, "Done");
    const view = h("a", { class: "btn btn--secondary", href: `#orders/${encodeURIComponent(order.id)}`, "data-action": "view-placed" }, "View the order");
    const dialog = h(
      "dialog",
      { class: "dialog", "aria-labelledby": "order-placed-title", "data-order-placed": order.id },
      h(
        "div",
        { class: "dialog__form" },
        h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "order-placed-title" }, "Order placed"), h("p", { class: "dialog__subtitle", "data-placed-number": "" }, order.number))),
        h(
          "div",
          { class: "dialog__body" },
          h("dl", { class: "order-summary" }, ...[["Total", money(result.totalCents)], ["Paid", money(result.depositCents)], ["Left to pay", money(left)], ...(order.trackingCode ? [["Tracking code", String(order.trackingCode)]] : [])].map(([label, value]) => h("div", { class: "order-summary__row" }, h("dt", null, label), h("dd", null, value)))),
          result.sentToServer ? null : h("p", { class: "od-hint", "data-not-sent": "" }, "Saved on this computer. It will reach the server on the next sync."),
          h("h3", { class: "order-form__heading" }, "Print"),
          orderPrintBar(order.id),
        ),
        h("div", { class: "dialog__footer" }, view, close),
      ),
    );
    document.body.append(dialog);
    close.addEventListener("click", () => dialog.close());
    view.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  window.orderPrintBar = orderPrintBar;
  window.showOrderPlaced = showOrderPlaced;
})();
