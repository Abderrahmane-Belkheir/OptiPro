// The Reports page (#reports): how the shop is doing over a period. Read-only, real data, read through window.electronAPI.reports (src/local/reportsService.ts).
//   A period (a month, a year, or everything) chosen with the shortcuts or the two lists, and for it:
//     the headline figures (sales, money collected, net profit, bought from suppliers, average order, discounts), each compared with the period before;
//     a chart of what was sold and what was received (per day, per month or per year); the sales by kind and the best sellers; the orders by status;
//     the best customers; what was spent with each supplier.
//   Two cards are not about the period but about today: who owes the shop money, and what the stock is worth. Each loads by itself.
// Money is in cents. "Sold" is what the orders placed in the period are worth; "received" is the money that reached the shop in the period (a cheque on the day it falls due).
(() => {
  "use strict";

  const api = window.electronAPI.reports;
  const CURRENCY = "DZD";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const STATUSES = [
    ["confirmed", "Confirmed"],
    ["at_lab", "At the lab"],
    ["ready", "Ready"],
    ["delivered", "Delivered"],
    ["cancelled", "Cancelled"],
  ];
  const KIND_LABEL = { frame: "Frames", lens: "Lenses", accessory: "Accessories", service: "Services" };

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
  const dayFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
  const monthLongFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" });
  const monthShortFormat = new Intl.DateTimeFormat(undefined, { month: "short" });
  const moneyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const compactFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, notation: "compact", maximumFractionDigits: 1 });
  const money = (cents) => moneyFormat.format(cents / 100);
  const compact = (cents) => compactFormat.format(cents / 100);
  const orders = (n) => (n === 1 ? "1 order" : `${n} orders`);
  const supplierOrders = (n) => (n === 1 ? "1 supplier order" : `${n} supplier orders`);
  const empty = (text) => h("p", { class: "rep-empty" }, text);

  // ---- State and loading ---------------------------------------------------------------------

  // The page opens on the current month, compared with the same days of the month before.
  const current = () => { const n = new Date(); return { year: String(n.getFullYear()), month: String(n.getMonth() + 1) }; };
  const state = { ...current(), load: "loading", data: null, error: "", token: 0 };
  let root = null;
  let refs = null;

  async function load() {
    const token = ++state.token;
    state.load = state.data ? "refreshing" : "loading";
    render();
    try {
      const data = await api.overview({ ...(state.year ? { year: +state.year } : {}), ...(state.month ? { month: +state.month } : {}) });
      if (token !== state.token) return;
      state.data = data;
      state.load = "ready";
    } catch (error) {
      if (token !== state.token) return;
      state.load = "error";
      state.error = errorText(error);
    }
    render();
  }

  function choose(period) {
    Object.assign(state, period);
    load();
  }

  // ---- The period ----------------------------------------------------------------------------

  const PRESETS = [
    ["this-month", "This month", () => current()],
    ["last-month", "Last month", () => { const d = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1); return { year: String(d.getFullYear()), month: String(d.getMonth() + 1) }; }],
    ["this-year", "This year", () => ({ year: String(new Date().getFullYear()), month: "" })],
    ["all", "All time", () => ({ year: "", month: "" })],
  ];

  function select(name, label, onchange) {
    const el = h("select", { class: "rep-period__select", "aria-label": label, "data-period": name });
    el.addEventListener("change", () => onchange(el.value));
    return el;
  }

  function fillPeriod() {
    const fill = (el, first, options, value) => {
      el.replaceChildren(h("option", { value: "" }, first), ...options.map(([v, text]) => h("option", { value: String(v) }, text)));
      el.value = value;
    };
    const shown = new Set([...(state.data?.years ?? []), new Date().getFullYear(), ...(state.year ? [+state.year] : [])]);
    fill(refs.year, "All years", [...shown].sort((a, b) => b - a).map((y) => [y, String(y)]), state.year);
    fill(refs.month, "Whole year", MONTHS.map((m, i) => [i + 1, m]), state.month);
    refs.month.disabled = !state.year;
    for (const button of refs.presets.children) {
      const preset = PRESETS.find(([key]) => key === button.dataset.preset)[2]();
      button.setAttribute("aria-pressed", String(preset.year === state.year && preset.month === state.month));
    }
  }

  // ---- The headline figures ------------------------------------------------------------------

  /** How much a figure moved from the period before: an arrow, a percentage, and what it is compared with. good: "up" when a rise is good news, null when neither is. */
  function delta(key, now, before, good, label) {
    if (before === null || label === null) return null;
    let body;
    let tone = "flat";
    if (now === before) body = h("span", { class: "rep-delta__text" }, "No change");
    else if (before === 0) body = h("span", { class: "rep-delta__text" }, "Nothing before");
    else {
      const pct = Math.round((Math.abs(now - before) / Math.abs(before)) * 100);
      const up = now > before;
      tone = good === null ? "flat" : up === (good === "up") ? "good" : "bad";
      body = [h("span", { class: "rep-delta__arrow", "aria-hidden": "true" }, up ? "▲" : "▼"), h("span", { class: "rep-delta__pct" }, `${pct}%`)];
    }
    return h("span", { class: `rep-delta rep-delta--${tone}`, "data-delta": key }, body, h("span", { class: "rep-delta__vs" }, label));
  }

  function tiles(data) {
    const c = data.current;
    const p = data.previous;
    const vs = !p ? null : data.previousPartial ? (data.month ? "vs the same days of the month before" : "vs the same days of the year before") : data.month ? "vs the month before" : "vs the year before";
    const profitKnown = c.profitOrders > 0 || c.withoutCostOrders === 0;
    const profitCompare = p && profitKnown && (p.profitOrders > 0 || p.withoutCostOrders === 0);
    const tile = (key, label, value, notes, change, tone) =>
      h("div", { class: `rep-tile${tone ? ` rep-tile--${tone}` : ""}`, "data-tile": key }, h("span", { class: "rep-tile__label" }, label), h("span", { class: "rep-tile__value", "data-value": key }, value), ...notes.filter(Boolean).map((n) => h("span", { class: "rep-tile__note", "data-note": key }, n)), change);
    return h(
      "div",
      { class: "rep-tiles", "data-tiles": "" },
      tile("sales", "Sales", money(c.salesCents), [orders(c.orders), c.cancelledOrders > 0 ? `${c.cancelledOrders} cancelled` : null], delta("sales", c.salesCents, p?.salesCents ?? null, "up", vs)),
      tile("collected", "Money received", money(c.collectedCents), [c.chequesLaterCents > 0 ? `+ ${money(c.chequesLaterCents)} in cheques due later` : "Money that reached the shop"], delta("collected", c.collectedCents, p?.collectedCents ?? null, "up", vs)),
      tile(
        "profit",
        "Net profit",
        profitKnown ? money(c.profitCents) : "—",
        [
          profitKnown && c.marginPercent !== null ? `${c.marginPercent}% of the price` : null,
          c.withoutCostOrders > 0 ? (c.withoutCostOrders === 1 ? "1 order has no known cost and is not counted" : `${c.withoutCostOrders} orders have no known cost and are not counted`) : null,
        ],
        profitCompare ? delta("profit", c.profitCents, p.profitCents, "up", vs) : null,
        profitKnown && c.profitCents < 0 ? "bad" : null,
      ),
      tile("purchases", "Bought from suppliers", money(c.purchasesCents), [supplierOrders(c.purchaseOrders)], delta("purchases", c.purchasesCents, p?.purchasesCents ?? null, null, vs)),
      tile("average", "Average order", money(c.averageOrderCents), ["Per order, after discounts"], delta("average", c.averageOrderCents, p?.averageOrderCents ?? null, "up", vs)),
      tile("discounts", "Discounts given", money(c.discountCents), [c.salesCents > 0 ? `${Math.round((c.discountCents / (c.salesCents + c.discountCents)) * 1000) / 10}% of the prices` : null], delta("discounts", c.discountCents, p?.discountCents ?? null, null, vs)),
    );
  }

  // ---- The chart -----------------------------------------------------------------------------

  /** The name of one point of the chart: a day, a month or a year. */
  function pointName(key, granularity, short) {
    const [y, m, d] = key.split("-").map(Number);
    if (granularity === "day") return short ? String(d) : dayFormat.format(new Date(y, m - 1, d));
    if (granularity === "month") return short ? monthShortFormat.format(new Date(y, m - 1, 1)) : monthLongFormat.format(new Date(y, m - 1, 1));
    return key;
  }

  /** A bar: its height is set through the DOM because the page's content security policy refuses inline style attributes. */
  function bar(kind, share) {
    const el = h("div", { class: `rep-chart__bar rep-chart__bar--${kind}` });
    el.style.height = share > 0 ? `${Math.max(1.5, share * 100)}%` : "0";
    return el;
  }

  function chart(data) {
    const points = data.series;
    const max = Math.max(...points.flatMap((p) => [p.salesCents, p.collectedCents]), 0);
    if (max === 0) return empty("Nothing was sold or received in this period.");
    const sold = points.reduce((s, p) => s + p.salesCents, 0);
    const received = points.reduce((s, p) => s + p.collectedCents, 0);
    const grid = (share) => {
      const line = h("div", { class: "rep-chart__grid" }, h("span", { class: "rep-chart__scale" }, share === 0 ? "0" : compact(max * share)));
      line.style.bottom = `${share * 100}%`;
      return line;
    };
    const columns = h("div", { class: "rep-chart__cols", style: null });
    columns.style.gridTemplateColumns = `repeat(${points.length}, minmax(0, 1fr))`;
    const labels = h("div", { class: "rep-chart__labels", "aria-hidden": "true" });
    labels.style.gridTemplateColumns = columns.style.gridTemplateColumns;
    const sparse = data.granularity === "day";
    points.forEach((p, i) => {
      columns.append(h("div", { class: "rep-chart__col", "data-point": p.key, title: `${pointName(p.key, data.granularity, false)}: sold ${money(p.salesCents)} · received ${money(p.collectedCents)}` }, bar("sold", p.salesCents / max), bar("received", p.collectedCents / max)));
      labels.append(h("span", { class: "rep-chart__label" }, !sparse || i % 2 === 0 || points.length <= 16 ? pointName(p.key, data.granularity, true) : ""));
    });
    return h(
      "div",
      { class: "rep-chart", "data-chart": data.granularity },
      h("div", { class: "rep-chart__legend" }, h("span", { class: "rep-legend rep-legend--sold" }, "Sold"), h("span", { class: "rep-legend rep-legend--received" }, "Money received")),
      h("div", { class: "rep-chart__plot", role: "img", "aria-label": `Sold ${money(sold)}, received ${money(received)}` }, grid(0), grid(0.5), grid(1), columns),
      labels,
    );
  }

  // ---- The tables ----------------------------------------------------------------------------

  function card(id, title, hint, ...body) {
    return h("section", { class: "dash-card rep-card", "data-section": id, "aria-labelledby": `rep-${id}` }, h("div", { class: "dash-card__head" }, h("h3", { class: "dash-card__title", id: `rep-${id}` }, title), hint ? h("span", { class: "dash-card__hint" }, hint) : null), h("div", { class: "dash-card__body" }, ...body));
  }

  function table(name, heads, rows) {
    return h(
      "div",
      { class: "table-scroll" },
      h("table", { class: "rep-table", "data-table": name }, h("thead", null, h("tr", null, heads.map(([label, num]) => h("th", { scope: "col", class: num ? "rep-num" : null }, label)))), h("tbody", null, rows)),
    );
  }

  const profitCell = (profit, unknownLines) =>
    h("td", { class: `rep-num${profit !== null && profit < 0 ? " rep-num--bad" : ""}`, "data-cell": "profit" }, profit === null ? "—" : money(profit), unknownLines > 0 ? h("span", { class: "rep-sub" }, `${unknownLines} without known cost`) : null);

  function kindsCard(data) {
    return card(
      "kinds",
      "Sales by type",
      null,
      data.byKind.length === 0
        ? empty("No sale in this period.")
        : [
            table("kinds", [["Type"], ["Pieces", true], ["Sold", true], ["Profit", true]], data.byKind.map((r) => h("tr", { "data-kind": r.kind }, h("td", null, KIND_LABEL[r.kind] ?? r.kind), h("td", { class: "rep-num", "data-cell": "pieces" }, String(r.quantity)), h("td", { class: "rep-num", "data-cell": "sold" }, money(r.revenueCents)), profitCell(r.profitCents, r.unknownCostLines)))),
            h("p", { class: "rep-footnote" }, "Sold is the price of the lines, before the discount of the order."),
          ],
    );
  }

  function statusesCard(data) {
    const max = Math.max(...Object.values(data.statuses), 0);
    return card(
      "statuses",
      "Orders by status",
      null,
      max === 0
        ? empty("No order in this period.")
        : h(
            "div",
            { class: "rep-bars" },
            STATUSES.map(([key, label]) => {
              const fill = h("span", { class: `rep-bars__fill rep-bars__fill--${key}` });
              fill.style.width = `${(data.statuses[key] / max) * 100}%`;
              return h("div", { class: "rep-bars__row", "data-status": key }, h("span", { class: "rep-bars__label" }, label), h("span", { class: "rep-bars__track" }, fill), h("span", { class: "rep-bars__count", "data-count": key }, String(data.statuses[key])));
            }),
          ),
    );
  }

  function productsCard(data) {
    return card(
      "products",
      "Best sellers",
      "by what they brought in",
      data.topProducts.length === 0
        ? empty("No sale in this period.")
        : table("products", [["Product"], ["Type"], ["Pieces", true], ["Sold", true], ["Profit", true]], data.topProducts.map((r) => h("tr", { "data-product": r.name }, h("td", { class: "rep-wrap" }, r.name), h("td", { class: "rep-muted" }, KIND_LABEL[r.kind] ?? r.kind), h("td", { class: "rep-num" }, String(r.quantity)), h("td", { class: "rep-num" }, money(r.revenueCents)), profitCell(r.profitCents, 0)))),
    );
  }

  function customersCard(data) {
    return card(
      "customers",
      "Best customers",
      "by what they ordered",
      data.topCustomers.length === 0
        ? empty("No customer ordered in this period.")
        : table("customers", [["Customer"], ["Orders", true], ["Ordered", true]], data.topCustomers.map((r) => h("tr", { "data-customer": r.customerId }, h("td", { class: "rep-wrap" }, h("a", { class: "rep-link", href: `#customers/${encodeURIComponent(r.customerId)}` }, r.customerName)), h("td", { class: "rep-num" }, String(r.orders)), h("td", { class: "rep-num" }, money(r.valueCents))))),
    );
  }

  function suppliersCard(data) {
    return card(
      "suppliers",
      "Bought from suppliers",
      null,
      data.suppliers.length === 0
        ? empty("Nothing was bought from a supplier in this period.")
        : table("suppliers", [["Supplier"], ["Orders", true], ["Spent", true]], data.suppliers.map((r) => h("tr", { "data-supplier": r.supplierId }, h("td", { class: "rep-wrap" }, r.supplierName), h("td", { class: "rep-num" }, String(r.orders)), h("td", { class: "rep-num" }, money(r.spentCents))))),
    );
  }

  // ---- The two cards about today -------------------------------------------------------------

  /** A card whose content loads by itself: when it fails it says why and offers "Try again", and the rest of the page stays. */
  function today(id, title, hint, read, fill) {
    const body = h("div", { class: "dash-card__body" });
    const el = h("section", { class: "dash-card rep-card", "data-section": id, "aria-labelledby": `rep-${id}` }, h("div", { class: "dash-card__head" }, h("h3", { class: "dash-card__title", id: `rep-${id}` }, title), h("span", { class: "dash-card__hint" }, hint)), body);
    let token = 0;
    async function run() {
      const mine = ++token;
      el.dataset.status = "loading";
      body.replaceChildren(empty("Loading…"));
      try {
        const data = await read();
        if (mine !== token) return;
        el.dataset.status = "ready";
        body.replaceChildren(...[fill(data)].flat().filter(Boolean));
      } catch (error) {
        if (mine !== token) return;
        el.dataset.status = "error";
        body.replaceChildren(h("div", { class: "dash-error", role: "alert" }, h("p", null, `Couldn't load this: ${errorText(error)}`), h("button", { class: "btn btn--secondary", type: "button", onclick: run }, "Try again")));
      }
    }
    run();
    return el;
  }

  function debtorsCard() {
    return today("debtors", "Who owes the shop", "today", () => api.debtors(), (d) => [
      h("div", { class: "rep-owed", "data-owed": "" }, h("span", { class: `rep-owed__value${d.owedCents > 0 ? " rep-num--bad" : ""}`, "data-value": "owed" }, money(d.owedCents)), d.orders === 0 ? h("span", { class: "rep-tile__note" }, "Every order is paid.") : [h("span", { class: "rep-tile__note" }, d.orders === 1 ? "1 order is not fully paid" : `${d.orders} orders are not fully paid`), h("span", { class: "rep-tile__note" }, d.customers === 1 ? "1 customer owes it" : `${d.customers} customers owe it`)]),
      d.rows.length === 0
        ? null
        : h("div", { class: "dash-rows", "data-debtors": "" }, d.rows.map((r) => h("a", { class: "dash-row", href: r.customerId ? `#customers/${encodeURIComponent(r.customerId)}` : "#orders", "data-debtor": r.customerId ?? "" }, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, r.customerName), h("span", { class: "dash-row__sub" }, h("span", null, orders(r.orders)), r.since ? [" · ", h("span", null, `since ${dayFormat.format(new Date(r.since))}`)] : null)), h("span", { class: "dash-row__amount dash-row__amount--due" }, money(r.owedCents))))),
    ]);
  }

  function stockCard() {
    return today("stock", "Value of the stock", "today", () => api.inventory(), (s) => [
      table("stock", [["Type"], ["In stock", true], ["Pieces", true], ["At cost", true], ["At selling price", true]], [
        ["frames", "Frames", s.frames],
        ["accessories", "Accessories", s.accessories],
        ["total", "Total", s.total],
      ].map(([key, label, r]) => h("tr", { "data-stock": key, class: key === "total" ? "rep-total" : null }, h("td", null, label), h("td", { class: "rep-num" }, String(r.products)), h("td", { class: "rep-num" }, String(r.units)), h("td", { class: "rep-num", "data-cell": "cost" }, money(r.costValueCents)), h("td", { class: "rep-num", "data-cell": "price" }, money(r.priceValueCents))))),
      s.total.withoutCost > 0 ? h("p", { class: "rep-footnote", "data-nocost": "" }, s.total.withoutCost === 1 ? "1 product in stock has no cost entered and is not in the value at cost." : `${s.total.withoutCost} products in stock have no cost entered and are not in the value at cost.`) : null,
      s.frames.outOfStock + s.accessories.outOfStock > 0 ? h("p", { class: "rep-footnote", "data-outofstock": "" }, s.frames.outOfStock + s.accessories.outOfStock === 1 ? "1 product is out of stock." : `${s.frames.outOfStock + s.accessories.outOfStock} products are out of stock.`) : null,
    ]);
  }

  // ---- The page ------------------------------------------------------------------------------

  function build() {
    refs = {
      presets: h("div", { class: "chips rep-presets", role: "group", "aria-label": "Period shortcuts", "data-presets": "" }, PRESETS.map(([key, label, period]) => h("button", { class: "chip", type: "button", "data-preset": key, "aria-pressed": "false", onclick: () => choose(period()) }, h("span", null, label)))),
      year: select("year", "Year", (v) => choose({ year: v, month: v ? state.month : "" })),
      month: select("month", "Month", (v) => choose({ month: v })),
      body: h("div", { class: "rep-body", "data-reports": "" }),
    };
    return h(
      "section",
      { class: "page rep", "aria-labelledby": "reports-title" },
      h("header", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", id: "reports-title" }, "Reports"), h("p", { class: "page__description" }, "How the shop is doing: what was sold, what was received, what it earned."))),
      h("div", { class: "toolbar rep-toolbar" }, refs.presets, h("div", { class: "rep-period", role: "group", "aria-label": "Period" }, refs.year, refs.month)),
      refs.body,
      h("div", { class: "rep-today" }, debtorsCard(), stockCard()),
    );
  }

  function periodName(data) {
    if (data.month) return monthLongFormat.format(new Date(data.year, data.month - 1, 1));
    return data.year ? String(data.year) : "All time";
  }

  function render() {
    if (!root) return;
    fillPeriod();
    const data = state.data;
    refs.body.dataset.status = state.load;
    refs.body.setAttribute("aria-busy", String(state.load === "loading" || state.load === "refreshing"));
    if (!data && state.load === "error") {
      return refs.body.replaceChildren(h("div", { class: "state state--error", role: "alert" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, "The report couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
    }
    if (!data) return refs.body.replaceChildren(h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the report…")));
    refs.body.replaceChildren(
      ...(state.load === "error" ? [h("p", { class: "field__error", role: "alert", "data-error": "" }, state.error)] : []),
      h("h3", { class: "rep-period-name", "data-period-name": "" }, periodName(data)),
      tiles(data),
      card("chart", data.granularity === "day" ? "Sold and received, day by day" : data.granularity === "month" ? "Sold and received, month by month" : "Sold and received, year by year", null, chart(data)),
      h("div", { class: "rep-grid" }, kindsCard(data), statusesCard(data), productsCard(data), customersCard(data), suppliersCard(data)),
    );
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const page = (location.hash.slice(1) || "dashboard").split("/")[0];
    if (page === "reports") {
      if (root?.isConnected) return;
      Object.assign(state, current(), { data: null, load: "loading", error: "" });
      root = build();
      content.replaceChildren(root);
      load(); // read again each time the page is opened
    } else if (root) {
      root.remove();
      root = null;
      state.token++;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
