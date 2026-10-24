// The Orders page (#orders, or #orders/<status> for one status): every order of the shop, newest first, with its customer, status and money.
// Read-only for now: orders are made from a customer's page. Real data, read through window.electronAPI.sales.list (src/local/salesService.ts).
//   status chips (All, Confirmed, At the lab, Ready, Delivered, Cancelled) each with how many orders they hold, a search box (order number or customer
//   name), the totals of what is shown, and the table.
//   On the "Confirmed" list each order has a checkbox: the ones ticked are made into ONE PDF (their lab sheets, a page each) and the person then chooses the
//   lenses supplier to send it to (labSendDialog.js). Sending itself does nothing yet.
(() => {
  "use strict";

  const api = window.electronAPI.sales;
  const CURRENCY = "DZD";
  const SEARCH_DELAY_MS = 200;
  const STATUSES = [
    ["all", "All"],
    ["confirmed", "Confirmed"],
    ["at_lab", "At the lab"],
    ["ready", "Ready"],
    ["delivered", "Delivered"],
    ["cancelled", "Cancelled"],
  ];
  const LABEL = Object.fromEntries(STATUSES);
  /** The list whose orders can be ticked and sent to the lenses supplier as lab sheets. */
  const SEND_STATUS = "confirmed";

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
  const formatDay = (iso) => dayFormat.format(new Date(iso));
  const moneyFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const money = (cents) => moneyFormat.format(cents / 100);

  // ---- State and loading ---------------------------------------------------------------------

  // The page always opens on today: its year, month and day. A blank month shows the whole year, a blank day the whole month.
  const today = () => { const n = new Date(); return { year: String(n.getFullYear()), month: String(n.getMonth() + 1), day: String(n.getDate()) }; };
  // year/month/day are the period shown; draft is what the three lists say until the person confirms.
  const state = { status: "all", query: "", ...today(), draft: today(), load: "loading", data: null, error: "", token: 0, selected: new Set(), making: false, sendError: "" };
  let root = null;
  let refs = null;

  async function load() {
    const token = ++state.token;
    state.load = state.data ? "refreshing" : "loading";
    render();
    try {
      const data = await api.list({ status: state.status, query: state.query, ...(state.year ? { year: +state.year } : {}), ...(state.month ? { month: +state.month } : {}), ...(state.day ? { day: +state.day } : {}) });
      if (token !== state.token) return;
      state.data = data;
      state.load = "ready";
      const present = new Set(data.rows.map((r) => r.id));
      for (const id of [...state.selected]) if (!present.has(id)) state.selected.delete(id); // only what is on the list can stay ticked
    } catch (error) {
      if (token !== state.token) return;
      state.load = "error";
      state.error = errorText(error);
    }
    render();
  }

  // ---- The page ------------------------------------------------------------------------------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function select(name, label, onchange) {
    const el = h("select", { class: "sales-period__select", "aria-label": label, "data-period": name });
    el.addEventListener("change", () => onchange(el.value));
    return el;
  }

  function fillPeriod() {
    const fill = (el, first, options, value) => {
      el.replaceChildren(h("option", { value: "" }, first), ...options.map(([v, text]) => h("option", { value: String(v) }, text)));
      el.value = value;
    };
    const years = state.data?.years ?? [];
    const d = state.draft;
    const shown = new Set([...years, new Date().getFullYear(), ...(state.year ? [+state.year] : []), ...(d.year ? [+d.year] : [])]);
    fill(refs.year, "All years", [...shown].sort((a, b) => b - a).map((y) => [y, String(y)]), d.year);
    fill(refs.month, "Whole year", MONTHS.map((m, i) => [i + 1, m]), d.month);
    const days = d.month ? new Date(+d.year, +d.month, 0).getDate() : 0;
    fill(refs.day, "Whole month", Array.from({ length: days }, (_, i) => [i + 1, String(i + 1)]), d.day);
    refs.month.disabled = !d.year;
    refs.day.disabled = !d.month;
  }

  function build() {
    const searchInput = h("input", { class: "search__input", type: "search", placeholder: "Search by order number or customer", "aria-label": "Search orders", autocomplete: "off", "data-search": "" });
    const clear = h("button", { class: "search__clear", type: "button", "aria-label": "Clear search", hidden: true }, icon("x"));
    let timer;
    searchInput.addEventListener("input", () => {
      clear.hidden = !searchInput.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.query = searchInput.value;
        load();
      }, SEARCH_DELAY_MS);
    });
    clear.addEventListener("click", () => {
      searchInput.value = "";
      clear.hidden = true;
      state.query = "";
      searchInput.focus();
      load();
    });
    const period = h("div", { class: "sales-period", role: "group", "aria-label": "Period" });
    refs = {
      period,
      year: select("year", "Year", (v) => { state.draft.year = v; if (!v) state.draft.month = state.draft.day = ""; fillPeriod(); }),
      month: select("month", "Month", (v) => { state.draft.month = v; state.draft.day = ""; fillPeriod(); }),
      day: select("day", "Day", (v) => { state.draft.day = v; }),
      apply: h("button", { class: "btn btn--primary", type: "button", "data-apply": "", onclick: () => { Object.assign(state, state.draft); load(); } }, "Show orders"),
      searchInput,
      chips: h("div", { class: "chips", role: "group", "aria-label": "Filter by status", "data-chips": "" }),
      summary: h("div", { class: "summary", "data-summary": "" }),
      bar: h("div", { class: "sales-sendbar", "data-sendbar": "", hidden: true }),
      card: h("div", { class: "table-card", "data-sales": "" }),
      footnote: h("p", { class: "toolbar__count", "data-footnote": "" }),
    };
    period.append(refs.year, refs.month, refs.day, refs.apply);
    return h(
      "section",
      { class: "page", "aria-labelledby": "sales-title" },
      h("header", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", id: "sales-title" }, "Orders"), h("p", { class: "page__description" }, "Every order of the shop, newest first. Orders are made from a customer's page."))),
      refs.summary,
      h("div", { class: "toolbar sales-toolbar" }, h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() }, icon("search"), searchInput, clear), period, refs.chips),
      refs.bar,
      refs.card,
      refs.footnote,
    );
  }

  function render() {
    if (!root) return;
    const data = state.data;
    refs.chips.replaceChildren(
      ...STATUSES.map(([key, label]) => {
        const n = data?.counts?.[key];
        const chip = h("button", { class: "chip", type: "button", "aria-pressed": String(state.status === key), "data-status": key, onclick: () => (location.hash = key === "all" ? "orders" : `orders/${key}`) }, h("span", null, label), n === undefined ? null : h("span", { class: "chip__count", "data-count": key }, String(n)));
        return chip;
      }),
    );

    fillPeriod();
    refs.summary.replaceChildren();
    if (data) {
      const t = data.totals;
      const tile = (key, label, value, tone, note) => h("div", { class: `summary__tile${tone ? ` summary__tile--${tone}` : ""}`, "data-tile": key }, h("span", { class: "summary__label" }, label), h("span", { class: "summary__value" }, value), note ? h("span", { class: "summary__note", "data-note": key }, note) : null);
      // The net profit: what the customers pay (the final price) minus what the items cost on the day of the sale. Orders whose cost was not known are not in it.
      const profitKnown = t.profitOrders > 0 || t.withoutCostOrders === 0;
      const profitNote = t.withoutCostOrders > 0 ? `${t.withoutCostOrders} ${t.withoutCostOrders === 1 ? "order has" : "orders have"} no known cost and ${t.withoutCostOrders === 1 ? "is" : "are"} not counted` : null;
      refs.summary.append(tile("orders", state.status === "cancelled" ? "Orders (cancelled are not counted)" : "Orders", String(t.orders)), tile("value", "Value", money(t.valueCents)), tile("paid", "Paid", money(t.paidCents)), tile("left", "Left to pay", money(t.remainingCents), t.remainingCents > 0 ? "due" : null), tile("profit", "Net profit", profitKnown ? money(t.profitCents) : "—", t.profitCents < 0 && profitKnown ? "due" : null, profitNote), tile("collected", "Profit collected", profitKnown ? money(t.collectedProfitCents) : "—", t.collectedProfitCents < 0 && profitKnown ? "due" : null, "Payments received minus costs"));
    }
    refs.summary.hidden = !data;

    renderBar();
    refs.card.replaceChildren();
    refs.card.dataset.status = state.load;
    refs.footnote.textContent = data && data.matching > data.shown ? `Showing the newest ${data.shown} of ${data.matching} orders. Search to narrow them down.` : "";
    if (state.load === "loading") return refs.card.append(h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the orders…")));
    if (state.load === "error") {
      return refs.card.append(h("div", { class: "state state--error", role: "alert" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, "The orders couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
    }
    if (!data || data.rows.length === 0) return refs.card.append(emptyState(data));
    refs.card.append(table(data.rows));
  }

  /** The bar above the At the lab list: how many orders are ticked, and the button that makes the PDF and goes on to the supplier. */
  function renderBar() {
    const on = state.status === SEND_STATUS && !!state.data && state.data.rows.length > 0;
    refs.bar.hidden = !on;
    refs.bar.replaceChildren();
    if (!on) return;
    const n = state.selected.size;
    const button = h("button", { class: "btn btn--primary", type: "button", "data-action": "generate-send", disabled: n === 0 || state.making, onclick: generateAndSend }, icon("printer"), state.making ? "Making the PDF…" : "Generate PDF and send");
    refs.bar.append(
      h("span", { class: "sales-sendbar__count", "data-selected-count": "", role: "status" }, n === 0 ? "Tick the orders to send to the lenses supplier." : `${n} ${n === 1 ? "order" : "orders"} selected`),
      button,
      state.sendError ? h("p", { class: "field__error", role: "alert", "data-send-error": "" }, state.sendError) : null,
    );
  }

  async function generateAndSend() {
    if (state.making || state.selected.size === 0) return;
    state.making = true;
    state.sendError = "";
    renderBar();
    try {
      // in the order of the list, in the language the app is showing
      const ids = state.data.rows.filter((r) => state.selected.has(r.id)).map((r) => r.id);
      const pdf = await window.electronAPI.documents.labPdf(ids, window.i18n?.lang ?? "en");
      window.openLabSend?.(pdf);
    } catch (error) {
      state.sendError = errorText(error);
    }
    state.making = false;
    renderBar();
  }

  function emptyState(data) {
    const searching = state.query.trim().length > 0 || !!state.year;
    const filtered = state.status !== "all";
    const none = data && data.counts.all === 0 && !searching;
    return h(
      "div",
      { class: "state", "data-state": none ? "none" : "empty" },
      h("span", { class: "state__icon" }, icon(searching ? "search" : "sales")),
      h("h3", { class: "state__title" }, none ? "No order yet" : searching ? "No order matches your search" : `No ${LABEL[state.status].toLowerCase()} order`),
      h("p", { class: "state__text" }, none ? "Orders are made from a customer's page: open a customer and choose New order." : searching ? "Nothing found for this search or period." : "Orders appear here as they reach this status."),
      filtered || searching ? h("button", { class: "btn btn--secondary", type: "button", onclick: () => { refs.searchInput.value = ""; state.query = ""; state.year = state.month = state.day = ""; state.draft = { year: "", month: "", day: "" }; location.hash = "orders"; if (!filtered) load(); } }, "Show all orders") : null,
    );
  }

  function table(rows) {
    const ticking = state.status === SEND_STATUS;
    const allTicked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
    const tickAll = h("input", { type: "checkbox", "aria-label": "Select all orders", "data-select-all": "", checked: allTicked });
    tickAll.addEventListener("change", () => {
      for (const r of rows) tickAll.checked ? state.selected.add(r.id) : state.selected.delete(r.id);
      state.sendError = "";
      render();
    });
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table sales-table" },
        h("thead", null, h("tr", null, ticking ? h("th", { scope: "col", class: "sales-tick" }, tickAll) : null, h("th", { scope: "col" }, "Order"), h("th", { scope: "col" }, "Customer"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col" }, "Promised"), h("th", { scope: "col", class: "sales-money" }, "Total"), h("th", { scope: "col", class: "sales-money" }, "Paid"), h("th", { scope: "col", class: "sales-money" }, "Left to pay"))),
        h("tbody", null, rows.map(row)),
      ),
    );
  }

  function tickBox(sale) {
    const box = h("input", { type: "checkbox", "aria-label": `Select order ${sale.number}`, "data-select": sale.id, checked: state.selected.has(sale.id) });
    box.addEventListener("change", () => {
      box.checked ? state.selected.add(sale.id) : state.selected.delete(sale.id);
      state.sendError = "";
      render();
    });
    return box;
  }

  function row(sale) {
    const cancelled = sale.status === "cancelled";
    const promised = sale.deliveredAt ? `Delivered ${formatDay(sale.deliveredAt)}` : sale.promisedAt && !cancelled ? formatDay(sale.promisedAt) : "—";
    return h(
      "tr",
      { "data-id": sale.id, "data-status": sale.status, "data-href": `orders/${encodeURIComponent(sale.id)}`, class: cancelled ? "sales-row--cancelled" : null },
      state.status === SEND_STATUS ? h("td", { class: "sales-tick" }, tickBox(sale)) : null,
      h("td", null, h("div", { class: "cell-name__stack" }, h("a", { class: "cell-name__text sales-order-link", "data-cell": "number", href: `#orders/${encodeURIComponent(sale.id)}` }, sale.number), h("span", { class: "cell-name__sub" }, formatDay(sale.orderedAt)))),
      h("td", { "data-cell": "customer" }, sale.customerId ? h("a", { class: "sales-customer", href: `#customers/${encodeURIComponent(sale.customerId)}` }, sale.customerName) : h("span", { class: "cell-secondary" }, sale.customerName)),
      h("td", null, h("span", { class: `status status--${sale.status}` }, LABEL[sale.status] ?? sale.status)),
      h("td", { "data-cell": "promised" }, promised, sale.overdue ? h("span", { class: "sales-overdue", "data-overdue": "" }, "Overdue") : null),
      h("td", { class: "sales-money", "data-cell": "total" }, money(sale.totalCents)),
      h("td", { class: "sales-money", "data-cell": "paid" }, money(sale.paidCents)),
      h("td", { class: `sales-money${sale.remainingCents > 0 ? " sales-money--due" : ""}`, "data-cell": "left" }, cancelled ? "—" : money(sale.remainingCents)),
    );
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const match = /^orders(?:\/([a-z_]+))?$/.exec(location.hash.slice(1));
    if (match && (match[1] === undefined || STATUSES.some(([k]) => k === match[1] && k !== "all"))) {
      if ((match[1] ?? "all") !== state.status) { state.selected.clear(); state.sendError = ""; } // the ticks belong to one list
      state.status = match[1] ?? "all";
      if (!root) {
        root = build();
        content.replaceChildren(root);
      }
      load(); // read again each time the page is opened or the filter changes
    } else if (root) {
      root.remove();
      root = null;
      state.token++;
      state.query = "";
      Object.assign(state, today());
      state.draft = today();
      state.data = null;
      state.status = "all";
      state.selected.clear();
      state.sendError = "";
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
