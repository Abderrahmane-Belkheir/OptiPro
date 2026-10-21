// The Dashboard page: what needs attention today. Reads from window.electronAPI.dashboard (src/local/dashboardService.ts), which answers from the local database.
//
//   window.dashboardData   <- the page calls nothing else. Six functions, described below.
//
// Each section of the page loads by itself, so one that fails shows its own "Try again" and the others stay.
// Money is in cents and dates are ISO strings, like everywhere else in the app.
(() => {
  "use strict";

  const CURRENCY = "DZD";
  /** A product with fewer units than this is listed as low on stock. */
  const LOW_STOCK_BELOW = 3;
  const SALES_DAYS = 14;

  // ==============================================================================================
  // THE WIRING POINT
  // ==============================================================================================
  //
  // Shapes (all promises):
  //   today()            -> { collectedCents, chequesLaterCents, advanceCents, pendingRemainingCents, pendingOrders, owedCents, owedOrders, toDeliverCount }
  //                         collected = money received today, without the cheques recorded today that fall due after today (chequesLater);
  //                         advance = paid so far, on any day, on the orders not yet delivered (confirmed, at the lab, ready), with what is
  //                         still to pay on them (pendingRemaining) and how many they are (pendingOrders);
  //                         owed = what is left to pay on delivered orders, over owedOrders orders; cancelled orders are in none of them;
  //                         toDeliverCount = orders promised today or earlier that are not delivered or cancelled.
  //   attention()        -> { late: Order[], cheques: Cheque[] }
  //                         Order  = { id, number, customerId|null, customerName, promisedAt|null, deliveredAt|null, remainingCents }
  //                         Cheque = { id, customerId, customerName, amountCents, dueAt }
  //                         late = confirmed or at the lab and promised within 3 days or already past;
  //                         cheques = payments by cheque falling due in the next 7 days.
  //   stages()           -> { ready: Order[], atLab: Order[], pickedUp: Order[] }   (three separate stages: an order is in one of them)
  //                         ready = made and waiting for the customer (status "ready"); atLab = every order at the lab;
  //                         pickedUp = delivered in the last 7 days, newest first.
  //   lowStock(below)    -> { id, kind: "frame" | "accessory", name, stock }[]   (stock < below, fewest first)
  //   recentCustomers()  -> { id, name, createdAt }[]   (the 5 newest)
  //   syncStatus()       -> { lastSyncedAt: string|null, unsyncedCount, reachable: boolean }
  //   salesByDay(days)   -> { day: "YYYY-MM-DD", totalCents }[]   (oldest first, one entry per day, 0 when no sale)

  const dashboardData = {
    today: () => window.electronAPI.dashboard.today(),
    attention: () => window.electronAPI.dashboard.attention(),
    stages: () => window.electronAPI.dashboard.stages(),
    lowStock: (below) => window.electronAPI.dashboard.lowStock(below),
    recentCustomers: () => window.electronAPI.dashboard.recentCustomers(),
    syncStatus: () => window.electronAPI.dashboard.syncStatus(),
    salesByDay: (days) => window.electronAPI.dashboard.salesByDay(days),
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
  const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  const formatDay = (iso) => dayFormat.format(new Date(iso));
  const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
  const moneyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 0 });
  const money = (cents) => moneyFormat.format(cents / 100);

  function ago(iso) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  }

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
        if (mine !== token || !card.isConnected && !body.isConnected) return;
        card.dataset.status = "ready";
        body.replaceChildren(...[fill(data)].flat());
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
  /** A row that opens the customer; an order with no customer (a walk-in) opens the sales page instead. */
  const customerLink = (customerId, ...children) => h("a", { class: "dash-row", href: customerId ? `#customers/${encodeURIComponent(customerId)}` : "#orders" }, ...children);

  // ---- The sections ----------------------------------------------------------------------------

  function todayStrip() {
    const strip = h("div", { class: "dash-today", "data-section": "today" });
    const tile = (key, label, value, tone, href, sub) => h("a", { class: `dash-tile${tone ? ` dash-tile--${tone}` : ""}`, href, "data-tile": key }, h("span", { class: "dash-tile__label" }, label), h("span", { class: "dash-tile__value" }, value), sub ? h("span", { class: "dash-tile__sub", "data-sub": key }, sub) : null);
    const sectionEl = section({ id: "today-numbers", title: "Today" }, () => dashboardData.today(), (t) =>
      h("div", { class: "dash-tiles" }, tile("collected", "Paid today", money(t.collectedCents), null, "#orders", t.chequesLaterCents > 0 ? `+ ${money(t.chequesLaterCents)} in cheques due later` : "Money received today"), tile("advance", "Paid along the way", money(t.advanceCents), null, "#sales", t.pendingOrders > 0 ? `${money(t.pendingRemainingCents)} still to pay on ${t.pendingOrders} order${t.pendingOrders === 1 ? "" : "s"} not delivered` : "No order waiting to be delivered"), tile("owed", "Owed", money(t.owedCents), t.owedCents > 0 ? "due" : null, "#customers", t.owedOrders > 0 ? `${t.owedOrders} delivered order${t.owedOrders === 1 ? "" : "s"} not fully paid` : "Every delivered order is paid"), tile("deliver", "To deliver", String(t.toDeliverCount), t.toDeliverCount > 0 ? "attention" : null, "#sales", "Promised today or earlier")),
    );
    sectionEl.classList.add("dash-card--plain");
    strip.append(sectionEl);
    return strip;
  }

  function orderRow(order, note) {
    return customerLink(order.customerId, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, order.customerName), h("span", { class: "dash-row__sub" }, `${order.number}${order.deliveredAt ? ` · picked up ${formatDay(order.deliveredAt)}` : order.promisedAt ? ` · promised ${formatDay(order.promisedAt)}` : ""}`)), h("span", { class: `dash-row__amount${order.remainingCents > 0 ? " dash-row__amount--due" : ""}` }, note ?? (order.remainingCents > 0 ? `${money(order.remainingCents)} left` : "Paid")));
  }

  const group = (key, title, rows, emptyText) => h("div", { class: "dash-group", "data-group": key }, h("h4", { class: "dash-group__title" }, title, h("span", { class: "dash-count" }, String(rows.length))), rows.length ? h("div", { class: "dash-rows" }, rows) : empty(emptyText));

  /** Where the orders are: in the lab, made and waiting for the customer, and handed over. Separate lists: an order is in one of them. */
  function stagesSection() {
    return section({ id: "stages", title: "Orders by stage", wide: true }, () => dashboardData.stages(), (s) => [
      group("atLab", "In the lab", s.atLab.map((o) => orderRow(o)), "Nothing at the lab."),
      group("ready", "Ready, waiting for the customer", s.ready.map((o) => orderRow(o)), "Nothing waiting to be picked up."),
      group("pickedUp", "Picked up, last 7 days", s.pickedUp.map((o) => orderRow(o)), "Nothing picked up in the last 7 days."),
    ]);
  }

  function attentionSection() {
    return section({ id: "attention", title: "Needs attention", wide: true }, () => dashboardData.attention(), (a) => {
      return [
        group("late", "Late or due within 3 days", a.late.map((o) => orderRow(o)), "No late order."),
        group("cheques", "Cheques due this week", a.cheques.map((c) => customerLink(c.customerId, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, c.customerName), h("span", { class: "dash-row__sub" }, `due ${formatDay(c.dueAt)}`)), h("span", { class: "dash-row__amount" }, money(c.amountCents)))), "No cheque falls due this week."),
      ];
    });
  }

  function lowStockSection() {
    return section({ id: "stock", title: "Low stock", hint: `under ${LOW_STOCK_BELOW}` }, () => dashboardData.lowStock(LOW_STOCK_BELOW), (items) =>
      items.length
        ? h("div", { class: "dash-rows" }, items.map((p) => h("a", { class: "dash-row", href: p.kind === "frame" ? "#inventory/frames" : "#inventory/accessories" }, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, p.name), h("span", { class: "dash-row__sub" }, p.kind === "frame" ? "Frame" : "Accessory")), h("span", { class: `dash-row__amount${p.stock === 0 ? " dash-row__amount--due" : ""}` }, p.stock === 0 ? "Out" : `${p.stock} left`))))
        : empty("Everything is in stock."),
    );
  }

  function customersSection() {
    return section({ id: "customers", title: "Latest customers" }, () => dashboardData.recentCustomers(), (list) =>
      list.length ? h("div", { class: "dash-rows" }, list.map((c) => customerLink(c.id, h("span", { class: "dash-row__main" }, h("span", { class: "dash-row__title" }, c.name), h("span", { class: "dash-row__sub" }, `added ${formatDay(c.createdAt)}`))))) : empty("No customer yet."),
    );
  }

  function syncSection() {
    return section({ id: "sync", title: "Sync" }, () => dashboardData.syncStatus(), (s) => {
      const state = !s.reachable ? "offline" : s.unsyncedCount > 0 ? "pending" : "ok";
      const text = { offline: "The server can't be reached. Your work is saved on this computer.", pending: `${s.unsyncedCount} change${s.unsyncedCount === 1 ? "" : "s"} waiting to be sent.`, ok: "Everything is on the server." }[state];
      return h("div", { class: `dash-sync dash-sync--${state}`, "data-sync": state }, h("span", { class: "dash-sync__dot", "aria-hidden": "true" }), h("div", null, h("p", { class: "dash-sync__text" }, text), h("p", { class: "dash-row__sub" }, s.lastSyncedAt ? `Last synced ${ago(s.lastSyncedAt)}` : "Not synced yet")));
    });
  }

  /** One bar; its height is set through the DOM because the page's content security policy refuses inline style attributes. */
  function bar(share) {
    const el = h("div", { class: "dash-chart__bar" });
    el.style.height = `${Math.max(2, Math.round(share * 100))}%`;
    return el;
  }

  function chartSection() {
    return section({ id: "sales", title: `Sales, last ${SALES_DAYS} days`, wide: true }, () => dashboardData.salesByDay(SALES_DAYS), (days) => {
      const max = Math.max(...days.map((d) => d.totalCents), 0);
      if (max === 0) return empty("No sale in this period.");
      return h("div", { class: "dash-chart", role: "img", "aria-label": `Sales per day, total ${money(days.reduce((s, d) => s + d.totalCents, 0))}` }, days.map((d) => h("div", { class: "dash-chart__col", title: `${formatDay(d.day)}: ${money(d.totalCents)}`, "data-day": d.day }, bar(d.totalCents / max), h("span", { class: "dash-chart__day" }, weekdayFormat.format(new Date(d.day)).slice(0, 2)))));
    });
  }

  // ---- The page -------------------------------------------------------------------------------

  function build() {
    const action = (label, href, iconName, primary) => h("a", { class: `btn ${primary ? "btn--primary" : "btn--secondary"}`, href, "data-action": label }, icon(iconName), label);
    return h(
      "section",
      { class: "page dash", "aria-label": "Dashboard" },
      h("div", { class: "page__header" }, h("div", null, h("h2", { class: "page__title" }, "Today at the shop"), h("p", { class: "page__description" }, new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date()))), h("div", { class: "dash-actions" }, action("New customer", "#customers", "customers", true), action("New frame", "#inventory/frames", "glasses"))),
      todayStrip(),
      h("div", { class: "dash-grid" }, attentionSection(), stagesSection(), h("div", { class: "dash-side" }, lowStockSection(), customersSection(), syncSection()), chartSection()),
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
