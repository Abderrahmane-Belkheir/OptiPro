// The Payments page (#payments): the money that really came into the shop, newest first, with who paid and for which order.
// Read-only: payments are taken on a customer's order. Real data, read through window.electronAPI.paymentsView.list (src/local/paymentsService.ts).
//   a search box (customer name or order number), the day / month / year the payment was taken (it opens on today; a blank month is the whole
//   year, a blank day the whole month; Show payments applies it), the total, the table.
(() => {
  "use strict";

  const api = window.electronAPI.paymentsView;
  const CURRENCY = "DZD";
  const SEARCH_DELAY_MS = 200;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

  // The page always opens on today. year/month/day are the period shown; draft is what the three lists say until the person confirms.
  const today = () => { const n = new Date(); return { year: String(n.getFullYear()), month: String(n.getMonth() + 1), day: String(n.getDate()) }; };
  const state = { query: "", ...today(), draft: today(), load: "loading", data: null, error: "", token: 0 };
  let root = null;
  let refs = null;

  async function load() {
    const token = ++state.token;
    state.load = state.data ? "refreshing" : "loading";
    render();
    try {
      const data = await api.list({ query: state.query, ...(state.year ? { year: +state.year } : {}), ...(state.month ? { month: +state.month } : {}), ...(state.day ? { day: +state.day } : {}) });
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

  // ---- The page ------------------------------------------------------------------------------

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
    const searchInput = h("input", { class: "search__input", type: "search", placeholder: "Search by customer or order number", "aria-label": "Search payments", autocomplete: "off", "data-search": "" });
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
      year: select("year", "Year", (v) => { state.draft.year = v; if (!v) state.draft.month = state.draft.day = ""; fillPeriod(); }),
      month: select("month", "Month", (v) => { state.draft.month = v; state.draft.day = ""; fillPeriod(); }),
      day: select("day", "Day", (v) => { state.draft.day = v; }),
      apply: h("button", { class: "btn btn--primary", type: "button", "data-apply": "", onclick: () => { Object.assign(state, state.draft); load(); } }, "Show payments"),
      searchInput,
      summary: h("div", { class: "summary", "data-summary": "" }),
      card: h("div", { class: "table-card", "data-payments": "" }),
      footnote: h("p", { class: "toolbar__count", "data-footnote": "" }),
    };
    period.append(refs.year, refs.month, refs.day, refs.apply);
    return h(
      "section",
      { class: "page", "aria-labelledby": "payments-title" },
      h("header", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", id: "payments-title" }, "Payments"), h("p", { class: "page__description" }, "Money that really came in, newest first. A cheque dated in the future is not here until its day."))),
      refs.summary,
      h("div", { class: "toolbar sales-toolbar" }, h("form", { class: "search", role: "search", onsubmit: (e) => e.preventDefault() }, icon("search"), searchInput, clear), period),
      refs.card,
      refs.footnote,
    );
  }

  function render() {
    if (!root) return;
    const data = state.data;
    fillPeriod();
    refs.summary.replaceChildren();
    if (data) {
      const t = data.totals;
      const tile = (key, label, value, tone) => h("div", { class: `summary__tile${tone ? ` summary__tile--${tone}` : ""}`, "data-tile": key }, h("span", { class: "summary__label" }, label), h("span", { class: "summary__value" }, value));
      refs.summary.append(tile("payments", "Payments", String(t.payments)), tile("collected", "Money in", money(t.collectedCents)));
    }
    refs.summary.hidden = !data;

    refs.card.replaceChildren();
    refs.card.dataset.status = state.load;
    refs.footnote.textContent = data && data.matching > data.shown ? `Showing the newest ${data.shown} of ${data.matching} payments. Search to narrow them down.` : "";
    if (state.load === "loading") return refs.card.append(h("div", { class: "state" }, h("p", { class: "state__text" }, "Loading the payments…")));
    if (state.load === "error") {
      return refs.card.append(h("div", { class: "state state--error", role: "alert" }, h("span", { class: "state__icon" }, icon("alert")), h("h3", { class: "state__title" }, "The payments couldn't be loaded"), h("p", { class: "state__text" }, state.error), h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
    }
    if (!data || data.rows.length === 0) return refs.card.append(emptyState(data));
    refs.card.append(table(data.rows));
  }

  function emptyState(data) {
    const searching = state.query.trim().length > 0 || !!state.year;
    const none = !searching;
    return h(
      "div",
      { class: "state", "data-state": none ? "none" : "empty" },
      h("span", { class: "state__icon" }, icon(searching ? "search" : "payments")),
      h("h3", { class: "state__title" }, none ? "No payment yet" : "No payment matches your search"),
      h("p", { class: "state__text" }, none ? "Payments are taken on a customer's order." : searching ? "Nothing found for this search or period." : "Payments appear here as they are taken."),
      searching ? h("button", { class: "btn btn--secondary", type: "button", onclick: () => { refs.searchInput.value = ""; state.query = ""; state.year = state.month = state.day = ""; state.draft = { year: "", month: "", day: "" }; load(); } }, "Show all payments") : null,
    );
  }

  function table(rows) {
    return h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "table sales-table" },
        h("thead", null, h("tr", null, h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Customer"), h("th", { scope: "col" }, "Order"), h("th", { scope: "col" }, "Cheque"), h("th", { scope: "col", class: "sales-money" }, "Amount"))),
        h("tbody", null, rows.map(row)),
      ),
    );
  }

  function row(p) {
    return h(
      "tr",
      { "data-id": p.id, "data-href": p.orderId && p.orderNumber ? `orders/${encodeURIComponent(p.orderId)}` : p.customerId ? `customers/${encodeURIComponent(p.customerId)}` : null },
      h("td", { "data-cell": "date" }, formatDay(p.paidAt)),
      h("td", { "data-cell": "customer" }, p.customerId ? h("a", { class: "sales-customer", href: `#customers/${encodeURIComponent(p.customerId)}` }, p.customerName) : h("span", { class: "cell-secondary" }, "—")),
      h("td", { "data-cell": "order" }, p.orderId && p.orderNumber ? h("a", { class: "sales-order-link", href: `#orders/${encodeURIComponent(p.orderId)}` }, p.orderNumber) : h("span", { class: "cell-secondary" }, "—")),
      h("td", { "data-cell": "cheque" }, p.chequeDueDate ? `Dated ${formatDay(p.chequeDueDate)}` : "—"),
      h("td", { class: "sales-money", "data-cell": "amount" }, money(p.amountCents)),
    );
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    if (location.hash.slice(1) === "payments") {
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
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
