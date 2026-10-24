// The customer details page, around the prescriptions: the information panel, the summary strip and the Orders tab.
// The orders shown are the customer's REAL ones, read through window.electronAPI (orders, order lines, payments, invoices); nothing here is made up.
//
//   window.customerHistoryData   the three reads/writes the screens use (below)
//   window.mountCustomerOrders(container, customer, hooks)   hooks: { showPrescriptions(id), onPrescriptionChosen(), onNewOrder() }
//   window.mountCustomerSummary(container, customer)
//   window.mountCustomerInfo(container, customer)
//   window.mountCustomerTabs(container, tabs)
//
// Money is in cents and dates are ISO strings, like everywhere else in the app.
(() => {
  "use strict";

  const CURRENCY = "DZD";

  // OrderView (what one order card shows):
  //   { id, number, status (confirmed | at_lab | ready | delivered | cancelled), orderedAt, promisedAt, deliveredAt,
  //     lines: [{ kind, description, quantity, totalCents }],   // the order's lines: frame | lens | accessory | service
  //     prescriptionId (or null), totalCents, paidCents (the payments made on it), invoiceNumber (or null) }
  // CustomerSummary (the strip above the tabs): { balanceDueCents, lastVisitAt, orderCount, totalSpentCents }
  const customerHistoryData = {
    /** The orders of a customer, newest first, each with its lines, what was paid on it and its invoice number. */
    async listOrders(customerId) {
      const api = window.electronAPI;
      const orders = await api.orders.list({ customerId });
      return Promise.all(
        orders.map(async (order) => {
          const [items, payments, invoices] = await Promise.all([api.orderItems.list({ orderId: order.id }), api.payments.list({ orderId: order.id }), api.invoices.list({ orderId: order.id })]);
          return {
            id: order.id,
            number: order.number,
            status: order.status,
            orderedAt: order.orderedAt,
            promisedAt: order.promisedAt,
            deliveredAt: order.deliveredAt,
            lines: items.map((item) => ({ kind: item.kind, description: item.description, quantity: item.quantity, totalCents: item.totalCents })),
            prescriptionId: order.prescriptionId,
            totalCents: order.totalCents,
            paidCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0),
            invoiceNumber: invoices[0]?.number ?? null,
          };
        }),
      );
    },

    /** The numbers of the strip above the tabs, from the same orders (a cancelled order owes nothing). */
    async summary(customerId) {
      const orders = await customerHistoryData.listOrders(customerId);
      const open = orders.filter((order) => order.status !== "cancelled");
      return {
        balanceDueCents: open.reduce((sum, order) => sum + Math.max(0, order.totalCents - order.paidCents), 0),
        lastVisitAt: orders[0]?.orderedAt ?? null,
        orderCount: orders.length,
        totalSpentCents: open.reduce((sum, order) => sum + order.paidCents, 0),
      };
    },

    /** Which prescription an order is made with (null = none). Rejects with a readable message when refused: a prescription an order
     *  uses can no longer be edited, so choosing one locks it. */
    async choosePrescription(orderId, prescriptionId) {
      await window.electronAPI.orders.update(orderId, { prescriptionId });
    },
  };
  window.customerHistoryData = customerHistoryData;

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
  const moneyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
  const money = (cents) => moneyFormat.format(cents / 100);

  const STATUS = {
    confirmed: "Confirmed",
    at_lab: "At the lab",
    ready: "Ready",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  const KIND = { frame: "Frame", lens: "Lenses", accessory: "Accessory", service: "Service" };

  function age(iso) {
    const born = new Date(iso);
    const now = new Date();
    let years = now.getUTCFullYear() - born.getUTCFullYear();
    if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) years--;
    return years;
  }

  /** "+2.00 / −1.25 × 90°" for one eye, as a short reminder on an order; the full card opens from the link. */
  function rxLine(entry) {
    const eye = (side) => {
      const s = entry[`${side}Sphere`];
      const c = entry[`${side}Cylinder`];
      const a = entry[`${side}Axis`];
      const d = (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
      if (s === null && c === null) return "—";
      return `${s === null ? "" : d(s)}${c === null ? "" : ` / ${d(c)}${a === null ? "" : ` × ${a}°`}`}`;
    };
    return `R ${eye("right")}  ·  L ${eye("left")}`;
  }

  // ---- Customer information -------------------------------------------------------------------

  function mountInfo(container, customer) {
    const row = (label, value) =>
      h("div", { class: "info__row" }, h("dt", { class: "info__key" }, label), h("dd", { class: `info__value${value ? "" : " info__value--empty"}` }, value || "Not provided"));
    container.append(
      h(
        "section",
        { class: "info", "aria-label": "Customer information" },
        h(
          "dl",
          { class: "info__grid" },
          row("Phone", customer.phone),
          row("Email", customer.email),
          row("Address", customer.address),
          row("Date of birth", customer.dateOfBirth ? `${formatDay(customer.dateOfBirth)} (${age(customer.dateOfBirth)} years)` : null),
          row("Customer since", customer.createdAt ? formatDay(customer.createdAt) : null),
        ),
        customer.notes ? h("p", { class: "info__notes" }, h("span", { class: "info__key" }, "Notes"), customer.notes) : null,
      ),
    );
  }

  // ---- Summary strip ---------------------------------------------------------------------------

  function mountSummary(container, customer) {
    const strip = h("section", { class: "summary", "aria-label": "Summary", "data-status": "loading" });
    container.append(strip);
    const tile = (label, value, tone) => h("div", { class: `summary__tile${tone ? ` summary__tile--${tone}` : ""}` }, h("span", { class: "summary__label" }, label), h("span", { class: "summary__value" }, value));
    customerHistoryData
      .summary(customer.id)
      .then((s) => {
        if (!strip.isConnected) return;
        strip.dataset.status = "ready";
        strip.replaceChildren(
          tile("Balance due", money(s.balanceDueCents), s.balanceDueCents > 0 ? "due" : null),
          tile("Last visit", s.lastVisitAt ? formatDay(s.lastVisitAt) : "—"),
          tile("Orders", String(s.orderCount)),
          tile("Total paid", money(s.totalSpentCents)),
        );
      })
      .catch(() => {
        strip.hidden = true; // the strip is a convenience; the tabs still work
      });
  }

  // ---- Tabs ------------------------------------------------------------------------------------

  /** tabs: [{ id, label, mount(panel) }]; a panel is mounted the first time its tab opens. The first tab is open at the start. */
  function mountTabs(container, tabs) {
    const list = h("div", { class: "tabs__list", role: "tablist", "aria-label": "Customer history" });
    const panels = new Map();
    const buttons = new Map();
    const mounted = new Set();

    function select(id, focus) {
      for (const tab of tabs) {
        const on = tab.id === id;
        buttons.get(tab.id).setAttribute("aria-selected", String(on));
        buttons.get(tab.id).tabIndex = on ? 0 : -1;
        panels.get(tab.id).hidden = !on;
        if (on && !mounted.has(tab.id)) {
          mounted.add(tab.id);
          tab.mount(panels.get(tab.id));
        }
      }
      if (focus) buttons.get(id).focus();
    }

    tabs.forEach((tab, index) => {
      const button = h("button", { class: "tabs__tab", type: "button", role: "tab", id: `tab-${tab.id}`, "aria-controls": `panel-${tab.id}`, "data-tab": tab.id, onclick: () => select(tab.id, false) }, tab.label);
      button.addEventListener("keydown", (event) => {
        const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (event.key === "Home") return (event.preventDefault(), select(tabs[0].id, true));
        if (event.key === "End") return (event.preventDefault(), select(tabs[tabs.length - 1].id, true));
        if (!step) return;
        event.preventDefault();
        select(tabs[(index + step + tabs.length) % tabs.length].id, true);
      });
      buttons.set(tab.id, button);
      panels.set(tab.id, h("div", { class: "tabs__panel", role: "tabpanel", id: `panel-${tab.id}`, "aria-labelledby": `tab-${tab.id}`, hidden: true }));
      list.append(button);
    });
    container.append(h("div", { class: "tabs" }, list, ...tabs.map((tab) => panels.get(tab.id))));
    select(tabs[0].id, false);
    return { select };
  }

  // ---- The Orders tab --------------------------------------------------------------------------

  function mountOrders(container, customer, hooks) {
    const state = { status: "loading", orders: [], prescriptions: [], error: "", token: 0 };
    const list = h("div", { class: "orders-list", "aria-live": "polite" });
    const section = h(
      "section",
      { class: "orders", "aria-labelledby": "orders-title" },
      h(
        "div",
        { class: "rx__header" },
        h("div", null, h("h3", { class: "rx__title", id: "orders-title" }, "Orders"), h("p", { class: "rx__hint" }, "Newest first. An order can use one of the customer's prescriptions, or none (a frame only, sunglasses, accessories).")),
        h("button", { class: "btn btn--primary", type: "button", id: "new-order", onclick: () => hooks?.onNewOrder?.() }, icon("plus"), "New order"),
      ),
      list,
    );
    container.append(section);

    async function load() {
      const token = ++state.token;
      state.status = "loading";
      render();
      try {
        const [orders, prescriptions] = await Promise.all([customerHistoryData.listOrders(customer.id), window.electronAPI.prescriptions.listForCustomer(customer.id)]);
        if (token !== state.token) return;
        state.orders = orders;
        state.prescriptions = prescriptions;
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
      if (state.status === "loading") return list.append(h("p", { class: "rx__loading" }, "Loading the orders…"));
      if (state.status === "error") {
        return list.append(h("div", { class: "state panel-state", "data-state": "error" }, h("h4", { class: "state__title" }, "The orders couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
      }
      if (state.orders.length === 0) {
        return list.append(h("div", { class: "state panel-state", "data-state": "empty" }, h("h4", { class: "state__title" }, "No order yet"), h("p", { class: "state__text" }, `${customer.name} has not ordered anything.`)));
      }
      for (const order of state.orders) list.append(card(order));
    }

    function card(order) {
      const cancelled = order.status === "cancelled";
      const remaining = cancelled ? 0 : Math.max(0, order.totalCents - order.paidCents);
      const lines = h(
        "ul",
        { class: "order__lines" },
        order.lines.map((line) =>
          h("li", { class: "order__line" }, h("span", { class: "order__kind" }, KIND[line.kind] ?? line.kind), h("span", { class: "order__desc" }, line.quantity > 1 ? `${line.quantity} × ${line.description}` : line.description), h("span", { class: "order__amount" }, money(line.totalCents))),
        ),
      );
      const dates = [`Ordered ${formatDay(order.orderedAt)}`, order.deliveredAt ? `Delivered ${formatDay(order.deliveredAt)}` : order.promisedAt && !cancelled ? `Promised ${formatDay(order.promisedAt)}` : null].filter(Boolean).join(" · ");
      return h(
        "article",
        { class: `order${cancelled ? " order--cancelled" : ""}`, "data-id": order.id, "data-status": order.status },
        h(
          "div",
          { class: "order__header" },
          h("div", { class: "order__title" }, h("a", { class: "order__number order__link", href: `#orders/${encodeURIComponent(order.id)}`, "data-open-order": order.id }, order.number), h("span", { class: `status status--${order.status}` }, STATUS[order.status] ?? order.status)),
          h("a", { class: "order__open", href: `#orders/${encodeURIComponent(order.id)}`, "data-order-link": order.id }, "Open order"),
          order.invoiceNumber ? h("a", { class: "order__invoice", href: "#", "data-invoice": order.invoiceNumber, onclick: (event) => event.preventDefault() }, icon("sales"), order.invoiceNumber) : null,
        ),
        h("p", { class: "order__dates" }, dates),
        lines,
        prescriptionBox(order),
        h(
          "dl",
          { class: "order__money" },
          h("div", null, h("dt", null, "Total"), h("dd", { "data-field": "total" }, money(order.totalCents))),
          h("div", null, h("dt", null, "Paid"), h("dd", { "data-field": "paid" }, money(order.paidCents))),
          h("div", { class: remaining > 0 ? "order__money--due" : null }, h("dt", null, "Remaining"), h("dd", { "data-field": "remaining" }, cancelled ? "—" : money(remaining))),
        ),
      );
    }

    /** The prescription of the order: a short line with a link to its card, and a select to choose another one. */
    function prescriptionBox(order) {
      const chosen = state.prescriptions.find((p) => p.id === order.prescriptionId) ?? null;
      const select = h(
        "select",
        { class: "input order__rx-select", "aria-label": `Prescription for ${order.number}`, "data-order": order.id, disabled: order.status === "cancelled" || order.status === "delivered" || state.prescriptions.length === 0 },
        h("option", { value: "" }, state.prescriptions.length === 0 ? "No prescription on file" : "None chosen"),
        state.prescriptions.map((p) => h("option", { value: p.id, selected: p.id === order.prescriptionId }, `${formatDay(p.prescribedAt)}${p.current ? " (current)" : ""}`)),
      );
      const error = h("p", { class: "order__rx-error", role: "alert", hidden: true });
      select.addEventListener("change", async () => {
        error.hidden = true;
        select.disabled = true;
        try {
          await customerHistoryData.choosePrescription(order.id, select.value || null);
          order.prescriptionId = select.value || null;
          render();
          hooks?.onPrescriptionChosen?.(order, order.prescriptionId); // the Prescriptions tab can refresh its "Used in N orders" badges
        } catch (err) {
          select.value = order.prescriptionId ?? "";
          select.disabled = false;
          error.textContent = errorText(err);
          error.hidden = false;
        }
      });
      return h(
        "div",
        { class: "order__rx" },
        h("span", { class: "order__rx-label" }, "Prescription"),
        chosen ? h("span", { class: "order__rx-line", "data-field": "prescription" }, rxLine(chosen)) : h("span", { class: "order__rx-line order__rx-line--none", "data-field": "prescription" }, "None chosen yet"),
        chosen ? h("button", { class: "btn btn--secondary order__rx-open", type: "button", onclick: () => hooks?.showPrescriptions?.(chosen.id) }, "View") : null,
        select,
        error,
      );
    }

    load();
    return { reload: load };
  }

  window.mountCustomerInfo = mountInfo;
  window.mountCustomerSummary = mountSummary;
  window.mountCustomerTabs = mountTabs;
  window.mountCustomerOrders = mountOrders;
})();
