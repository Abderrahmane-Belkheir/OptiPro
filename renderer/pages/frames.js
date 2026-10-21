// The Frames page (#inventory/frames): choose a category and a brand, see the frames of that choice.
// Data comes only through window.electronAPI: catalog.getCategoriesAndBrands() for the two choosers and
// frames.listWithPhotos(brandId, categoryId) for the cards (each frame comes with its photos' addresses).
// A list is fetched only when it has not been loaded yet: the lists already seen are kept per
// category + brand, so choosing an earlier combination again shows it at once.
(() => {
  "use strict";

  const api = window.electronAPI;
  const BRAND_SEARCH_FROM = 12; // above this many brands the chooser gets a search box

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

  const state = {
    catalog: { status: "loading", categories: [], brands: [], error: "" },
    categoryId: null,
    brandId: null,
    brandQuery: "",
    list: { status: "idle", frames: [], source: "", error: "" },
    cache: new Map(), // "brandId:categoryId" -> frames
    fetches: 0,
    token: 0,
  };
  let root = null;
  let refs = {};

  const keyOf = () => `${state.brandId}:${state.categoryId}`;
  const categoryName = () => state.catalog.categories.find((c) => c.id === state.categoryId)?.name ?? "";
  const brandName = () => state.catalog.brands.find((b) => b.id === state.brandId)?.name ?? "";

  async function loadCatalog() {
    state.catalog.status = "loading";
    render();
    try {
      const { categories, brands } = await api.catalog.getCategoriesAndBrands();
      state.catalog = { status: "ready", categories, brands, error: "" };
      // Whatever was chosen before and no longer exists is dropped.
      if (!categories.some((c) => c.id === state.categoryId)) state.categoryId = null;
      if (!brands.some((b) => b.id === state.brandId)) state.brandId = null;
    } catch (error) {
      state.catalog = { status: "error", categories: [], brands: [], error: errorMessage(error) };
    }
    render();
    if (state.catalog.status === "ready") ensureList();
  }

  /** Reads the categories and brands again and updates the choosers in place (no loading state, the screen stays as it is). */
  async function refreshCatalog() {
    const { categories, brands } = await api.catalog.getCategoriesAndBrands();
    state.catalog = { status: "ready", categories, brands, error: "" };
    render();
  }

  /** Called after every choice: shows the list of this category + brand, fetching it only if it is not loaded yet. */
  async function ensureList(forceFetch = false) {
    if (state.categoryId === null || state.brandId === null) {
      state.token++;
      state.list = { status: "idle", frames: [], source: "", error: "" };
      return render();
    }
    const key = keyOf();
    if (!forceFetch && state.cache.has(key)) {
      state.token++;
      state.list = { status: "ready", frames: state.cache.get(key), source: "cache", error: "" };
      return render();
    }
    const token = ++state.token; // only the newest request may update the screen
    state.list = { status: "loading", frames: [], source: "", error: "" };
    render();
    state.fetches++;
    try {
      const frames = await api.frames.listWithPhotos(state.brandId, state.categoryId);
      if (token !== state.token) return;
      state.cache.set(key, frames);
      state.list = { status: "ready", frames, source: "database", error: "" };
    } catch (error) {
      if (token !== state.token) return;
      state.list = { status: "error", frames: [], source: "", error: errorMessage(error) };
    }
    render();
  }

  function choose(kind, id) {
    if (kind === "category") state.categoryId = id;
    else state.brandId = id;
    ensureList();
  }

  // ---- Page ----------------------------------------------------------------------------------

  function build() {
    refs = {
      categories: h("div", { class: "chips", role: "group", "aria-labelledby": "frames-category-title" }),
      categoryHint: h("span", { class: "picker__hint" }),
      brands: h("div", { class: "chips", role: "group", "aria-labelledby": "frames-brand-title" }),
      brandHint: h("span", { class: "picker__hint" }),
      brandSearch: h("div", { class: "chip-search", hidden: true }),
      addBrand: h("button", { class: "btn btn--secondary btn--sm", type: "button", hidden: true, onclick: openAddBrand }, icon("plus"), "Add brand"),
      deleteBrand: h("button", { class: "btn btn--secondary btn--sm btn--danger-text", type: "button", id: "delete-brand", hidden: true, onclick: openDeleteBrand }, icon("trash"), "Delete brand"),
      addFrame: h("button", { class: "btn btn--primary", type: "button", id: "add-frame", hidden: true, onclick: openCreateFrame }, icon("plus"), "Add frame"),
      results: h("div", { class: "results", "aria-live": "polite" }),
    };
    const search = h("input", { class: "input", type: "search", placeholder: "Find a brand", "aria-label": "Find a brand", autocomplete: "off" });
    search.addEventListener("input", () => {
      state.brandQuery = search.value;
      renderBrands();
    });
    refs.brandSearch.append(icon("search"), search);
    refs.searchInput = search;

    return h(
      "section",
      { class: "page", "aria-labelledby": "frames-title", "data-fetches": "0" },
      h("header", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", id: "frames-title" }, "Frames"), h("p", { class: "page__description" }, "Choose a category and a brand to see its frames."))),
      h(
        "div",
        { class: "picker" },
        h("div", { class: "picker__group" }, h("div", { class: "picker__label" }, h("span", { class: "picker__title", id: "frames-category-title" }, "Category"), refs.categoryHint), refs.categories),
        h("div", { class: "picker__divider" }),
        h("div", { class: "picker__group" }, h("div", { class: "picker__label" }, h("span", { class: "picker__title", id: "frames-brand-title" }, "Brand"), refs.brandHint), h("div", { class: "picker__options" }, h("div", { class: "picker__tools" }, refs.brandSearch, refs.addBrand, refs.deleteBrand), refs.brands)),
      ),
      h("div", { class: "picker-actions" }, refs.addFrame),
      refs.results,
    );
  }

  function chip(label, pressed, onclick, large) {
    return h("button", { class: `chip${large ? " chip--large" : ""}`, type: "button", "aria-pressed": String(pressed), title: label, onclick }, h("span", null, label));
  }

  function renderCategories() {
    const { status, categories } = state.catalog;
    refs.categories.replaceChildren();
    refs.categoryHint.textContent = status === "ready" ? `${categories.length}` : "";
    if (status === "loading") return refs.categories.append(...[90, 120, 70].map(() => h("span", { class: "skeleton", "aria-hidden": "true" })));
    if (status !== "ready") return;
    if (categories.length === 0) return refs.categories.append(h("p", { class: "chips__empty" }, "There are no categories yet."));
    refs.categories.append(...categories.map((c) => chip(c.name, c.id === state.categoryId, () => choose("category", c.id), true)));
  }

  function renderBrands() {
    const { status, brands } = state.catalog;
    refs.addBrand.hidden = status !== "ready";
    refs.deleteBrand.hidden = !(status === "ready" && state.brandId !== null); // offered for the chosen brand
    refs.brands.replaceChildren();
    refs.brandHint.textContent = status === "ready" ? `${brands.length}` : "";
    refs.brandSearch.hidden = !(status === "ready" && brands.length > BRAND_SEARCH_FROM);
    if (status === "loading") return refs.brands.append(...[80, 110, 90, 70].map(() => h("span", { class: "skeleton", "aria-hidden": "true" })));
    if (status !== "ready") return;
    if (brands.length === 0) return refs.brands.append(h("p", { class: "chips__empty" }, "There are no brands yet."));
    const q = state.brandQuery.trim().toLowerCase();
    const shown = brands.filter((b) => b.id === state.brandId || !q || b.name.toLowerCase().includes(q));
    if (shown.length === 0) return refs.brands.append(h("p", { class: "chips__empty" }, `No brand matches “${state.brandQuery.trim()}”.`));
    refs.brands.append(...shown.map((b) => chip(b.name, b.id === state.brandId, () => choose("brand", b.id))));
  }

  function render() {
    if (!root) return;
    renderCategories();
    renderBrands();
    renderResults();
    // Offered once a category and a brand are both chosen: the new frame starts with those two.
    refs.addFrame.hidden = !(state.catalog.status === "ready" && state.categoryId !== null && state.brandId !== null);
    root.dataset.fetches = String(state.fetches);
  }

  // ---- Results -------------------------------------------------------------------------------

  function stateBox(iconName, title, text, action) {
    return h("div", { class: "state panel-state" }, h("span", { class: "state__icon" }, icon(iconName)), h("h3", { class: "state__title" }, title), text ? h("p", { class: "state__text" }, text) : null, action);
  }

  function renderResults() {
    const box = refs.results;
    box.replaceChildren();
    box.removeAttribute("data-status");
    box.removeAttribute("data-source");
    const { catalog, list } = state;
    if (catalog.status === "loading") return;
    if (catalog.status === "error") {
      box.dataset.status = "error";
      return box.append(stateBox("alert", "The categories and brands couldn't be loaded", catalog.error, h("button", { class: "btn btn--secondary", type: "button", onclick: loadCatalog }, "Try again")));
    }
    if (catalog.categories.length === 0 || catalog.brands.length === 0) {
      box.dataset.status = "nothing-to-choose";
      return box.append(stateBox("glasses", "Nothing to choose from yet", catalog.categories.length === 0 ? "There are no categories in this database yet." : "There are no brands in this database yet."));
    }
    if (list.status === "idle") {
      box.dataset.status = "idle";
      const missing = state.categoryId === null && state.brandId === null ? "a category and a brand" : state.categoryId === null ? "a category" : "a brand";
      return box.append(stateBox("glasses", "Pick to begin", `Choose ${missing} above to see the frames.`));
    }

    const title = `${categoryName()} · ${brandName()}`;
    const refresh = h("button", { class: "btn btn--secondary", type: "button", disabled: list.status === "loading", onclick: () => ensureList(true) }, icon("refresh"), "Refresh");
    const bar = h(
      "div",
      { class: "results__bar" },
      h("div", { class: "results__summary" }, h("h3", { class: "results__title", title }, title), list.status === "ready" ? h("span", { class: "results__count" }, `${list.frames.length} ${list.frames.length === 1 ? "frame" : "frames"}`) : null, list.source === "cache" ? h("span", { class: "results__note", title: "Shown from the lists already loaded; Refresh reads the database again" }, "Already loaded") : null),
      refresh,
    );
    box.dataset.status = list.status;
    box.dataset.source = list.source;
    box.append(bar);

    if (list.status === "loading") return box.append(h("div", { class: "grid", "aria-busy": "true" }, Array.from({ length: 6 }, skeletonCard)));
    if (list.status === "error") return box.append(stateBox("alert", "The frames couldn't be loaded", list.error, h("button", { class: "btn btn--secondary", type: "button", onclick: () => ensureList(true) }, "Try again")));
    if (list.frames.length === 0) return box.append(stateBox("glasses", "No frames here yet", `There are no ${brandName()} frames in ${categoryName()}.`));
    box.append(h("div", { class: "grid" }, list.frames.map(card)));
  }

  function skeletonCard() {
    return h("div", { class: "skeleton-card" }, h("div", { class: "skeleton skeleton-card__media" }), h("div", { class: "skeleton-card__body" }, h("span", { class: "skeleton" }), h("span", { class: "skeleton" }), h("span", { class: "skeleton" })));
  }

  function placeholder() {
    return h("div", { class: "frame-card__placeholder" }, icon("glasses"), h("span", null, "No photo"));
  }

  function card(frame) {
    const media = h("div", { class: "frame-card__media" });
    const first = frame.photos[0];
    if (first) {
      const img = h("img", { src: first.url, alt: frame.name, loading: "lazy", decoding: "async" });
      // A photo that cannot be loaded (offline, not uploaded yet) falls back to the placeholder.
      img.addEventListener("error", () => {
        img.remove();
        media.prepend(placeholder());
        media.dataset.photo = "failed";
      });
      media.dataset.photo = "shown";
      media.append(img);
      if (frame.photos.length > 1) media.append(h("span", { class: "frame-card__badge" }, `${frame.photos.length} photos`));
    } else {
      media.dataset.photo = "none";
      media.append(placeholder());
    }

    const size = [frame.eyeSize, frame.bridge, frame.templeLength].every((v) => v !== null && v !== undefined) ? `${frame.eyeSize}-${frame.bridge}-${frame.templeLength}` : null;
    const specs = [frame.shape, size ? `${size} mm` : null, frame.colors.length ? frame.colors.slice(0, 3).join(" / ") : null].filter(Boolean);
    const price = formatPrice(frame.price, frame.currency);
    return h(
      "article",
      { class: "frame-card", "data-id": frame.id },
      media,
      h(
        "div",
        { class: "frame-card__body" },
        h("h4", { class: "frame-card__name", title: frame.name }, h("a", { href: `#inventory/frames/${encodeURIComponent(frame.id)}`, "data-action": "open-details" }, frame.name)),
        h("p", { class: "frame-card__sub", title: frame.reference ?? "" }, frame.reference ? `Ref. ${frame.reference}` : "No reference"),
        h("div", { class: "frame-card__specs" }, specs.map((s) => h("span", { class: "spec", title: s }, s))),
        h("div", { class: "frame-card__footer" }, price ? h("span", { class: "frame-card__price" }, price) : h("span", { class: "frame-card__price frame-card__price--none" }, "No price"), h("span", { class: `stock${frame.stock > 0 ? "" : " stock--out"}` }, frame.stock > 0 ? `${frame.stock} in stock` : "Out of stock")),
        h(
          "div",
          { class: "frame-card__actions" },
          h("a", { class: "btn btn--secondary btn--sm", href: `#inventory/frames/${encodeURIComponent(frame.id)}`, "data-action": "details", "aria-label": `Details of ${frame.name}` }, icon("eye"), "Details"),
          h("button", { class: "btn btn--secondary btn--sm frame-card__edit", type: "button", "data-action": "edit", "aria-label": `Edit ${frame.name}`, onclick: () => openEditFrame(frame) }, icon("edit"), "Edit / delete"),
        ),
      ),
    );
  }

  // ---- Add brand -----------------------------------------------------------------------------

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

  const BRAND_NAME_MAX = 80;

  /** A small dialog that asks for the brand's name. It is saved in the local database and sent to the server (the brand service does both; a brand that could not be sent yet is sent later by the background sync). */
  function openAddBrand() {
    const input = h("input", { class: "input", id: "brand-name", name: "name", type: "text", autocomplete: "off", maxlength: String(BRAND_NAME_MAX), required: true, "aria-describedby": "brand-name-error" });
    const fieldError = h("p", { class: "field__error", id: "brand-name-error", hidden: true });
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Add brand");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));

    const setFieldError = (message) => {
      fieldError.textContent = message;
      fieldError.hidden = !message;
      if (message) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    };
    input.addEventListener("input", () => setFieldError(""));

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "brand-dialog-title" }, "Add brand"), h("p", { class: "dialog__subtitle" }, "It is saved here and sent to the server.")), close),
      h(
        "div",
        { class: "dialog__body" },
        banner,
        h("div", { class: "field" }, h("label", { class: "field__label", for: "brand-name" }, "Brand name", h("span", { class: "field__required", "aria-hidden": "true" }, "*")), input, fieldError),
      ),
      h("div", { class: "dialog__footer" }, cancel, submit),
    );
    const dialog = h("dialog", { class: "dialog dialog--narrow", "aria-labelledby": "brand-dialog-title" }, form);
    document.body.append(dialog);

    let busy = false;
    const dismiss = () => {
      if (!busy) dialog.close();
    };
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return; // a second click or Enter while saving does nothing
      banner.hidden = true;
      const name = input.value.trim().replace(/\s+/g, " ");
      if (!name) {
        setFieldError("Enter the brand's name.");
        return input.focus();
      }
      if (state.catalog.brands.some((b) => b.name.toLowerCase() === name.toLowerCase())) {
        setFieldError(`A brand named “${state.catalog.brands.find((b) => b.name.toLowerCase() === name.toLowerCase()).name}” already exists.`);
        return input.focus();
      }

      busy = true;
      submit.disabled = cancel.disabled = close.disabled = true;
      submit.replaceChildren(h("span", { class: "btn__spinner" }), "Adding…");
      try {
        const created = await api.brands.insert({ name });
        busy = false;
        dialog.close();
        state.brandQuery = "";
        if (refs.searchInput) refs.searchInput.value = "";
        try {
          await refreshCatalog();
          state.brandId = created.id; // the new brand is chosen, so its (empty) list shows at once
          ensureList();
        } catch (error) {
          toast(`${created.name} was added, but the lists could not be refreshed: ${errorMessage(error)}`);
          return;
        }
        toast(`${created.name} was added.`);
      } catch (error) {
        busy = false;
        submit.disabled = cancel.disabled = close.disabled = false;
        submit.replaceChildren("Add brand");
        const message = errorMessage(error);
        if (/^\[duplicate\]/.test(String(error?.message))) setFieldError(`A brand named “${name}” already exists.`);
        else {
          banner.querySelector("span").textContent = message;
          banner.hidden = false;
        }
      }
    });

    dialog.showModal();
    input.focus();
  }

  // ---- Delete brand --------------------------------------------------------------------------

  /** Asks to confirm, then deletes the chosen brand here and on the server. A brand that has frames is refused (the message says so). */
  function openDeleteBrand() {
    const brand = state.catalog.brands.find((b) => b.id === state.brandId);
    if (!brand) return;
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const confirm = h("button", { class: "btn btn--danger", type: "submit", "data-action": "confirm-delete-brand" }, icon("trash"), "Delete brand");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "brand-delete-title" }, "Delete brand"), h("p", { class: "dialog__subtitle" }, brand.name)), close),
      h("div", { class: "dialog__body" }, banner, h("p", null, `Delete “${brand.name}”? It is removed from this computer and from the server. A brand that has frames cannot be deleted.`)),
      h("div", { class: "dialog__footer" }, cancel, confirm),
    );
    const dialog = h("dialog", { class: "dialog dialog--narrow", "aria-labelledby": "brand-delete-title", "data-delete-brand": brand.id }, form);
    document.body.append(dialog);

    let busy = false;
    const dismiss = () => {
      if (!busy) dialog.close();
    };
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      banner.hidden = true;
      busy = true;
      confirm.disabled = cancel.disabled = close.disabled = true;
      confirm.replaceChildren(h("span", { class: "btn__spinner" }), "Deleting…");
      try {
        const result = await api.brands.delete(brand.id);
        busy = false;
        dialog.close();
        state.brandId = null; // the deleted brand is no longer chosen
        state.cache.clear();
        try {
          await refreshCatalog();
          ensureList();
        } catch (error) {
          toast(`${result.name} was deleted, but the lists could not be refreshed: ${errorMessage(error)}`);
          return;
        }
        toast(result.sentToServer ? `${result.name} was deleted.` : `${result.name} was deleted from this computer. The server will be told when it can be reached.`);
      } catch (error) {
        busy = false;
        confirm.disabled = cancel.disabled = close.disabled = false;
        confirm.replaceChildren(icon("trash"), "Delete brand");
        banner.querySelector("span").textContent = errorMessage(error);
        banner.hidden = false;
      }
    });

    dialog.showModal();
    cancel.focus();
  }

  // ---- Add frame -----------------------------------------------------------------------------

  /** Opens the creation card for the chosen category and brand; when a frame was created the list shows it. */
  function openCreateFrame() {
    const created = { categoryId: state.categoryId, brandId: state.brandId };
    window.openCreationCard({
      kind: "frame",
      category: categoryName(),
      brand: brandName(),
      categoryId: created.categoryId,
      brandId: created.brandId,
      onCreated(result) {
        state.cache.delete(`${created.brandId}:${created.categoryId}`);
        if (root && state.categoryId === created.categoryId && state.brandId === created.brandId) ensureList(true);
        const photos = result.photosSaved ? ` with ${result.photosSaved} ${result.photosSaved === 1 ? "photo" : "photos"}` : "";
        if (result.sentToServer) toast(`${result.frame.name} was added${photos} and sent to the server.`);
        else toast(`${result.frame.name} was saved on this computer${photos}. It will be sent to the server when it can be reached.`);
      },
    });
  }

  // ---- Edit / delete frame -------------------------------------------------------------------

  /** Opens the edit card of a frame. After a save or a delete the lists already loaded are dropped (the brand or category may have changed) and the shown one is read again. */
  function openEditFrame(frame) {
    const refreshAfter = () => {
      state.cache.clear();
      if (root) ensureList(true);
    };
    window.openEditCard({
      kind: "frame",
      item: frame,
      brands: state.catalog.brands,
      categories: state.catalog.categories,
      onUpdated(result) {
        refreshAfter();
        const parts = [result.photosAdded ? `${result.photosAdded} added` : null, result.photosRemoved ? `${result.photosRemoved} removed` : null].filter(Boolean);
        const photos = parts.length ? ` (photos: ${parts.join(", ")})` : "";
        if (result.sentToServer && !result.deletionsWaiting) toast(`${result.frame.name} was updated${photos} and sent to the server.`);
        else toast(`${result.frame.name} was updated${photos} on this computer. The server will get the changes when it can be reached.`);
      },
      onDeleted(result) {
        refreshAfter();
        if (result.sentToServer) toast(`${result.name} was deleted here and on the server.`);
        else toast(`${result.name} was deleted from this computer. The server will be told when it can be reached.`);
      },
    });
  }

  // ---- Mounting ------------------------------------------------------------------------------
  // The page lives in the shell's content area while the URL hash is #inventory/frames.

  function route() {
    const content = document.getElementById("content");
    const here = location.hash.slice(1) === "inventory/frames";
    if (here && !root) {
      root = build();
      content.replaceChildren(root);
      loadCatalog(); // the choosers are read again each time the page is opened; lists already seen stay cached
    } else if (!here && root) {
      root.remove();
      root = null;
      state.token++;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
