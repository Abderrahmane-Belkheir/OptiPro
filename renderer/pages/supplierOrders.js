// The Supplier orders page (#supplier-orders, and #supplier-orders/<id> for one order): the orders the shop places with its suppliers to RESTOCK: frames and accessories,
// bought in bulk, not for one customer's order (so, unlike the Orders page, nothing here belongs to a customer). Lens orders are not here: a lens is made for one
// customer's order, so it is sent to the lab from that order (its status and its PDF are on the order).
//   the list     the orders of the chosen period (a year, and a month of it; it opens on the current year), newest first: date, supplier, how many items and pieces, the
//                total, the status. Above it: how many orders the period holds and what was spent on them (a cancelled order is listed, struck through, and not counted)
//   one order    its supplier, date, how the price was given, the total, and its lines: each frame with the quantity, what one cost, and whether the line has
//                set the frame's stock and cost ("used") or waits for the frame's last piece to be sold
// Real data, through window.electronAPI.supplierOrders (src/local/supplierOrderService.ts).
(() => {
  "use strict";

  const api = window.electronAPI.supplierOrders;
  const CURRENCY = "DZD";
  const STATUS = { received: "Received", cancelled: "Cancelled" };

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
  const status = (value) => h("span", { class: `status status--supplier-${value}`, "data-status": value }, STATUS[value] ?? value);

  // ---- State and loading ---------------------------------------------------------------------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // year "" = all years; month "" = the whole year (a month needs a year)
  const state = { id: null, load: "loading", rows: [], years: [], totals: { orders: 0, spentCents: 0, cancelledOrders: 0 }, year: String(new Date().getFullYear()), month: "", order: null, error: "", token: 0 };
  let root = null;

  async function load() {
    const token = ++state.token;
    state.load = "loading";
    render();
    try {
      if (state.id) state.order = await api.get(state.id);
      else {
        const list = await api.list({ ...(state.year ? { year: +state.year } : {}), ...(state.month ? { month: +state.month } : {}) });
        state.rows = list.rows;
        state.years = list.years;
        state.totals = list.totals;
      }
      if (token !== state.token) return;
      state.load = "ready";
    } catch (error) {
      if (token !== state.token) return;
      state.load = "error";
      state.error = errorText(error);
    }
    render();
  }

  // ---- The page ------------------------------------------------------------------------------

  function header() {
    return h(
      "header",
      { class: "page__header" },
      h(
        "div",
        null,
        h("h2", { class: "page__title", id: "supplier-orders-title" }, "Supplier orders"),
        h("p", { class: "page__description" }, "The frames and accessories you order from your suppliers to restock the shop. Lens orders stay with the customer's order: they are sent to the lab from the order itself."),
      ),
      h("button", { class: "btn btn--primary", type: "button", id: "new-supplier-order", onclick: () => window.openSupplierOrderForm?.() }, icon("plus"), "New supplier order"),
    );
  }

  function problem(title) {
    return h("div", { class: "state state--error", role: "alert", "data-state": "error" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, title), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again"));
  }

  function listCard() {
    if (state.load === "loading") return h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the orders…"));
    if (state.load === "error") return problem("The supplier orders couldn't be loaded");
    if (state.rows.length === 0 && state.years.length > 0) {
      // orders exist, but none in this period
      return h(
        "div",
        { class: "state", "data-state": "empty-period" },
        h("span", { class: "state__icon" }, icon("inventory")),
        h("h3", { class: "state__title" }, "No order in this period"),
        h("p", { class: "state__text" }, "Nothing was ordered from your suppliers in this period."),
        h("button", { class: "btn btn--secondary", type: "button", onclick: () => { state.year = ""; state.month = ""; load(); } }, "Show all orders"),
      );
    }
    if (state.rows.length === 0) {
      return h(
        "div",
        { class: "state", "data-state": "empty" },
        h("span", { class: "state__icon" }, icon("inventory")),
        h("h3", { class: "state__title" }, "No frame or accessory order yet"),
        h("p", { class: "state__text" }, "Orders placed with your frame and accessory suppliers will be listed here, newest first."),
      );
    }
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table sales-table", "data-list": "" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Supplier"), h("th", { scope: "col", class: "sales-money" }, "Items"), h("th", { scope: "col", class: "sales-money" }, "Quantity"), h("th", { scope: "col", class: "sales-money" }, "Total"), h("th", { scope: "col" }, "Status"))),
        h(
          "tbody",
          null,
          state.rows.map((o) =>
            h(
              "tr",
              { "data-id": o.id, "data-status": o.status, "data-href": `supplier-orders/${encodeURIComponent(o.id)}`, class: o.status === "cancelled" ? "sales-row--cancelled" : null },
              h("td", null, h("a", { class: "cell-name__text sales-order-link", "data-cell": "date", href: `#supplier-orders/${encodeURIComponent(o.id)}` }, formatDay(o.orderedAt))),
              h("td", { "data-cell": "supplier" }, o.supplierName),
              h("td", { class: "sales-money", "data-cell": "frames" }, String(o.products)),
              h("td", { class: "sales-money", "data-cell": "quantity" }, String(o.quantity)),
              h("td", { class: "sales-money", "data-cell": "total" }, money(o.totalCents)),
              h("td", null, status(o.status)),
            ),
          ),
        ),
      ),
    );
  }

  /** The year and the month to look at, and what the period holds: the number of orders and what was spent on them. */
  function periodBar() {
    const years = [...new Set([...state.years, new Date().getFullYear(), ...(state.year ? [+state.year] : [])])].sort((a, b) => b - a);
    const pick = (name, label, first, options, value, onchange) => {
      const el = h("select", { class: "sales-period__select", "aria-label": label, "data-period": name }, h("option", { value: "" }, first), options.map(([v, text]) => h("option", { value: String(v) }, text)));
      el.value = value;
      el.addEventListener("change", () => onchange(el.value));
      return el;
    };
    const year = pick("year", "Year", "All years", years.map((y) => [y, String(y)]), state.year, (v) => { state.year = v; if (!v) state.month = ""; load(); });
    const month = pick("month", "Month", "Whole year", MONTHS.map((m, i) => [i + 1, m]), state.month, (v) => { state.month = v; load(); });
    month.disabled = !state.year;
    const t = state.totals;
    const ready = state.load === "ready";
    const tile = (key, label, value, note) => h("div", { class: "summary__tile", "data-tile": key }, h("span", { class: "summary__label" }, label), h("span", { class: "summary__value" }, value), note ? h("span", { class: "summary__note", "data-note": key }, note) : null);
    return h(
      "div",
      { "data-period-bar": "" },
      h("div", { class: "sales-period", role: "group", "aria-label": "Period" }, year, month),
      h(
        "div",
        { class: "summary", "data-summary": "" },
        tile("orders", "Orders", ready ? String(t.orders) : "—"),
        tile("spent", "Total spent", ready ? money(t.spentCents) : "—", ready && t.cancelledOrders > 0 ? `${t.cancelledOrders} cancelled ${t.cancelledOrders === 1 ? "order is" : "orders are"} not counted` : null),
      ),
    );
  }

  function detailsCard() {
    if (state.load === "loading") return h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the order…"));
    if (state.load === "error") return problem("The order couldn't be opened");
    const o = state.order;
    const fact = (key, label, value) => h("div", { class: "order-summary__row" }, h("dt", null, label), h("dd", { "data-field": key }, value));
    return h(
      "div",
      { "data-details": o.id },
      h(
        "dl",
        { class: "order-summary" },
        fact("supplier", "Supplier", o.supplierName),
        fact("date", "Date", formatDay(o.orderedAt)),
        fact("mode", "How the price was given", o.priceMode === "batch" ? "Price of the whole batch" : "Price per item"),
        fact("total", "Total", money(o.totalCents)),
        fact("status", "Status", status(o.status)),
      ),
      o.notes ? h("p", { class: "field__help", "data-notes": "" }, o.notes) : null,
      h(
        "div",
        { class: "table-scroll" },
        h(
          "table",
          { class: "table sales-table", "data-lines": "" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, "Item"), h("th", { scope: "col", class: "sales-money" }, "Quantity"), h("th", { scope: "col", class: "sales-money" }, "Cost of one"), h("th", { scope: "col", class: "sales-money" }, "Total"), h("th", { scope: "col" }, "Stock"))),
          h(
            "tbody",
            null,
            o.lines.map((l) =>
              h(
                "tr",
                { "data-line": l.id, "data-used": String(l.used) },
                h("td", null, h("div", { class: "cell-name__stack" }, h("span", { class: "cell-name__text", "data-cell": "name" }, l.name), l.code ? h("span", { class: "cell-name__sub", "data-cell": "code" }, l.code) : null)),
                h("td", { class: "sales-money", "data-cell": "quantity" }, String(l.quantity)),
                h("td", { class: "sales-money", "data-cell": "unit" }, money(l.unitCostCents)),
                h("td", { class: "sales-money", "data-cell": "total" }, money(l.totalCents)),
                h("td", { "data-cell": "used" }, h("span", { class: "lens-tag" }, l.used ? "Set the stock and the cost" : "Waiting for the last piece to be sold")),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function render() {
    if (!root) return;
    root.replaceChildren(header());
    if (state.id) {
      root.append(h("a", { class: "od-back", href: "#supplier-orders" }, icon("arrow-left"), "Supplier orders"));
      root.append(h("div", { class: "table-card", "data-supplier-order": "" }, detailsCard()));
    } else {
      root.append(periodBar(), h("div", { class: "table-card", "data-supplier-orders": "" }, listCard()));
    }
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const match = /^supplier-orders(?:\/([^/]+))?$/.exec(location.hash.slice(1));
    if (match) {
      if (!root) {
        root = h("section", { class: "page", "aria-labelledby": "supplier-orders-title", "data-supplier-orders-page": "" });
        content.replaceChildren(root);
      }
      state.id = match[1] ? decodeURIComponent(match[1]) : null;
      state.order = null;
      load(); // read again each time the page is opened
    } else if (root) {
      root.remove();
      root = null;
      state.token++;
    }
  }

  // an order was just placed (the form says so): the list reads again
  window.addEventListener("supplier-orders-changed", () => {
    if (root) load();
  });
  window.addEventListener("hashchange", route);
  route();
})();
