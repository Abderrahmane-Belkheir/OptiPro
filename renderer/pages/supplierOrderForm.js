// The New supplier order form, opened from the Supplier orders page:  window.openSupplierOrderForm()
// Save order places the order (electronAPI.supplierOrders.place, src/local/supplierOrderPlacement.ts): the order is saved with its supplier; a frame whose stock is 0 gets the
// quantity bought as its stock and its cost becomes what one cost (the price typed for each frame, or the batch price shared over all the frames bought); a frame that still has
// stock keeps its stock and cost. The suppliers and the frames are the
// shop's own. The steps, top to bottom:
//   1. the supplier          2. the frames bought: a search (by model or by code, narrowed by a category). Each frame found has its quantity and its price
//                               right in the result, and Add puts it in the order (where they can still be changed)
//   3. the price             either a PRICE PER FRAME (typed on the frame) or the PRICE OF THE WHOLE BATCH, shared over the frames bought (total / how many frames).
//                               Only the one that is chosen can be typed: the other is there, disabled
//   Save order is there but does nothing yet.
(() => {
  "use strict";

  const CURRENCY = "DZD";
  const SEARCH_DELAY_MS = 150;
  const MAX_QUANTITY = 9999;

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

  const errorText = (error) => String(error?.message ?? error).replace(/^\[[\w-]+\]\s*/, "").replace(/^Search:\s*/, "");
  const money = (cents) => {
    try {
      const whole = Math.abs(cents - Math.round(cents)) < 0.005 && Math.round(cents) % 100 === 0;
      return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${CURRENCY}`;
    }
  };

  /** An amount as typed ("5000", "5000,50"): centimes; null when empty, NaN when it is not an amount. */
  function centsOf(text) {
    const t = String(text ?? "").trim().replace(",", ".");
    if (t === "") return null;
    return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : Number.NaN;
  }
  /** Marks a box wrong (aria-invalid="true", which the styles show in red) or right. */
  const mark = (el, bad) => (bad ? el.setAttribute("aria-invalid", "true") : el.removeAttribute("aria-invalid"));
  const quantityOf = (text) => {
    const t = String(text ?? "").trim();
    return /^\d{1,4}$/.test(t) && Number(t) >= 1 && Number(t) <= MAX_QUANTITY ? Number(t) : Number.NaN;
  };

  function open() {
    const state = { by: "model", categoryId: null, mode: "unit", token: 0, timer: 0, found: { status: "idle", products: [], more: false, message: "" }, categories: [], brands: [] };
    /** frame id -> { frame, qty: input, unit: input, unitCell, totalCell } : the frames of this order, in the order they were added. */
    const lines = new Map();
    /** What was typed in a result before Add (frame id -> { qty, unit }), kept while the list is made again. */
    const drafts = new Map();

    // ---- 1. the supplier
    const supplier = h("select", { class: "input", id: "supplier-order-supplier", name: "supplier", "data-supplier-select": "" }, h("option", { value: "" }, "Choose a supplier"));
    const supplierHelp = h("p", { class: "field__help", "data-supplier-help": "", hidden: true });

    // ---- 2. the frames: a search, a category
    const input = h("input", { class: "search__input", type: "search", id: "supplier-order-search", placeholder: "Search by model: name, reference or brand", "aria-label": "Search items", autocomplete: "off", "data-picker": "supplier-frames" });
    const modes = h("div", { class: "chips pick-modes", role: "group", "aria-label": "Search by", "data-modes": "" }, [["model", "By model"], ["code", "By code"]].map(([mode, label]) =>
      h("button", { class: "chip", type: "button", "data-mode": mode, "aria-pressed": String(mode === state.by), onclick: () => {
        state.by = mode;
        for (const b of modes.children) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
        input.placeholder = mode === "model" ? "Search by model: name, reference or brand" : "Search by code, like abc-123";
        input.focus();
        search();
      } }, label)));
    const categories = h("div", { class: "chips", role: "group", "aria-label": "Category", "data-categories": "" });
    const hint = h("p", { class: "pick-hint", role: "status", "data-hint": "supplier-frames" }, "Type a model or a code, or choose a category, to find your frames and accessories.");
    const results = h("div", { class: "pick-results", role: "listbox", "aria-label": "Results", "data-results": "supplier-frames", hidden: true });

    // ---- 3. the order's lines and the price
    const linesBody = h("tbody");
    const linesTable = h(
      "table",
      { class: "table supplier-lines", "data-lines": "" },
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "Item"), h("th", { scope: "col", class: "supplier-lines__n" }, "Quantity"), h("th", { scope: "col", class: "supplier-lines__n", "data-unit-head": "" }, `Price per item (${CURRENCY})`), h("th", { scope: "col", class: "supplier-lines__n" }, "Total"), h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Remove")))),
      linesBody,
    );
    const linesEmpty = h("p", { class: "pick-results__empty", "data-lines-empty": "" }, "No item added yet.");
    const linesBox = h("div", { class: "table-scroll", hidden: true }, linesTable);
    const batch = h("input", { class: "input", type: "text", inputmode: "decimal", id: "supplier-order-batch", name: "batchTotal", placeholder: "0", autocomplete: "off", "data-batch-total": "" });
    const batchError = h("p", { class: "field__error", hidden: true });
    const batchField = h("div", { class: "field", "data-batch": "" }, h("label", { class: "field__label", for: "supplier-order-batch" }, `Price of the whole batch (${CURRENCY})`), batch, h("p", { class: "field__help" }, "What you pay for everything in this order together. The price of each piece is this total shared over the number of pieces bought."), batchError);
    const priceModes = h("div", { class: "chips", role: "group", "aria-label": "How the price is given", "data-price-modes": "" }, [["unit", "Price per item"], ["batch", "Price of the whole batch"]].map(([mode, label]) =>
      h("button", { class: "chip", type: "button", "data-price-mode": mode, "aria-pressed": String(mode === state.mode), onclick: () => {
        state.mode = mode;
        for (const b of priceModes.children) b.setAttribute("aria-pressed", String(b.dataset.priceMode === mode));
        renderLines();
        renderResults(); // the price box of each result follows the way chosen
      } }, label)));
    const summary = h("dl", { class: "order-summary", "data-summary": "" });

    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const saveError = h("p", { class: "field__error", role: "alert", hidden: true, "data-save-error": "" });
    const save = h("button", { class: "btn btn--primary", type: "submit", "data-action": "save-supplier-order" }, "Save order");

    // ---- the lines
    function addFrame(frame, qtyText = "1", unitText = "") {
      if (lines.has(frame.id)) return;
      const qty = h("input", { class: "input supplier-lines__input", type: "number", min: "1", max: String(MAX_QUANTITY), step: "1", value: qtyText, "aria-label": `Quantity of ${frame.name}`, "data-qty": frame.id });
      const unit = h("input", { class: "input supplier-lines__input", type: "text", inputmode: "decimal", placeholder: "0", autocomplete: "off", value: unitText, "aria-label": `Price of one ${frame.name}`, "data-unit": frame.id });
      const unitCell = h("td", { class: "supplier-lines__n", "data-cell": "unit" });
      const totalCell = h("td", { class: "supplier-lines__n", "data-cell": "total" });
      for (const el of [qty, unit]) el.addEventListener("input", refresh);
      lines.set(frame.id, { frame, qty, unit, unitCell, totalCell });
      renderLines();
      renderResults(); // the frame is marked as added in the list
    }

    function removeFrame(id) {
      lines.delete(id);
      renderLines();
      renderResults();
    }

    /** The brand of a frame (an accessory has none): the search gives it with the product. */
    function brandName(product) {
      return product.brand ?? "";
    }

    /** Builds the order's lines again (a frame added or removed, or the way of giving the price changed). */
    function renderLines() {
      linesBody.replaceChildren();
      for (const [id, line] of lines) {
        const f = line.frame;
        const sub = [brandName(f), f.code, f.reference].filter(Boolean).join(" · ");
        linesBody.append(
          h(
            "tr",
            { "data-line": id },
            h("td", null, h("div", { class: "cell-name__stack" }, h("span", { class: "cell-name__text" }, f.name), h("span", { class: "cell-name__sub" }, sub))),
            h("td", { class: "supplier-lines__n" }, line.qty),
            state.mode === "unit" ? h("td", { class: "supplier-lines__n" }, line.unit) : line.unitCell,
            line.totalCell,
            h("td", null, h("button", { class: "icon-button", type: "button", "aria-label": `Remove ${f.name}`, "data-action": "remove-line", onclick: () => removeFrame(id) }, icon("x"))),
          ),
        );
      }
      linesBox.hidden = lines.size === 0;
      linesEmpty.hidden = lines.size !== 0;
      batch.disabled = state.mode !== "batch"; // always shown; only the way of giving the price that is chosen can be typed
      batchField.dataset.enabled = String(state.mode === "batch");
      linesTable.querySelector("[data-unit-head]").textContent = state.mode === "unit" ? `Price per item (${CURRENCY})` : "Price per item";
      refresh();
    }

    /** Works the prices out again (a quantity or a price was typed): only the numbers change, so nothing typed is lost. */
    function refresh() {
      let frames = 0;
      let invalid = false;
      for (const line of lines.values()) {
        const q = quantityOf(line.qty.value);
        mark(line.qty, Number.isNaN(q));
        if (Number.isNaN(q)) invalid = true;
        else frames += q;
      }
      let totalCents = null;
      if (state.mode === "unit") {
        let sum = 0;
        let allPriced = lines.size > 0;
        for (const line of lines.values()) {
          const q = quantityOf(line.qty.value);
          const u = centsOf(line.unit.value);
          mark(line.unit, Number.isNaN(u));
          if (u === null || Number.isNaN(u) || Number.isNaN(q)) {
            line.totalCell.textContent = "—";
            allPriced = false;
          } else {
            line.totalCell.textContent = money(u * q);
            sum += u * q;
          }
        }
        totalCents = allPriced && !invalid ? sum : null;
      } else {
        const batchCents = centsOf(batch.value);
        const bad = Number.isNaN(batchCents);
        batchError.textContent = bad ? "Enter an amount, like 250000 or 250000.50." : "";
        batchError.hidden = !bad;
        mark(batch, bad);
        for (const line of lines.values()) {
          const q = quantityOf(line.qty.value);
          if (batchCents === null || bad || invalid || frames === 0) {
            line.unitCell.textContent = "—";
            line.totalCell.textContent = "—";
          } else {
            const unit = Math.round(batchCents / frames); // the batch shared over the frames bought: total / how many, to the centime
            line.unitCell.textContent = money(unit);
            line.totalCell.textContent = money(unit * q);
          }
        }
        totalCents = batchCents !== null && !bad && !invalid ? batchCents : null;
      }
      summary.replaceChildren();
      const row = (key, label, value) => summary.append(h("div", { class: "order-summary__row" }, h("dt", null, label), h("dd", { "data-field": key }, value)));
      row("frames", "Items", String(lines.size === 0 ? 0 : invalid ? "—" : frames));
      row("total", "Total", totalCents === null ? "—" : money(totalCents));
      row("kinds", "Different items", String(lines.size));
    }

    // ---- the search
    function renderCategories() {
      categories.replaceChildren(
        ...[{ id: null, name: "All categories" }, ...state.categories, { id: "accessories", name: "Accessories" }].map((c) => h("button", { class: "chip", type: "button", "data-category": c.id === null ? "all" : String(c.id), "aria-pressed": String(state.categoryId === c.id), onclick: () => {
          state.categoryId = c.id;
          renderCategories();
          search();
        } }, c.name)),
      );
    }

    function renderResults() {
      const found = state.found;
      results.replaceChildren();
      results.hidden = found.status === "idle" || found.status === "refused";
      if (found.status === "idle" || found.status === "refused") {
        hint.hidden = false;
        hint.classList.toggle("pick-hint--invalid", found.status === "refused");
        hint.textContent = found.status === "refused" ? found.message : "Type a model or a code, or choose a category, to find your frames and accessories.";
        mark(input, found.status === "refused");
        return;
      }
      hint.hidden = true;
      input.removeAttribute("aria-invalid");
      results.dataset.status = found.status;
      if (found.status === "loading") return results.append(h("p", { class: "pick-results__empty" }, "Searching…"));
      if (found.status === "error") return results.append(h("p", { class: "pick-results__empty pick-results__empty--error", role: "alert" }, `The items couldn't be searched: ${found.message}`));
      if (found.products.length === 0) return results.append(h("p", { class: "pick-results__empty", "data-state": "empty" }, "No item matches."));
      for (const frame of found.products) {
        const added = lines.has(frame.id);
        const sub = [brandName(frame), frame.code, frame.reference].filter(Boolean).join(" · ");
        const draft = drafts.get(frame.id) ?? { qty: "1", unit: "" };
        drafts.set(frame.id, draft);
        const qtyBox = h("input", { class: "input supplier-result__input", type: "number", min: "1", max: String(MAX_QUANTITY), step: "1", value: draft.qty, placeholder: "Qty", title: "Quantity", "aria-label": `Quantity of ${frame.name}`, "data-draft-qty": frame.id });
        const unitBox = h("input", { class: "input supplier-result__input", type: "text", inputmode: "decimal", value: draft.unit, placeholder: "Price", title: state.mode === "unit" ? "Price of one item" : "The price is given for the whole batch", autocomplete: "off", disabled: state.mode !== "unit", "aria-label": `Price of one ${frame.name}`, "data-draft-unit": frame.id });
        qtyBox.addEventListener("input", () => (draft.qty = qtyBox.value));
        unitBox.addEventListener("input", () => (draft.unit = unitBox.value));
        const addButton = h("button", { class: "btn btn--secondary btn--sm", type: "button", "data-action": "add-frame", onclick: () => {
          const q = quantityOf(draft.qty);
          const u = centsOf(draft.unit);
          const badPrice = state.mode === "unit" && Number.isNaN(u);
          mark(qtyBox, Number.isNaN(q));
          mark(unitBox, badPrice);
          if (Number.isNaN(q) || badPrice) return; // what was typed is marked; nothing is added
          addFrame(frame, draft.qty, state.mode === "unit" ? draft.unit : "");
        } }, icon("plus"), "Add");
        results.append(
          h(
            "div",
            { class: "pick-result supplier-result", role: "option", "data-id": frame.id, "data-added": String(added) },
            h("span", { class: "pick-result__main" }, h("span", { class: "pick-result__name" }, frame.name), h("span", { class: "pick-result__sub" }, sub)),
            h("span", { class: "pick-result__side" }, h("span", { class: `pick-result__stock${frame.stock <= 0 ? " pick-result__stock--out" : ""}` }, frame.stock <= 0 ? "Out of stock" : `${frame.stock} in stock`), added ? h("span", { class: "pick-result__fit" }, "Added") : h("span", { class: "supplier-result__entry" }, qtyBox, unitBox, addButton)),
          ),
        );
      }
      if (found.more) results.append(h("p", { class: "pick-results__more", "data-more": "" }, "Showing the first 60. Keep typing to narrow it down."));
    }

    async function search() {
      clearTimeout(state.timer);
      const token = ++state.token;
      const text = input.value.trim();
      if (text === "" && state.categoryId === null) {
        state.found = { status: "idle", products: [], more: false, message: "" };
        return renderResults();
      }
      state.found = { status: "loading", products: [], more: false, message: "" };
      renderResults();
      try {
        const accessoriesOnly = state.categoryId === "accessories";
        const { products, more } = await window.electronAPI.supplierOrders.searchProducts(text, state.by, { categoryId: accessoriesOnly ? null : state.categoryId, accessoriesOnly });
        if (token !== state.token) return;
        state.found = { status: "ready", products, more, message: "" };
      } catch (error) {
        if (token !== state.token) return;
        const refused = /^\[invalid-input\]/.test(String(error?.message ?? ""));
        state.found = { status: refused ? "refused" : "error", frames: [], more: false, message: errorText(error) };
      }
      renderResults();
    }
    input.addEventListener("input", () => {
      clearTimeout(state.timer);
      state.timer = setTimeout(search, SEARCH_DELAY_MS);
    });

    // ---- the form
    const section = (title, ...children) => h("section", { class: "order-form__section" }, h("h3", { class: "order-form__heading" }, title), ...children);
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "supplier-order-title" }, "New supplier order"), h("p", { class: "dialog__subtitle" }, "Frames and accessories you buy from a supplier. Saving sets the stock and the cost of the items that were out of stock.")), close),
      h(
        "div",
        { class: "dialog__body" },
        section("Supplier", h("div", { class: "field" }, h("label", { class: "field__label", for: "supplier-order-supplier" }, "Supplier"), supplier, supplierHelp)),
        section("Price", h("p", { class: "field__help" }, "Give the price of each item, or the price of the whole batch."), priceModes),
        section("Items", h("p", { class: "field__help" }, "Search your frames and accessories by model or by code, or choose a category, and add the ones you are buying. An item that already has an order waiting is not listed."), h("p", { class: "field__help", role: "note", "data-stock-note": "" }, icon("alert"), "An item with no stock gets its stock and cost from this order now. An item that still has stock keeps them: this order waits until its last one is sold."), modes, h("div", { class: "search pick-search__box" }, icon("search"), input), categories, hint, results),
        section("Order", linesEmpty, linesBox),
        h("section", { class: "order-form__section" }, batchField),
        h("div", { class: "order-form__summary" }, summary),
      ),
      h("div", { class: "dialog__footer" }, h("span", { class: "order-form__note" }, "Saving gives each item that was out of stock its quantity and its cost."), saveError, cancel, save),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": "supplier-order-title", "data-supplier-order-form": "" }, form);
    document.body.append(dialog);
    batch.addEventListener("input", refresh);
    const dismiss = () => dialog.close();
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("close", () => {
      clearTimeout(state.timer);
      dialog.remove();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      saveError.hidden = true;
      supplierHelp.classList.remove("field__error");
      save.disabled = true;
      try {
        const result = await window.electronAPI.supplierOrders.place({
          supplierId: supplier.value,
          priceMode: state.mode,
          batchTotal: batch.value,
          lines: [...lines.entries()].map(([id, line]) => ({ [line.frame.kind === "accessory" ? "accessoryId" : "frameId"]: id, quantity: line.qty.value, unitCost: line.unit.value })),
        });
        if (result.status === "invalid") return showProblems(result.errors);
        showSaved(result);
      } catch (error) {
        saveError.textContent = `The order couldn't be saved: ${errorText(error)}`;
        saveError.hidden = false;
      } finally {
        save.disabled = false;
      }
    });

    /** What the order refused, shown at the boxes it is about and in one message. */
    function showProblems(errors) {
      const messages = [];
      for (const [key, message] of Object.entries(errors)) {
        const [id, field] = key.split(".");
        const line = field ? lines.get(id) : null;
        if (line) mark(field === "quantity" ? line.qty : line.unit, true);
        if (key === "batchTotal") { batchError.textContent = message; batchError.hidden = false; mark(batch, true); }
        messages.push(message);
      }
      saveError.textContent = messages.join(" ");
      saveError.hidden = false;
    }

    /** The order is saved: the form says what changed and only offers to close. */
    function showSaved(result) {
      window.dispatchEvent(new Event("supplier-orders-changed")); // the list behind the form reads again
      form.replaceChildren(
        h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "supplier-order-title" }, "Order saved")), close),
        h("div", { class: "dialog__body" }, h("p", { "data-saved": "" }, `${result.quantity} ${result.quantity === 1 ? "item" : "items"} (${result.lines} different) bought for ${money(result.totalCents)}.`),
          result.updatedLines > 0 ? h("p", { "data-stock-set": "" }, `${result.addedQuantity} added to your stock; the cost of ${result.updatedLines} ${result.updatedLines === 1 ? "item" : "items"} was updated.`) : null,
          result.updatedLines < result.lines ? h("p", { class: "field__help", "data-stock-kept": "" }, `${result.lines - result.updatedLines} of the ${result.lines} items still had stock: their stock and cost were not changed.`) : null,
          result.sentToServer ? null : h("p", { class: "field__help" }, "It will be sent to the server at the next synchronisation.")),
        h("div", { class: "dialog__footer" }, h("button", { class: "btn btn--primary", type: "button", "data-action": "close-saved", onclick: dismiss }, "Close")),
      );
    }
    renderCategories();
    renderResults();
    renderLines();
    dialog.showModal();
    input.focus();

    // the suppliers and the categories and brands: the shop's own
    (async () => {
      try {
        const [list, catalog] = await Promise.all([window.electronAPI.suppliers.list(), window.electronAPI.catalog.getCategoriesAndBrands()]);
        const active = list.filter((s) => s.isActive);
        supplier.append(...active.map((s) => h("option", { value: s.id }, s.name)));
        supplierHelp.hidden = active.length > 0;
        supplierHelp.textContent = "You have no supplier yet: add one in Suppliers.";
        state.categories = catalog.categories;
        state.brands = catalog.brands;
        renderCategories();
        renderLines();
      } catch (error) {
        supplierHelp.hidden = false;
        supplierHelp.textContent = `The suppliers couldn't be loaded: ${errorText(error)}`;
      }
    })();
  }

  window.openSupplierOrderForm = open;
})();
