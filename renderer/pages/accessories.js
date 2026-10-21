// The Accessories page (#inventory/accessories): every accessory of the shop as a card, with a search box.
// Data comes only through window.electronAPI.accessories.listWithPhotos(): each accessory comes with its photos'
// addresses. The list is read each time the page is opened (and on Refresh); searching filters what was read.
(() => {
  "use strict";

  const api = window.electronAPI;

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

  function errorMessage(error) {
    return String(error?.message ?? error).replace(/^\[[\w-]+\]\s*/, "");
  }

  function formatPrice(price, currency) {
    if (price === null || price === undefined) return null;
    try {
      if (currency && /^[A-Za-z]{3}$/.test(currency)) {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(price);
      }
    } catch {
      // an unknown currency code: fall through to the plain number
    }
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(price)}${currency ? ` ${currency}` : ""}`;
  }

  // ---- State ---------------------------------------------------------------------------------

  const state = { status: "loading", accessories: [], error: "", query: "", inStockOnly: false, token: 0 };
  let root = null;
  let refs = {};

  async function load() {
    const token = ++state.token; // only the newest request may update the screen
    state.status = "loading";
    render();
    try {
      const accessories = await api.accessories.listWithPhotos();
      if (token !== state.token) return;
      state.accessories = accessories;
      state.status = "ready";
      state.error = "";
    } catch (error) {
      if (token !== state.token) return;
      state.accessories = [];
      state.status = "error";
      state.error = errorMessage(error);
    }
    render();
  }

  function visible() {
    const q = state.query.trim().toLowerCase();
    return state.accessories.filter((a) => (!state.inStockOnly || a.stock > 0) && (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)));
  }

  // ---- Page ----------------------------------------------------------------------------------

  function build() {
    refs = { results: h("div", { class: "results", "aria-live": "polite" }) };
    const search = h("input", { class: "input", type: "search", placeholder: "Search accessories", "aria-label": "Search accessories", autocomplete: "off" });
    search.addEventListener("input", () => {
      state.query = search.value;
      render();
    });
    refs.search = h("div", { class: "chip-search" }, icon("search"), search);
    refs.stock = h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: () => {
      state.inStockOnly = !state.inStockOnly;
      render();
    } }, h("span", null, "In stock only"));
    refs.tools = h("div", { class: "toolbar" }, refs.search, refs.stock);

    return h(
      "section",
      { class: "page", "aria-labelledby": "accessories-title" },
      h("header", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", id: "accessories-title" }, "Accessories"), h("p", { class: "page__description" }, "Cases, cloths, chains and everything sold with the glasses.")), h("button", { class: "btn btn--primary", type: "button", id: "add-accessory", onclick: () => window.openCreationCard({ kind: "accessory" }) }, icon("plus"), "Add accessory")),
      refs.tools,
      refs.results,
    );
  }

  function render() {
    if (!root) return;
    refs.tools.hidden = state.status !== "ready" || state.accessories.length === 0;
    refs.stock.setAttribute("aria-pressed", String(state.inStockOnly));
    renderResults();
  }

  function stateBox(iconName, title, text, action) {
    return h("div", { class: "state panel-state" }, h("span", { class: "state__icon" }, icon(iconName)), h("h3", { class: "state__title" }, title), text ? h("p", { class: "state__text" }, text) : null, action);
  }

  function skeletonCard() {
    return h("div", { class: "skeleton-card" }, h("div", { class: "skeleton skeleton-card__media" }), h("div", { class: "skeleton-card__body" }, h("span", { class: "skeleton" }), h("span", { class: "skeleton" }), h("span", { class: "skeleton" })));
  }

  function renderResults() {
    const box = refs.results;
    box.replaceChildren();
    box.dataset.status = state.status;
    if (state.status === "loading") return box.append(h("div", { class: "grid", "aria-busy": "true" }, Array.from({ length: 8 }, skeletonCard)));
    if (state.status === "error") {
      return box.append(stateBox("alert", "The accessories couldn't be loaded", state.error, h("button", { class: "btn btn--secondary", type: "button", onclick: load }, "Try again")));
    }
    if (state.accessories.length === 0) {
      box.dataset.status = "empty";
      return box.append(stateBox("glasses", "No accessories yet", "There are no accessories in this database yet."));
    }

    const shown = visible();
    const total = state.accessories.length;
    const count = shown.length === total ? `${total} ${total === 1 ? "accessory" : "accessories"}` : `${shown.length} of ${total}`;
    const refresh = h("button", { class: "btn btn--secondary", type: "button", onclick: load }, icon("refresh"), "Refresh");
    box.append(h("div", { class: "results__bar" }, h("div", { class: "results__summary" }, h("h3", { class: "results__title" }, "All accessories"), h("span", { class: "results__count" }, count)), refresh));
    if (shown.length === 0) {
      box.dataset.status = "no-match";
      const q = state.query.trim();
      return box.append(stateBox("search", "Nothing matches", q ? `No accessory matches “${q}”${state.inStockOnly ? " among those in stock" : ""}.` : "No accessory is in stock."));
    }
    box.append(h("div", { class: "grid" }, shown.map(card)));
  }

  function placeholder() {
    return h("div", { class: "frame-card__placeholder" }, icon("inventory"), h("span", null, "No photo"));
  }

  function card(accessory) {
    const media = h("div", { class: "frame-card__media" });
    const first = accessory.photos[0];
    if (first) {
      const img = h("img", { src: first.url, alt: accessory.name, loading: "lazy", decoding: "async" });
      // A photo that cannot be loaded (offline, not uploaded yet) falls back to the placeholder.
      img.addEventListener("error", () => {
        img.remove();
        media.prepend(placeholder());
        media.dataset.photo = "failed";
      });
      media.dataset.photo = "shown";
      media.append(img);
      if (accessory.photos.length > 1) media.append(h("span", { class: "frame-card__badge" }, `${accessory.photos.length} photos`));
    } else {
      media.dataset.photo = "none";
      media.append(placeholder());
    }

    const price = formatPrice(accessory.price, accessory.currency);
    return h(
      "article",
      { class: "frame-card", "data-id": accessory.id },
      media,
      h(
        "div",
        { class: "frame-card__body" },
        h("h4", { class: "frame-card__name", title: accessory.name }, h("a", { href: `#inventory/accessories/${encodeURIComponent(accessory.id)}`, "data-action": "open-details" }, accessory.name)),
        h("p", { class: "frame-card__desc", title: accessory.description }, accessory.description || "No description"),
        h("div", { class: "frame-card__footer" }, price ? h("span", { class: "frame-card__price" }, price) : h("span", { class: "frame-card__price frame-card__price--none" }, "No price"), h("span", { class: `stock${accessory.stock > 0 ? "" : " stock--out"}` }, accessory.stock > 0 ? `${accessory.stock} in stock` : "Out of stock")),
        h(
          "div",
          { class: "frame-card__actions" },
          h("a", { class: "btn btn--secondary btn--sm", href: `#inventory/accessories/${encodeURIComponent(accessory.id)}`, "data-action": "details", "aria-label": `Details of ${accessory.name}` }, icon("eye"), "Details"),
          h("button", { class: "btn btn--secondary btn--sm frame-card__edit", type: "button", "data-action": "edit", "aria-label": `Edit ${accessory.name}`, onclick: () => openEditAccessory(accessory) }, icon("edit"), "Edit / delete"),
        ),
      ),
    );
  }

  // ---- Edit / delete accessory ---------------------------------------------------------------

  function toast(message) {
    let box = document.querySelector(".toasts");
    if (!box) {
      box = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.append(box);
    }
    const el = h("div", { class: "toast toast--success" }, icon("check"), h("span", null, message));
    box.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  function openEditAccessory(accessory) {
    window.openEditCard({
      kind: "accessory",
      item: accessory,
      onUpdated(result) {
        if (root) load();
        const parts = [result.photosAdded ? `${result.photosAdded} added` : null, result.photosRemoved ? `${result.photosRemoved} removed` : null].filter(Boolean);
        const photos = parts.length ? ` (photos: ${parts.join(", ")})` : "";
        if (result.sentToServer && !result.deletionsWaiting) toast(`${result.accessory.name} was updated${photos} and sent to the server.`);
        else toast(`${result.accessory.name} was updated${photos} on this computer. The server will get the changes when it can be reached.`);
      },
      onDeleted(result) {
        if (root) load();
        if (result.sentToServer) toast(`${result.name} was deleted here and on the server.`);
        else toast(`${result.name} was deleted from this computer. The server will be told when it can be reached.`);
      },
    });
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const here = location.hash.slice(1) === "inventory/accessories";
    if (here && !root) {
      root = build();
      content.replaceChildren(root);
      load(); // read again each time the page is opened
    } else if (!here && root) {
      root.remove();
      root = null;
      state.token++;
      state.query = "";
      state.inStockOnly = false;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
