// The Dashboard page: how the shop is doing this month, and what needs following up. Reads from window.electronAPI.dashboard (src/local/dashboardService.ts), which answers
// from the local database.
//
//   window.dashboardData   <- the page calls nothing else. Four functions, described below.
//
// Each section of the page loads by itself, so one that fails shows its own "Try again" and the others stay. Money is in cents and dates are ISO strings, like everywhere
// else in the app. Every customer and every order shown is a link to its page.
(() => {
  "use strict";

  const CURRENCY = "DZD";

  // ==============================================================================================
  // THE WIRING POINT
  // ==============================================================================================
  //
  // Shapes (all promises):
  //   month()            -> { year, month, orders, salesCents, purchasesCents, purchaseOrders, profitCents, collectedProfitCents, toCollectCents,
  //                           profitOrders, withoutCostOrders }
  //                         the CURRENT MONTH: orders placed (cancelled ones not counted) and what they are worth; what was spent with the suppliers (frames and
  //                         accessories); the profit of those orders, in all (profitCents, collected or not) and the part already collected (collectedProfitCents:
  //                         what the customers paid on them minus their costs); toCollectCents = what is still to collect of it.
  //                         The profit leaves out the orders whose cost is not known (withoutCostOrders), and says so.
  //   owed()             -> { owedCents, orders, customers, rows: { customerId|null, customerName, orders, owedCents, since|null }[] }
  //                         what customers owe, since the start (every order that is not cancelled and not fully paid); rows = the biggest debts first.
  //   ready()            -> { count, remainingCents, rows: { id, number, customerId|null, customerName, promisedAt|null, remainingCents }[] }
  //                         every order that is ready and not yet collected, whatever its month.
  //   recentCustomers()  -> { id, name, createdAt }[]   (the 5 newest)

  const dashboardData = {
    month: () => window.electronAPI.dashboard.month(),
    owed: () => window.electronAPI.dashboard.owed(),
    ready: () => window.electronAPI.dashboard.ready(),
    recentCustomers: () => window.electronAPI.dashboard.recentCustomers(),
  };
  window.dashboardData = dashboardData;

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
  const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const formatDay = (iso) => dayFormat.format(new Date(iso));
  const moneyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const money = (cents) => moneyFormat.format(cents / 100);
  const orders = (n) => (n === 1 ? "1 order" : `${n} orders`);
  const supplierOrders = (n) => (n === 1 ? "1 supplier order" : `${n} supplier orders`);

  /**
   * A card whose content loads by itself: `load()` answers the data, `fill(data)` returns the nodes to show. While it
   * loads there is a line of text; when it fails the card says why and offers "Try again". Nothing else on the page is affected.
   */
  function section({ id, title, hint, wide }, load, fill) {
    const body = h("div", { class: "dash-card__body" });
    const card = h("section", { class: `dash-card${wide ? " dash-card--wide" : ""}`, "data-section": id, "aria-labelledby": `dash-${id}` }, h("div", { class: "dash-card__head" }, h("h3", { class: "dash-card__title", id: `dash-${id}` }, title), hint ? h("span", { class: "dash-card__hint" }, hint) : null), body);
    let token = 0;
    async function run() {
      const mine = ++token;
      card.dataset.status = "loading";
      body.replaceChildren(h("p", { class: "dash-empty" }, "Loading…"));
      try {
        const data = await load();
        if (mine !== token || (!card.isConnected && !body.isConnected)) return;
        card.dataset.status = "ready";
        body.replaceChildren(...[fill(data)].flat().filter(Boolean));
      } catch (error) {
        if (mine !== token) return;
        card.dataset.status = "error";
        body.replaceChildren(h("div", { class: "dash-error", role: "alert" }, h("p", null, `Couldn't load this: ${errorText(error)}`), h("button", { class: "btn btn--secondary", type: "button", onclick: run }, "Try again")));
      }
    }
    run();
    return card;
  }

  const empty = (text) => h("p", { class: "dash-empty" }, text);
  const customerHref = (customerId) => (customerId ? `#customers/${encodeURIComponent(customerId)}` : "#orders");

  // ---- The month ---------------------------------------------------------------------------------

  function monthStrip() {
    const tile = (key, label, value, tone, href, notes) => h("a", { class: `dash-tile${tone ? ` dash-tile--${tone}` : ""}`, href, "data-tile": key }, h("span", { class: "dash-tile__label" }, label), h("span", { class: "dash-tile__value", "data-value": key }, value), ...notes.filter(Boolean).map((n) => h("span", { class: "dash-tile__sub", "data-sub": key }, n)));
    const unknown = (n) => (n === 0 ? null : n === 1 ? "1 order has no known cost and is not counted" : `${n} orders have no known cost and are not counted`);
    const el = section({ id: "month-numbers", title: "This month" }, () => dashboardData.month(), (m) => {
      const known = m.profitOrders > 0 || m.withoutCostOrders === 0;
      return h(
        "div",
        { class: "dash-tiles", "data-month": `${m.year}-${m.month}` },
        tile("orders", "Orders", String(m.orders), null, "#orders", ["Placed this month"]),
        tile("sales", "Value of orders", money(m.salesCents), null, "#orders", ["What the orders of this month are worth"]),
        tile("purchases", "Spent on suppliers", money(m.purchasesCents), null, "#supplier-orders", [supplierOrders(m.purchaseOrders), "Frames and accessories"]),
        tile("profit", "Profit this month", known ? money(m.profitCents) : "—", known && m.profitCents < 0 ? "due" : null, "#orders", ["Collected or not yet", unknown(m.withoutCostOrders)]),
        tile("collected", "Profit collected", known ? money(m.collectedProfitCents) : "—", known && m.collectedProfitCents < 0 ? "due" : null, "#payments", [known ? (m.toCollectCents > 0 ? `${money(m.toCollectCents)} still to collect` : "All of it is collected") : null, "Payments received minus costs"]),
      );
    });
    el.classList.add("dash-card--plain");
    return el;
  }

  // ---- What needs following up ------------------------------------------------------------------

  function owedSection() {
    return section({ id: "owed", title: "Customers who owe you", hint: "all orders, since the start", wide: true }, () => dashboardData.owed(), (o) => [
      h("div", { class: "dash-owed" }, h("span", { class: `dash-owed__value${o.owedCents > 0 ? " dash-row__amount--due" : ""}`, "data-value": "owed" }, money(o.owedCents)), o.orders === 0 ? h("span", { class: "dash-tile__sub" }, "Every order is paid.") : [h("span", { class: "dash-tile__sub" }, o.orders === 1 ? "1 order is not fully paid" : `${o.orders} orders are not fully paid`), h("span", { class: "dash-tile__sub" }, o.customers === 1 ? "1 customer owes it" : `${o.customers} customers owe it`)]),
      o.rows.length === 0
        ? null
        : h("div", { class: "dash-rows", "data-debtors": "" }, o.rows.map((r) => h("a", { class: "dash-row", href: customerHref(r.customerId), "data-debtor": r.customerId ?? "" }, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, r.customerName), h("span", { class: "dash-row__sub" }, h("span", null, orders(r.orders)), r.since ? [" · ", h("span", null, `since ${formatDay(r.since)}`)] : null)), h("span", { class: "dash-row__amount dash-row__amount--due" }, money(r.owedCents))))),
    ]);
  }

  function readySection() {
    return section({ id: "ready", title: "Ready, waiting for the customer", hint: "all months", wide: true }, () => dashboardData.ready(), (r) => [
      h("div", { class: "dash-owed" }, h("span", { class: "dash-owed__value", "data-value": "ready" }, String(r.count)), r.count === 0 ? h("span", { class: "dash-tile__sub" }, "Nothing waiting to be picked up.") : h("span", { class: "dash-tile__sub" }, `${money(r.remainingCents)} left to pay`)),
      r.rows.length === 0
        ? null
        : h("div", { class: "dash-rows", "data-ready": "" }, r.rows.map((o) => h("a", { class: "dash-row", href: `#orders/${encodeURIComponent(o.id)}`, "data-ready-order": o.id }, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, o.customerName), h("span", { class: "dash-row__sub" }, h("span", null, o.number), o.promisedAt ? [" · ", h("span", null, `promised ${formatDay(o.promisedAt)}`)] : null)), h("span", { class: `dash-row__amount${o.remainingCents > 0 ? " dash-row__amount--due" : ""}` }, o.remainingCents > 0 ? `${money(o.remainingCents)} left` : "Paid")))),
    ]);
  }

  function customersSection() {
    return section({ id: "customers", title: "Latest customers" }, () => dashboardData.recentCustomers(), (list) =>
      list.length ? h("div", { class: "dash-rows", "data-latest": "" }, list.map((c) => h("a", { class: "dash-row", href: customerHref(c.id), "data-latest-customer": c.id }, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, c.name), h("span", { class: "dash-row__sub" }, `added ${formatDay(c.createdAt)}`))))) : empty("No customer yet."),
    );
  }

  // ---- The page -------------------------------------------------------------------------------

  function build() {
    const action = (label, href, iconName, primary) => h("a", { class: `btn ${primary ? "btn--primary" : "btn--secondary"}`, href, "data-action": label }, icon(iconName), label);
    return h(
      "section",
      { class: "page dash", "aria-label": "Dashboard" },
      h("div", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", "data-month-name": "", translate: "no" }, new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date())), h("p", { class: "page__description" }, "How the shop is doing this month")), h("div", { class: "dash-actions" }, action("New customer", "#customers", "customers", true), action("New frame", "#inventory/frames", "glasses"))),
      monthStrip(),
      h("div", { class: "dash-grid" }, owedSection(), readySection(), h("div", { class: "dash-side" }, customersSection())),
    );
  }

  let root = null;
  function route() {
    const content = document.getElementById("content");
    const page = (location.hash.slice(1) || "dashboard").split("/")[0];
    if (page === "dashboard") {
      if (root?.isConnected) return;
      root = build();
      content.replaceChildren(root);
    } else if (root) {
      root.remove();
      root = null;
    }
  }
  window.addEventListener("hashchange", route);
  route();
})();
