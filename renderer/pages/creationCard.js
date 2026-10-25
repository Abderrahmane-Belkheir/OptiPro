// The creation card of a frame or an accessory: a dialog with the form to describe a new one.
// FRAME: "Create frame" sends the form and the chosen photos to the main process (electronAPI.frames.create),
// which validates, saves (locally, then on the server) and answers; a mistake is shown next to its field.
// ACCESSORY: still only the picture ("Create accessory" does nothing yet).
// Cancel, the close button and Escape close it. Used by the Frames and Accessories pages:
//   window.openCreationCard({ kind: "frame", category: "Kids", brand: "Gucci", categoryId: 3, brandId: 12, gender: "female" /* optional: preselected */, onCreated: (result) => {} })
//   window.openCreationCard({ kind: "accessory" })
// The EDIT card of an existing frame or accessory (opened by the Edit button on its card): the same fields filled in, the
// photos it has now (each can be marked for removal), a picker for new photos, "Save changes" and "Delete".
//   window.openEditCard({ kind: "frame", item, brands, categories, onUpdated: (result) => {}, onDeleted: (result) => {} })
(() => {
  "use strict";

  const GENDERS = ["Female", "Male", "Unisex"]; // the values sent are lower case: female, male, unisex
  const SHAPES = ["Aviator", "Wayfarer", "Round", "Square", "Rectangular", "Oval", "Cat-eye", "Browline", "Geometric", "Pilot", "Other"];
  const CURRENCIES = ["DZD", "EUR", "USD"];

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

  let uid = 0;

  /** A labelled field; `control` is built with the id the label points at. */
  function field(label, make, { name = "", required = false, hint = "", wide = false } = {}) {
    const id = `cc-${++uid}`;
    const control = make(id);
    if (name) control.setAttribute("name", name);
    return h(
      "div",
      { class: `field${wide ? " field--wide" : ""}`, "data-field": name || null },
      h("label", { class: "field__label", for: id }, label, required ? h("span", { class: "field__required", "aria-hidden": "true" }, "*") : null),
      control,
      hint ? h("p", { class: "field__hint" }, hint) : null,
      name ? h("p", { class: "field__error", id: `${id}-error`, "data-error-for": name, hidden: true }) : null,
    );
  }

  const text = (placeholder = "", extra = {}) => (id) => h("input", { class: "input", id, type: "text", placeholder, autocomplete: "off", ...extra });
  const number = (placeholder = "", extra = {}) => (id) => h("input", { class: "input", id, type: "number", min: "0", inputmode: "decimal", placeholder, ...extra });
  const select = (options, placeholder) => (id) => h("select", { class: "input", id }, h("option", { value: "" }, placeholder), options.map((o) => h("option", { value: o.toLowerCase() }, o)));

  function priceRow() {
    return h(
      "div",
      { class: "creation__pair field--wide" },
      field("Price", number("0"), { name: "price" }),
      field("Currency", (id) => h("select", { class: "input", id }, CURRENCIES.map((c) => h("option", { value: c }, c))), { name: "currency" }),
    );
  }

  const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // the same limit the server has

  const sizeLabel = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

  /**
   * The photos area. "Add photos" opens the system's file picker; the picked images are shown as small
   * previews (the first is the cover) and can be removed. They are only kept here, in the card: nothing is
   * saved or uploaded yet. `picked` is the list of chosen File objects.
   */
  function photoZone(picked) {
    const input = h("input", { class: "visually-hidden", type: "file", accept: PHOTO_TYPES.join(","), multiple: true, tabindex: "-1", "aria-hidden": "true", "data-photo-input": "" });
    const note = h("p", { class: "creation__note", role: "status", hidden: true });
    const grid = h("div", { class: "creation__slots" });
    const count = h("span", { class: "dropzone__count", hidden: true });
    const add = h("button", { class: "btn btn--secondary btn--sm", type: "button", onclick: () => input.click() }, icon("plus"), "Add photos");

    function renderGrid() {
      grid.replaceChildren();
      count.hidden = picked.length === 0;
      count.textContent = `${picked.length} ${picked.length === 1 ? "photo" : "photos"} chosen`;
      if (picked.length === 0) return grid.append(...[0, 1, 2].map(() => h("span", { class: "creation__slot", "aria-hidden": "true" })));
      picked.forEach((entry, index) => {
        const img = h("img", { alt: entry.file.name, title: `${entry.file.name} · ${sizeLabel(entry.file.size)}` });
        if (entry.preview) img.src = entry.preview;
        grid.append(
          h(
            "figure",
            { class: "creation__thumb", "data-photo": entry.file.name },
            img,
            index === 0 ? h("span", { class: "creation__cover" }, "Cover") : null,
            h("button", { class: "creation__remove", type: "button", "aria-label": `Remove ${entry.file.name}`, onclick: () => {
              picked.splice(picked.indexOf(entry), 1);
              renderGrid();
            } }, icon("x")),
          ),
        );
      });
    }

    input.addEventListener("change", () => {
      const skipped = [];
      for (const file of [...input.files]) {
        if (!PHOTO_TYPES.includes(file.type)) skipped.push(`${file.name} is not a PNG, JPEG, WebP or GIF image`);
        else if (file.size > MAX_PHOTO_BYTES) skipped.push(`${file.name} is larger than 5 MB`);
        else if (file.size === 0) skipped.push(`${file.name} is empty`);
        else if (picked.some((e) => e.file.name === file.name && e.file.size === file.size && e.file.lastModified === file.lastModified)) skipped.push(`${file.name} is already chosen`);
        else {
          const entry = { file, preview: "" };
          picked.push(entry);
          const reader = new FileReader();
          reader.onload = () => {
            entry.preview = String(reader.result);
            if (picked.includes(entry)) renderGrid();
          };
          reader.readAsDataURL(file);
        }
      }
      input.value = ""; // so the same file can be picked again after it was removed
      note.hidden = skipped.length === 0;
      note.textContent = skipped.length ? `Not added: ${skipped.join("; ")}.` : "";
      renderGrid();
    });

    renderGrid();
    return h(
      "div",
      { class: "creation__photos" },
      h(
        "div",
        { class: "dropzone", role: "group", "aria-label": "Photos" },
        h("span", { class: "dropzone__icon" }, icon("inventory")),
        h("p", { class: "dropzone__title" }, "Photos"),
        h("p", { class: "dropzone__text" }, "Add photos of the product. The first one is the cover shown on the cards."),
        add,
        count,
        input,
      ),
      note,
      grid,
    );
  }

  function frameFields() {
    return [
      field("Name", text("e.g. Aviator Classic"), { name: "name", required: true, wide: true }),
      field("Reference", text("Manufacturer model code"), { name: "reference" }),
      field("Shape", select(SHAPES, "Choose a shape"), { name: "shape" }),
      field("Sex", select(GENDERS, "Not specified"), { name: "gender" }),
      field("Colors", text("Gold, Black, Silver"), { name: "colors", hint: "Separate the colors with commas.", wide: true }),
      h(
        "fieldset",
        { class: "creation__size field--wide" },
        h("legend", { class: "field__label" }, "Size ", h("span", { class: "creation__unit" }, "eye – bridge – temple, in mm")),
        h("div", { class: "creation__triple" }, field("Eye", number("52"), { name: "eyeSize" }), field("Bridge", number("18"), { name: "bridge" }), field("Temple", number("140"), { name: "templeLength" })),
        h("p", { class: "field__error", "data-error-for": "size", hidden: true }),
      ),
      priceRow(),
      field("Cost price", number("0"), { name: "costPrice" }),
      field("Stock", number("0", { step: "1" }), { name: "stock" }),
    ];
  }

  function accessoryFields() {
    return [
      field("Name", text("e.g. Hard Case"), { name: "name", required: true, wide: true }),
      field("Description", (id) => h("textarea", { class: "input", id, rows: "3", placeholder: "What it is and what it is for" }), { name: "description", required: true, wide: true }),
      priceRow(),
      field("Cost price", number("0"), { name: "costPrice" }),
      field("Stock", number("0", { step: "1" }), { name: "stock" }),
    ];
  }

  /** The bytes of a File, as the main process wants them. */
  async function readBytes(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  const errorText = (error) => String(error?.message ?? error).replace(/^\[[\w-]+\]\s*/, "");

  function open({ kind, category, brand, categoryId, brandId, gender, onCreated } = {}) {
    const isFrame = kind === "frame";
    const noun = isFrame ? "frame" : "accessory";
    const titleId = `cc-title-${++uid}`;
    const picked = []; // the chosen photos: { file, preview }

    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    // Frame: submits the form. Accessory: part of the picture only, it has no behaviour yet.
    const create = h("button", { class: "btn btn--primary", type: isFrame ? "submit" : "button", "data-action": "create" }, `Create ${noun}`);
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));

    const inherited = isFrame
      ? h(
          "div",
          { class: "creation__inherits", "data-inherited": "" },
          h("span", { class: "creation__inherits-label" }, "Added to"),
          h("span", { class: "tag" }, h("span", { class: "tag__key" }, "Category"), category ?? "—"),
          h("span", { class: "tag" }, h("span", { class: "tag__key" }, "Brand"), brand ?? "—"),
        )
      : null;

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h(
        "div",
        { class: "dialog__header" },
        h("div", null, h("h2", { class: "dialog__title", id: titleId }, `New ${noun}`), h("p", { class: "dialog__subtitle" }, "Fields marked * are required.")),
        close,
      ),
      h("div", { class: "dialog__body creation" }, banner, inherited, h("div", { class: "creation__layout" }, photoZone(picked), h("div", { class: "form-grid" }, isFrame ? frameFields() : accessoryFields()))),
      h("div", { class: "dialog__footer" }, cancel, create),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": titleId, "data-creation": noun }, form);
    document.body.append(dialog);
    if (isFrame && gender) setValue(dialog, "gender", gender); // the sex chosen on the page is the sex of the new frame (the person can change it)

    let busy = false;
    const dismiss = () => {
      if (!busy) dialog.close();
    };
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault()); // Escape does nothing while saving
    dialog.addEventListener("close", () => dialog.remove());

    // ---- showing the mistakes the main process found
    const photoNote = () => dialog.querySelector(".creation__note");
    function clearErrors() {
      banner.hidden = true;
      for (const el of dialog.querySelectorAll("[data-error-for]")) {
        el.hidden = true;
        el.textContent = "";
      }
      for (const el of dialog.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
    }
    function showErrors(errors) {
      let first = null;
      const general = [];
      for (const [key, message] of Object.entries(errors)) {
        const line = dialog.querySelector(`[data-error-for="${key}"]`);
        if (line) {
          line.textContent = message;
          line.hidden = false;
          const control = dialog.querySelector(`[name="${key}"]`);
          if (control) {
            control.setAttribute("aria-invalid", "true");
            first ??= control;
          }
        } else if (key === "photos") {
          const note = photoNote();
          note.textContent = message;
          note.hidden = false;
        } else general.push(message);
      }
      if (general.length) {
        banner.querySelector("span").textContent = general.join(" ");
        banner.hidden = false;
      }
      (first ?? (general.length ? banner : null))?.scrollIntoView?.({ block: "nearest" });
      first?.focus();
    }
    form.addEventListener("input", (event) => {
      const line = event.target?.name ? dialog.querySelector(`[data-error-for="${event.target.name}"]`) : null;
      if (line) {
        line.hidden = true;
        event.target.removeAttribute("aria-invalid");
      }
    });

    // ---- the click on "Create frame"
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!isFrame || busy) return; // a second click or Enter while saving does nothing
      clearErrors();
      const values = Object.fromEntries(new FormData(form).entries()); // read before the fields are locked (a locked field is left out)
      busy = true;
      for (const el of dialog.querySelectorAll("button, input, select, textarea")) el.disabled = true;
      create.replaceChildren(h("span", { class: "btn__spinner" }), "Creating…");
      // Gives the card back to the person (a locked field cannot take the focus, so this comes before showing a mistake).
      const unlock = () => {
        busy = false;
        for (const el of dialog.querySelectorAll("button, input, select, textarea")) el.disabled = false;
        create.replaceChildren(`Create ${noun}`);
      };
      try {
        const photos = await Promise.all(picked.map(async (entry) => ({ name: entry.file.name, bytes: await readBytes(entry.file) })));
        const result = await window.electronAPI.frames.create({ ...values, brandId, categoryId }, photos);
        if (result.status === "invalid") {
          unlock();
          return showErrors(result.errors);
        }
        busy = false;
        dialog.close();
        onCreated?.(result);
      } catch (error) {
        unlock();
        banner.querySelector("span").textContent = errorText(error);
        banner.hidden = false;
      }
    });

    dialog.showModal();
    dialog.querySelector("input")?.focus();
  }


  /** The photos the product has now: each can be marked "to remove" (and taken back); nothing happens until Save. */
  function currentPhotos(photos, removing, onChange) {
    const grid = h("div", { class: "creation__slots", "data-current-photos": "" });
    function render() {
      grid.replaceChildren();
      photos.forEach((photo, index) => {
        const marked = removing.has(photo.id);
        const img = h("img", { src: photo.url, alt: "Current photo" });
        img.addEventListener("error", () => img.remove());
        grid.append(
          h(
            "figure",
            { class: `creation__thumb${marked ? " creation__thumb--removed" : ""}`, "data-photo-id": photo.id },
            img,
            index === 0 && !marked ? h("span", { class: "creation__cover" }, "Cover") : null,
            marked ? h("span", { class: "creation__cover creation__cover--removed" }, "Will be removed") : null,
            h("button", { class: "creation__remove", type: "button", "aria-label": marked ? "Keep this photo" : "Remove this photo", title: marked ? "Keep this photo" : "Remove this photo", onclick: () => {
              if (marked) removing.delete(photo.id);
              else removing.add(photo.id);
              render();
              onChange();
            } }, icon(marked ? "refresh" : "trash")),
          ),
        );
      });
    }
    render();
    return h("div", { class: "creation__current" }, h("p", { class: "creation__subhead" }, photos.length ? `Photos now (${photos.length})` : "No photos yet"), photos.length ? grid : null);
  }

  function setValue(root, name, value) {
    const control = root.querySelector(`[name="${name}"]`);
    if (!control || value === null || value === undefined) return;
    if (control.tagName === "SELECT" && ![...control.options].some((o) => o.value === String(value))) control.append(h("option", { value: String(value) }, String(value)));
    control.value = String(value);
  }

  function openEdit({ kind, item, brands = [], categories = [], onUpdated, onDeleted } = {}) {
    const isFrame = kind === "frame";
    const noun = isFrame ? "frame" : "accessory";
    const titleId = `cc-title-${++uid}`;
    const picked = []; // new photos: { file, preview }
    const removing = new Set(); // ids of current photos marked for removal

    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const save = h("button", { class: "btn btn--primary", type: "submit", "data-action": "save" }, "Save changes");
    // Delete is offered only for a product that was never used (not on an order, not on a supplier order): until that is known the button is not there
    const del = h("button", { class: "btn btn--secondary btn--danger-text", type: "button", "data-action": "delete", hidden: true }, icon("trash"), `Delete ${noun}`);
    const kept = h("p", { class: "creation__kept", "data-kept": "", hidden: true }, isFrame ? "This frame is on orders, so it cannot be deleted." : "This accessory is on orders, so it cannot be deleted.");
    (isFrame ? window.electronAPI.frames : window.electronAPI.accessories).usage(item.id).then(
      (count) => { if (count > 0) kept.hidden = false; else del.hidden = false; },
      () => { del.hidden = false; }, // (not known: the button is there, and the deletion itself refuses a used one)
    );
    const banner = h("div", { class: "alert", role: "alert", hidden: true }, icon("alert"), h("span"));
    const choose = (list, name, label) => field(label, (id) => h("select", { class: "input", id }, list.map((o) => h("option", { value: String(o.id) }, o.name))), { name, required: true });

    const fields = isFrame ? [choose(categories, "categoryId", "Category"), choose(brands, "brandId", "Brand"), ...frameFields()] : accessoryFields();
    const summary = h("p", { class: "creation__summary", hidden: true });
    const photosBox = h("div", { class: "creation__photos-edit" }, currentPhotos(item.photos ?? [], removing, () => updateSummary()), photoZone(picked));
    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: titleId }, `Edit ${noun}`), h("p", { class: "dialog__subtitle" }, item.name)), close),
      h("div", { class: "dialog__body creation" }, banner, h("div", { class: "creation__layout" }, photosBox, h("div", { class: "form-grid" }, fields))),
      h("div", { class: "dialog__footer dialog__footer--split" }, h("div", { class: "creation__delete" }, del, kept), h("div", { class: "dialog__footer-main" }, summary, cancel, save)),
    );
    const dialog = h("dialog", { class: "dialog dialog--wide", "aria-labelledby": titleId, "data-edit": noun, "data-id": item.id }, form);
    document.body.append(dialog);

    // ---- fill the fields with what the product has now
    for (const name of ["name", "reference", "shape", "price", "currency", "costPrice", "stock", "eyeSize", "bridge", "templeLength", "description", "categoryId", "brandId", "gender"]) setValue(dialog, name, item[name]);
    if (isFrame) setValue(dialog, "colors", (item.colors ?? []).join(", "));
    if (!item.currency) setValue(dialog, "currency", "DZD");

    function updateSummary() {
      summary.textContent = removing.size ? `${removing.size} ${removing.size === 1 ? "photo" : "photos"} to remove` : "";
      summary.hidden = removing.size === 0;
    }

    let busy = false;
    const lock = (on) => {
      busy = on;
      for (const el of dialog.querySelectorAll("button, input, select, textarea")) el.disabled = on;
    };
    const dismiss = () => {
      if (!busy) dialog.close();
    };
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("cancel", (event) => busy && event.preventDefault());
    dialog.addEventListener("close", () => dialog.remove());

    const photoNote = () => dialog.querySelector(".creation__note");
    function clearErrors() {
      banner.hidden = true;
      for (const el of dialog.querySelectorAll("[data-error-for]")) {
        el.hidden = true;
        el.textContent = "";
      }
      for (const el of dialog.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
    }
    function showErrors(errors) {
      let first = null;
      const general = [];
      for (const [key, message] of Object.entries(errors)) {
        const line = dialog.querySelector(`[data-error-for="${key}"]`);
        if (line) {
          line.textContent = message;
          line.hidden = false;
          const control = dialog.querySelector(`[name="${key}"]`);
          if (control) {
            control.setAttribute("aria-invalid", "true");
            first ??= control;
          }
        } else if (key === "photos") {
          const note = photoNote();
          note.textContent = message;
          note.hidden = false;
        } else general.push(message);
      }
      if (general.length) {
        banner.querySelector("span").textContent = general.join(" ");
        banner.hidden = false;
      }
      (first ?? (general.length ? banner : null))?.scrollIntoView?.({ block: "nearest" });
      first?.focus();
    }
    const fail = (error) => {
      banner.querySelector("span").textContent = errorText(error);
      banner.hidden = false;
      banner.scrollIntoView?.({ block: "nearest" });
    };
    form.addEventListener("input", (event) => {
      const line = event.target?.name ? dialog.querySelector(`[data-error-for="${event.target.name}"]`) : null;
      if (line) {
        line.hidden = true;
        event.target.removeAttribute("aria-invalid");
      }
    });

    // ---- "Save changes"
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      clearErrors();
      const values = Object.fromEntries(new FormData(form).entries()); // read before the fields are locked
      lock(true);
      save.replaceChildren(h("span", { class: "btn__spinner" }), "Saving…");
      const unlock = () => {
        lock(false);
        save.replaceChildren("Save changes");
      };
      try {
        const photos = await Promise.all(picked.map(async (entry) => ({ name: entry.file.name, bytes: await readBytes(entry.file) })));
        const api = isFrame ? window.electronAPI.frames : window.electronAPI.accessories;
        const sent = isFrame ? { ...values, brandId: values.brandId, categoryId: Number(values.categoryId) } : values;
        const result = await api.edit(item.id, sent, photos, [...removing]);
        if (result.status === "invalid") {
          unlock();
          return showErrors(result.errors);
        }
        busy = false;
        dialog.close();
        onUpdated?.(result);
      } catch (error) {
        unlock();
        fail(error);
      }
    });

    // ---- "Delete": asks once more inside the card, then deletes here and on the server
    del.addEventListener("click", () => {
      if (busy) return;
      clearErrors();
      const sure = h("button", { class: "btn btn--danger", type: "button", "data-action": "confirm-delete" }, icon("trash"), "Yes, delete it");
      const keep = h("button", { class: "btn btn--secondary", type: "button", "data-action": "keep" }, "Keep it");
      const count = (item.photos ?? []).length;
      const box = h("div", { class: "creation__confirm", role: "alertdialog", "aria-label": "Confirm delete" }, h("p", null, `Delete “${item.name}”${count ? ` and its ${count} ${count === 1 ? "photo" : "photos"}` : ""}? It is removed from this computer and from the server. This cannot be undone.`), h("div", { class: "creation__confirm-actions" }, keep, sure));
      const footer = dialog.querySelector(".dialog__footer");
      const normal = [...footer.childNodes];
      footer.replaceChildren(box);
      keep.focus();
      keep.addEventListener("click", () => {
        footer.replaceChildren(...normal);
        del.focus();
      });
      sure.addEventListener("click", async () => {
        lock(true);
        sure.replaceChildren(h("span", { class: "btn__spinner" }), "Deleting…");
        try {
          const api = isFrame ? window.electronAPI.frames : window.electronAPI.accessories;
          const result = await api.delete(item.id);
          busy = false;
          dialog.close();
          onDeleted?.(result);
        } catch (error) {
          lock(false);
          footer.replaceChildren(...normal);
          fail(error);
        }
      });
    });

    dialog.showModal();
    dialog.querySelector("input")?.focus();
  }

  window.openEditCard = openEdit;
  window.openCreationCard = open;
})();
