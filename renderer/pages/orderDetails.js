// The page of one order (#orders/<id>): the customer, what is in the order, what was paid and what is left, the payments one by one, and its status.
// The status can be switched, and a payment can be taken while something is left to pay. Real data, through window.electronAPI.orderDetails
// (src/local/orderDetails.ts).
(() => {
  "use strict";

  const api = window.electronAPI.orderDetails;
  const CURRENCY = "DZD";
  const STATUSES = [
    ["confirmed", "Confirmed"],
    ["at_lab", "At the lab"],
    ["ready", "Ready"],
    ["delivered", "Delivered"],
    ["cancelled", "Cancelled"],
  ];
  const LABEL = Object.fromEntries(STATUSES);
  const LIST_STATUSES = new Set(["confirmed", "at_lab", "ready", "delivered", "cancelled"]);

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
  const dayFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
  const formatDay = (iso) => dayFormat.format(new Date(iso));
  const moneyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const money = (cents) => moneyFormat.format(cents / 100);
  const PAY_CONFIRM_DELAY_MS = 500;
  const EYE = { right: "Right eye", left: "Left eye", both: "Both eyes" };

  const state = { id: null, load: "loading", order: null, error: "", busy: false, message: "", token: 0, pending: null, editing: false, payDraft: null, confirmPay: null };
  let root = null;

  async function load() {
    const token = ++state.token;
    state.load = state.order ? "refreshing" : "loading";
    render();
    try {
      const order = await api.get(state.id);
      if (token !== state.token) return;
      state.order = order;
      state.load = "ready";
    } catch (error) {
      if (token !== state.token) return;
      state.load = "error";
      state.error = errorText(error);
    }
    render();
  }

  async function act(run) {
    if (state.busy) return;
    state.busy = true;
    state.message = "";
    render();
    try {
      state.order = await run();
    } catch (error) {
      state.message = errorText(error);
    }
    state.busy = false;
    render();
  }

  // ---- Pieces --------------------------------------------------------------------------------

  /** Picking a status only chooses it; the order changes when Confirm is pressed (Cancel puts the choice back). */
  function statusSwitch(order) {
    const shown = state.pending ?? order.status;
    const confirm = () => {
      const target = state.pending;
      state.pending = null;
      if (target) act(() => api.setStatus(order.id, target));
    };
    return h(
      "div",
      { class: "od-status" },
      h(
        "div",
        { class: "chips", role: "group", "aria-label": "Order status", "data-status-switch": "" },
        STATUSES.map(([key, label]) =>
          h("button", { class: "chip", type: "button", "data-set-status": key, "aria-pressed": String(shown === key), disabled: state.busy, onclick: () => { state.pending = key === order.status ? null : key; render(); } }, label),
        ),
      ),
      state.pending
        ? h(
            "div",
            { class: "od-status__confirm", "data-status-confirm": "" },
            h("button", { class: "btn btn--primary btn--sm", type: "button", "data-confirm-status": "", disabled: state.busy, onclick: confirm }, "Confirm"),
            h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-cancel-status": "", disabled: state.busy, onclick: () => { state.pending = null; render(); } }, "Cancel"),
          )
        : null,
    );
  }

  /** The question asked before a payment is taken: what is taken, from which order, what will be left. Nothing is taken until the person says yes. */
  function payConfirm(order) {
    const { cents, note } = state.confirmPay;
    const left = Math.max(0, order.remainingCents - cents);
    // A double click on "Take payment" must not answer the question by itself: the answer is accepted a moment after the question appears.
    const yes = h("button", { class: "btn btn--primary", type: "button", disabled: true, "data-pay-confirm-yes": "", onclick: () => {
      state.confirmPay = null;
      act(async () => {
        const result = await api.pay(order.id, { amountCents: cents, notes: note });
        state.payDraft = null;
        return result;
      });
    } }, "Yes, take the payment");
    setTimeout(() => { yes.disabled = state.busy; yes.focus(); }, PAY_CONFIRM_DELAY_MS);
    const back = h("button", { class: "btn btn--secondary", type: "button", "data-pay-confirm-back": "", onclick: () => { state.confirmPay = null; render(); } }, "Back");
    return h(
      "div",
      { class: "od-pay od-pay--confirm", role: "group", "aria-label": "Confirm the payment", "data-pay-confirm": "" },
      h("h3", { class: "od-section__title" }, "Confirm the payment"),
      h("p", { class: "od-pay__sentence", "data-pay-sentence": "" }, `Take ${money(cents)} for order ${order.number}?`),
      note.trim() ? h("p", { class: "od-hint" }, `Note: ${note.trim()}`) : null,
      h("p", { class: "od-hint", "data-pay-after": "" }, left === 0 ? "The order will be paid in full." : `${money(left)} will be left to pay.`),
      h("div", { class: "od-status__confirm" }, yes, back),
    );
  }

  function payForm(order) {
    if (state.confirmPay) return payConfirm(order);
    const amount = h("input", { class: "od-input", type: "number", min: "0", step: "any", inputmode: "decimal", "aria-label": `Amount in ${CURRENCY}`, value: state.payDraft?.amount ?? String(order.remainingCents / 100), "data-pay-amount": "" });
    const note = h("input", { class: "od-input od-input--wide", type: "text", maxlength: "500", placeholder: "Note (optional)", "aria-label": "Note", value: state.payDraft?.note ?? "", "data-pay-note": "" });
    const submit = () => {
      const cents = Math.round(Number(amount.value) * 100);
      if (!Number.isFinite(cents) || cents <= 0) {
        state.message = "Type the amount to take, above 0.";
        return render();
      }
      if (cents > order.remainingCents) {
        state.message = `That is more than what is left to pay (${money(order.remainingCents)}).`;
        return render();
      }
      state.payDraft = { amount: amount.value, note: note.value }; // (kept if the person goes Back)
      state.confirmPay = { cents, note: note.value };
      state.message = "";
      render();
    };
    return h(
      "form",
      { class: "od-pay", "data-pay": "", onsubmit: (e) => { e.preventDefault(); submit(); } },
      h("h3", { class: "od-section__title" }, "Take a payment"),
      h("div", { class: "od-pay__row" }, h("label", { class: "od-field" }, h("span", { class: "od-field__label" }, `Amount (${CURRENCY})`), amount), h("label", { class: "od-field od-field--grow" }, h("span", { class: "od-field__label" }, "Note"), note), h("button", { class: "btn btn--primary", type: "submit", disabled: state.busy, "data-pay-submit": "" }, "Take payment")),
      h("p", { class: "od-hint" }, `Left to pay: ${money(order.remainingCents)}. You can take all of it or a part.`),
    );
  }

  function paymentsTable(order) {
    if (order.payments.length === 0) return h("p", { class: "od-empty", "data-no-payments": "" }, "No payment taken on this order yet.");
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table sales-table", "data-payments-table": "" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Extra"), h("th", { scope: "col", class: "sales-money" }, "Amount"))),
        h(
          "tbody",
          null,
          order.payments.map((p) =>
            h("tr", { "data-payment": p.id }, h("td", { "data-cell": "date" }, formatDay(p.paidAt)), h("td", { "data-cell": "extra" }, [p.chequeDueDate ? `Cheque dated ${formatDay(p.chequeDueDate)}` : null, p.chequeDueDate && p.notes ? " · " : null, p.notes].filter(Boolean).join("") || "—"), h("td", { class: "sales-money", "data-cell": "amount" }, money(p.amountCents))),
          ),
        ),
      ),
    );
  }

  function itemsTable(order) {
    if (order.items.length === 0) return h("p", { class: "od-empty", "data-no-items": "" }, "No line on this order.");
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table sales-table", "data-items-table": "" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Item"), h("th", { scope: "col", class: "sales-money" }, "Qty"), h("th", { scope: "col", class: "sales-money" }, "Unit price"), h("th", { scope: "col", class: "sales-money" }, "Unit cost"), h("th", { scope: "col", class: "sales-money" }, "Total"))),
        h("tbody", null, order.items.map((i) => h("tr", { "data-item": i.id }, h("td", null, h("div", { class: "cell-name__stack" }, h("span", { class: "cell-name__text" }, i.description), i.eye ? h("span", { class: "cell-name__sub" }, EYE[i.eye] ?? i.eye) : null)), h("td", { class: "sales-money" }, String(i.quantity)), h("td", { class: "sales-money", "data-cell": "price" }, money(i.unitPriceCents)), h("td", { class: "sales-money", "data-cell": "cost" }, i.unitCostCents === null ? "—" : money(i.unitCostCents)), h("td", { class: "sales-money" }, money(i.totalCents))))),
      ),
    );
  }

  /** What an amount typed in the currency is, in centimes; null when it is empty, NaN when it is not an amount of 0 or more. */
  function centsOf(input) {
    const text = input.value.trim().replace(",", ".");
    if (text === "") return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : NaN;
  }

  /**
   * The form that corrects the money of the order: the price and the cost of ONE piece of each lens, the cost of the other lines, and the final price of the order.
   * The final price follows the items (the discount stays what it was) until it is typed over.
   */
  function editForm(order) {
    const fields = order.items.map((i) => ({
      item: i,
      price: i.kind === "lens" ? h("input", { class: "od-input", type: "number", min: "0", step: "any", inputmode: "decimal", value: String(i.unitPriceCents / 100), "aria-label": `Price of ${i.description} (${CURRENCY})`, "data-edit-price": i.id }) : null,
      cost: h("input", { class: "od-input", type: "number", min: "0", step: "any", inputmode: "decimal", value: i.unitCostCents === null ? "" : String(i.unitCostCents / 100), "aria-label": `Cost of ${i.description} (${CURRENCY})`, "data-edit-cost": i.id }),
    }));
    const final = h("input", { class: "od-input", type: "number", min: "0", step: "any", inputmode: "decimal", value: String(order.totalCents / 100), "aria-label": `Final price (${CURRENCY})`, "data-edit-final": "" });
    let touched = false;
    const hint = h("p", { class: "od-hint", "data-edit-hint": "" });
    const subtotal = () => fields.reduce((sum, f) => { const p = f.price ? centsOf(f.price) : f.item.unitPriceCents; return sum + (Number.isNaN(p) || p === null ? f.item.unitPriceCents : p) * f.item.quantity; }, 0);
    const refresh = () => {
      const items = subtotal();
      if (!touched) final.value = String((items - Math.min(order.discountCents, items)) / 100);
      hint.textContent = `The items add up to ${money(items)}. The final price cannot be more than that, nor less than the ${money(order.paidCents)} already paid.`;
    };
    final.addEventListener("input", () => { touched = true; refresh(); });
    for (const f of fields) f.price?.addEventListener("input", refresh);
    refresh();

    // what was typed stays when something is wrong: the problem is said in the form, which is not drawn again
    const problem = h("p", { class: "od-error", role: "alert", hidden: true, "data-message": "" });
    const say = (message) => { problem.textContent = message; problem.hidden = !message; };
    const saveButton = h("button", { class: "btn btn--primary btn--sm", type: "submit", disabled: state.busy, "data-edit-save": "" }, "Save changes");
    const save = async () => {
      if (state.busy) return;
      const lines = [];
      for (const f of fields) {
        const line = { id: f.item.id };
        const cost = centsOf(f.cost);
        const price = f.price ? centsOf(f.price) : undefined;
        if (Number.isNaN(cost) || Number.isNaN(price) || price === null) return say("Type each amount as 0 or more.");
        if (price !== undefined) line.unitPriceCents = price;
        line.unitCostCents = cost;
        lines.push(line);
      }
      const finalCents = centsOf(final);
      if (finalCents === null || Number.isNaN(finalCents)) return say("Type each amount as 0 or more.");
      say("");
      state.busy = true;
      saveButton.disabled = true;
      try {
        state.order = await api.edit(order.id, { lines, ...(touched ? { finalPriceCents: finalCents } : {}) });
        state.editing = false;
        state.busy = false;
        render();
      } catch (error) {
        state.busy = false;
        saveButton.disabled = false;
        say(errorText(error));
      }
    };
    const field = (label, input) => h("label", { class: "od-field" }, h("span", { class: "od-field__label" }, label), input);
    return h(
      "form",
      { class: "od-edit", "data-edit": "", onsubmit: (e) => { e.preventDefault(); save(); } },
      h("div", { class: "od-edit__lines" }, fields.map((f) => h("div", { class: "od-edit__line", "data-edit-line": f.item.id }, h("span", { class: "od-edit__name" }, f.item.description, f.item.eye ? h("span", { class: "cell-name__sub" }, EYE[f.item.eye] ?? f.item.eye) : null), f.price ? field(`Price (${CURRENCY})`, f.price) : h("span", { class: "od-edit__fixed" }, money(f.item.unitPriceCents)), field(`Cost (${CURRENCY})`, f.cost)))),
      h("p", { class: "od-hint" }, "Leave a cost empty when it is not known."),
      field(`Final price (${CURRENCY})`, final),
      hint,
      problem,
      h("div", { class: "od-status__confirm" }, saveButton, h("button", { class: "btn btn--secondary btn--sm", type: "button", disabled: state.busy, "data-edit-cancel": "", onclick: () => { state.editing = false; state.message = ""; render(); } }, "Cancel")),
    );
  }

  function tile(key, label, value, tone, note) {
    return h("div", { class: `summary__tile${tone ? ` summary__tile--${tone}` : ""}`, "data-tile": key }, h("span", { class: "summary__label" }, label), h("span", { class: "summary__value" }, value), note ? h("span", { class: "summary__note" }, note) : null);
  }

  // ---- The page ------------------------------------------------------------------------------

  function render() {
    if (!root) return;
    root.replaceChildren();
    root.append(h("a", { class: "od-back", href: "#orders" }, icon("arrow-left"), "Orders"));
    if (state.load === "loading") return root.append(h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the order…")));
    if (state.load === "error") {
      return root.append(h("div", { class: "state state--error", role: "alert", "data-error": "" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, "The order couldn't be opened"), h("p", { class: "state__text" }, state.error), h("a", { class: "btn btn--secondary", href: "#orders" }, "Back to the orders")));
    }
    const o = state.order;
    const dates = [`Ordered ${formatDay(o.orderedAt)}`, o.deliveredAt ? `Delivered ${formatDay(o.deliveredAt)}` : o.promisedAt && o.status !== "cancelled" ? `Promised ${formatDay(o.promisedAt)}` : null].filter(Boolean);
    root.dataset.id = o.id;
    // (append would write the word "null" for a null: the parts that may be absent are filtered out)
    root.append(
      ...[
      h(
        "header",
        { class: "page__header" },
        h(
          "div",
          null,
          h("h2", { class: "page__title", id: "order-title", "data-number": "" }, o.number),
          h("p", { class: "page__description", "data-customer": "" }, o.customer ? h("a", { class: "sales-customer", href: `#customers/${encodeURIComponent(o.customer.id)}` }, o.customer.name) : "Walk-in customer", o.customer?.phone ? ` · ${o.customer.phone}` : "", ` · ${dates.join(" · ")}`, o.overdue ? h("span", { class: "sales-overdue", "data-overdue": "" }, "Overdue") : null),
        ),
        h("span", { class: `status status--${o.status}`, "data-status": o.status }, LABEL[o.status] ?? o.status),
      ),
      h("div", { class: "summary" }, tile("total", "Total", money(o.totalCents)), tile("paid", "Paid", money(o.paidCents)), tile("left", "Left to pay", o.status === "cancelled" ? "—" : money(o.remainingCents), o.remainingCents > 0 ? "due" : null), tile("cost", "Cost", o.costCents === null ? "—" : money(o.costCents)), tile("profit", "Net profit", o.profitCents === null ? "—" : money(o.profitCents), o.profitCents !== null && o.profitCents < 0 ? "due" : null)),
      state.message ? h("p", { class: "od-error", role: "alert", "data-message": "" }, state.message) : null,
      h("section", { class: "od-section" }, h("h3", { class: "od-section__title" }, "Status"), statusSwitch(o)),
      o.canPay ? h("section", { class: "od-section" }, payForm(o)) : null,
      h("section", { class: "od-section", "data-documents": "" }, h("h3", { class: "od-section__title" }, "Documents"), window.orderPrintBar(o.id, { supplier: o.status === "confirmed" })),
      h("section", { class: "od-section" }, h("h3", { class: "od-section__title" }, "Payments"), h("div", { class: "table-card" }, paymentsTable(o))),
      h("section", { class: "od-section" }, h("div", { class: "od-section__head" }, h("h3", { class: "od-section__title" }, "Items"), o.items.length > 0 && !state.editing ? h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-edit-open": "", onclick: () => { state.editing = true; state.message = ""; render(); } }, "Edit prices and costs") : null), state.editing ? editForm(o) : h("div", { class: "table-card" }, itemsTable(o)), o.discountCents > 0 ? h("p", { class: "od-hint", "data-discount": "" }, `Discount: ${money(o.discountCents)}`) : null),
      o.notes ? h("section", { class: "od-section" }, h("h3", { class: "od-section__title" }, "Notes"), h("p", { class: "od-notes", "data-notes": "" }, o.notes)) : null,
      ].filter(Boolean),
    );
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const match = /^orders\/([^/]+)$/.exec(location.hash.slice(1));
    const id = match && !LIST_STATUSES.has(match[1]) ? decodeURIComponent(match[1]) : null;
    if (id) {
      if (!root) {
        root = h("section", { class: "page", "data-order-page": "", "aria-labelledby": "order-title" });
        content.replaceChildren(root);
      }
      if (state.id !== id) {
        state.order = null;
        state.pending = null;
        state.message = "";
        state.editing = false;
        state.payDraft = null;
        state.confirmPay = null;
      }
      state.id = id;
      load();
    } else if (root) {
      root.remove();
      root = null;
      state.token++;
      state.id = null;
      state.order = null;
      state.pending = null;
      state.message = "";
      state.editing = false;
      state.payDraft = null;
      state.confirmPay = null;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
