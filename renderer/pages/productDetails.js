// The details page of a frame (#inventory/frames/<id>) or an accessory (#inventory/accessories/<id>): the product with its photos and its details,
// and how much of it was sold (units in total and in the last 30 days). Real data, read through window.electronAPI.frames.details(id) /
// window.electronAPI.accessories.details(id) (src/local/frameDetails.ts, accessoryDetails.ts).
//
//   window.productDetailsActions   <- the buttons of the page. "Print QR code" opens a card (how many, and a preview of the label: the QR code with the
//   product's code below it). The card's Print button calls printLabels, which prints through window.electronAPI.labels.print (src/local/labelService.ts):
//   one label per page, the page being the label's size (label.width / label.height in config.properties), to the printer named in label.printer or,
//   when none is named, the one the person chooses in the system's print dialog.
(() => {
  "use strict";

  const CURRENCY = "DZD";

  /** What the page's buttons do. */
  const productDetailsActions = {
    /** "Print QR code": opens the card where the person chooses how many labels and sees what will be printed. `kind` is "frame" or "accessory". */
    printQr(product, kind) {
      openQrCard(product, kind);
    },
    /** The card's Print button: prints `job.copies` labels of the product. Answers what the printer did: { status: "sent" | "cancelled" | "saved", labels }. */
    printLabels(job) {
      return window.electronAPI.labels.print({ kind: job.kind, code: job.code, copies: job.copies });
    },
  };
  window.productDetailsActions = productDetailsActions;

  /** What differs between the two kinds of page. */
  const KINDS = {
    frames: {
      kind: "frame",
      load: (id) => window.electronAPI.frames.details(id),
      list: "inventory/frames",
      title: "Frames",
      subtitle: (p) => [p.brandName, p.categoryName].filter(Boolean).join(" · "),
      rows: (p, row, price) => {
        const size = [p.eyeSize, p.bridge, p.templeLength].every((v) => v !== null) ? `${p.eyeSize}-${p.bridge}-${p.templeLength} mm` : null;
        return [row("brand", "Brand", p.brandName), row("category", "Category", p.categoryName), row("reference", "Reference", p.reference), row("shape", "Shape", p.shape), row("gender", "Sex", ({ female: "Female", male: "Male", unisex: "Unisex" })[p.gender] ?? null), row("colors", "Colors", p.colors.join(" / ")), row("size", "Size (eye-bridge-temple)", size), row("price", "Price", price(p.price, p.currency)), row("cost", "Cost price", price(p.costPrice, p.currency))];
      },
    },
    accessories: {
      kind: "accessory",
      load: (id) => window.electronAPI.accessories.details(id),
      list: "inventory/accessories",
      title: "Accessories",
      subtitle: () => "",
      rows: (p, row, price) => [row("description", "Description", p.description), row("price", "Price", price(p.price, p.currency)), row("cost", "Cost price", price(p.costPrice, p.currency))],
    },
  };

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

  /** A price as stored (in the product's own currency, not cents). */
  function price(value, currency) {
    if (value === null || value === undefined) return null;
    const code = /^[A-Za-z]{3}$/.test(currency ?? "") ? currency.toUpperCase() : CURRENCY;
    const whole = Number.isInteger(value);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: code, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
    } catch {
      return `${value} ${code}`;
    }
  }

  // ---- The QR code card ----------------------------------------------------------------------

  const MAX_COPIES = 200;

  /** How many labels the person typed: a whole number from 1 to 200, or null. */
  function copiesOf(text) {
    const t = String(text).trim();
    if (!/^\d{1,4}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= MAX_COPIES ? n : null;
  }

  function openQrCard(product, kind) {
    const copies = h("input", { class: "input qr-copies", type: "text", inputmode: "numeric", id: "qr-copies", name: "copies", value: "1", autocomplete: "off", "aria-describedby": "qr-copies-error" });
    const copiesError = h("p", { class: "field__error", id: "qr-copies-error", hidden: true });
    const label = h("div", { class: "qr-label", "data-qr-label": "" }, h("p", { class: "qr-label__loading" }, "Making the QR code…"));
    const address = h("p", { class: "qr-address", "data-qr-address": "" });
    const count = h("p", { class: "qr-count", "data-qr-count": "" });
    const sizeInfo = h("p", { class: "qr-size", "data-qr-size": "" });
    const status = h("p", { class: "qr-status", "data-qr-status": "", role: "status", "aria-live": "polite", hidden: true });
    const print = h("button", { class: "btn btn--primary", type: "submit", id: "qr-print", "data-action": "confirm-print", disabled: true }, "Print");
    const cancel = h("button", { class: "btn btn--secondary", type: "button" }, "Cancel");
    const close = h("button", { class: "icon-button", type: "button", "aria-label": "Close" }, icon("x"));
    let ready = null; // { url, svg } once made
    let busy = false;

    const form = h(
      "form",
      { class: "dialog__form", novalidate: true },
      h("div", { class: "dialog__header" }, h("div", null, h("h2", { class: "dialog__title", id: "qr-card-title" }, "Print QR codes"), h("p", { class: "dialog__subtitle" }, product.name)), close),
      h(
        "div",
        { class: "dialog__body qr-card" },
        h("div", { class: "field" }, h("label", { class: "field__label", for: "qr-copies" }, "How many labels?"), copies, copiesError),
        h("div", { class: "qr-preview" }, h("span", { class: "qr-preview__title" }, "What will be printed"), label, count, sizeInfo, address),
        status,
      ),
      h("div", { class: "dialog__footer" }, cancel, print),
    );
    const dialog = h("dialog", { class: "dialog dialog--narrow", "aria-labelledby": "qr-card-title", "data-qr-card": product.code ?? "" }, form);
    document.body.append(dialog);

    function update() {
      const n = copiesOf(copies.value);
      copiesError.textContent = n === null ? `Enter a whole number from 1 to ${MAX_COPIES}.` : "";
      copiesError.hidden = n !== null;
      if (n === null) copies.setAttribute("aria-invalid", "true");
      else copies.removeAttribute("aria-invalid");
      count.textContent = n === null ? "" : n === 1 ? "1 label" : `${n} labels, all the same`;
      print.disabled = n === null || ready === null || busy;
    }

    function setStatus(text, kind) {
      status.textContent = text;
      status.hidden = !text;
      status.dataset.kind = kind ?? "";
    }
    copies.addEventListener("input", update);

    const dismiss = () => dialog.close();
    cancel.addEventListener("click", dismiss);
    close.addEventListener("click", dismiss);
    dialog.addEventListener("close", () => dialog.remove());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const n = copiesOf(copies.value);
      if (n === null || ready === null || busy) return;
      busy = true;
      copies.disabled = true;
      update();
      setStatus("Sending to the printer…", "info");
      try {
        const result = await productDetailsActions.printLabels({ kind, code: product.code, name: product.name, url: ready.url, copies: n });
        if (result?.status === "cancelled") setStatus("Printing was cancelled.", "info");
        else if (result?.status === "saved") setStatus(`Saved to ${result.file}`, "ok");
        else setStatus(`Sent to the printer: ${result?.labels ?? n} ${(result?.labels ?? n) === 1 ? "label" : "labels"}.`, "ok");
      } catch (error) {
        setStatus(errorText(error), "error");
      } finally {
        busy = false;
        copies.disabled = false;
        update();
      }
    });

    (async () => {
      if (!product.code) {
        label.replaceChildren(h("p", { class: "qr-label__error", role: "alert" }, `This ${kind} has no code yet. It gets one the next time the app starts.`));
        return;
      }
      try {
        const made = await window.electronAPI.labels.qr(kind, product.code);
        if (!dialog.isConnected) return;
        ready = made;
        const qr = h("div", { class: "qr-label__qr", "data-qr": "" });
        qr.innerHTML = made.svg; // made by this app's main process (the QR library), never from typed text
        label.replaceChildren(qr, h("p", { class: "qr-label__code", "data-qr-code": "" }, product.code));
        address.textContent = `Scanning it opens ${made.url}`;
        update();
        try {
          const s = await window.electronAPI.labels.settings();
          if (!dialog.isConnected) return;
          sizeInfo.textContent = `Label size ${s.widthMm} × ${s.heightMm} mm, QR code ${s.qrMm} mm · ${s.printer ? `printer: ${s.printer}` : "you choose the printer when printing"}`;
          sizeInfo.dataset.small = String(s.scanRisk);
          if (s.scanRisk) {
            sizeInfo.textContent += s.dotsPerModule === null
              ? `. The QR code is small on this label size and may not scan; use a bigger label.`
              : `. Each square of the QR code is only about ${s.dotsPerModule} printer dots wide (it needs 4 or more), so it may not scan: use a bigger label, or a shorter server address.`;
          }
        } catch (error) {
          sizeInfo.textContent = errorText(error); // a bad label.width / label.height in the settings file says so
          sizeInfo.dataset.small = "true";
        }
      } catch (error) {
        if (!dialog.isConnected) return;
        label.replaceChildren(h("p", { class: "qr-label__error", role: "alert", "data-qr-error": "" }, `The QR code couldn't be made: ${errorText(error)}`));
      }
    })();

    update();
    dialog.showModal();
    copies.focus();
    copies.select();
  }

  // ---- The page ------------------------------------------------------------------------------

  let root = null;
  let shownId = null;
  let token = 0;

  function build(config, id) {
    const goBack = () => (location.hash = config.list);
    const body = h("div", { class: "frame-details product-details", "data-kind": config.kind }, h("p", { class: "rx__loading" }, `Loading the ${config.kind}…`));
    const mine = ++token;
    (async () => {
      try {
        const product = await config.load(id);
        if (mine !== token || !body.isConnected) return;
        if (!product) {
          body.replaceChildren(h("div", { class: "state panel-state", "data-state": "missing" }, h("h4", { class: "state__title" }, `This ${config.kind} no longer exists`), h("button", { class: "btn btn--secondary", type: "button", onclick: goBack }, `Back to the ${config.title.toLowerCase()}`)));
          return;
        }
        body.replaceChildren(...render(config, product));
        document.title = `${product.name} · ${config.title}`;
      } catch (error) {
        if (mine === token && body.isConnected) body.replaceChildren(h("div", { class: "state panel-state state--error", role: "alert", "data-state": "error" }, h("h4", { class: "state__title" }, `The ${config.kind} couldn't be loaded`), h("p", { class: "state__text" }, errorText(error))));
      }
    })();
    const back = h("button", { class: "back-button", type: "button", "aria-label": `Back to the ${config.title.toLowerCase()}`, onclick: goBack }, icon("arrow-left"));
    return h("section", { class: "page", "aria-label": `${config.kind[0].toUpperCase()}${config.kind.slice(1)} details` }, back, body);
  }

  function gallery(frame) {
    const main = h("div", { class: "fd-photo", "data-photo": frame.photos.length ? "shown" : "none" });
    const thumbs = h("div", { class: "fd-thumbs" });
    const placeholder = () => h("div", { class: "frame-card__placeholder" }, icon("glasses"), h("span", null, "No photo"));
    function show(index) {
      const photo = frame.photos[index];
      main.replaceChildren();
      if (!photo) return main.append(placeholder());
      const img = h("img", { src: photo.url, alt: frame.name, decoding: "async" });
      img.addEventListener("error", () => {
        img.remove();
        main.dataset.photo = "failed";
        main.append(placeholder());
      });
      main.dataset.photo = "shown";
      main.append(img);
      [...thumbs.children].forEach((t, i) => t.setAttribute("aria-current", String(i === index)));
    }
    frame.photos.forEach((photo, index) => {
      if (frame.photos.length < 2) return;
      const thumb = h("button", { class: "fd-thumb", type: "button", "aria-label": `Photo ${index + 1}`, "aria-current": String(index === 0), onclick: () => show(index) }, h("img", { src: photo.url, alt: "" }));
      thumb.querySelector("img").addEventListener("error", () => thumb.remove());
      thumbs.append(thumb);
    });
    show(0);
    return h("div", { class: "fd-gallery" }, main, thumbs);
  }

  function render(config, frame) {
    const tile = (key, label, value, sub) => h("div", { class: "fd-stat", "data-stat": key }, h("span", { class: "fd-stat__label" }, label), h("span", { class: "fd-stat__value" }, value), sub ? h("span", { class: "fd-stat__sub" }, sub) : null);
    const row = (key, label, value) => h("div", { class: "fd-row", "data-row": key }, h("dt", { class: "fd-row__key" }, label), h("dd", { class: `fd-row__value${value ? "" : " fd-row__value--empty"}` }, value || "—"));
    const stockBadge = h("span", { class: `stock${frame.stock > 0 ? "" : " stock--out"}` }, frame.stock > 0 ? `${frame.stock} in stock` : "Out of stock");

    const header = h(
      "header",
      { class: "page__header fd-header" },
      h(
        "div",
        null,
        h("h2", { class: "page__title", "data-field": "name" }, frame.name),
        h("p", { class: "page__description" }, h("span", { class: "fd-code", "data-field": "code", title: "The code on the label" }, frame.code ?? "No code"), config.subtitle(frame)),
      ),
      h("button", { class: "btn btn--secondary", type: "button", id: "print-qr", "data-action": "print-qr", onclick: () => productDetailsActions.printQr(frame, config.kind) }, "Print QR code"),
    );

    const stats = h(
      "div",
      { class: "fd-stats" },
      tile("total", "Sold in total", String(frame.sold.total), frame.sold.total === 1 ? "unit" : "units"),
      tile("last30", "Sold in the last 30 days", String(frame.sold.last30Days), frame.sold.last30Days === 1 ? "unit" : "units"),
      tile("last", "Last sold", frame.sold.lastSoldAt ? dayFormat.format(new Date(frame.sold.lastSoldAt)) : "Never", null),
    );

    const details = h(
      "dl",
      { class: "fd-list" },
      ...config.rows(frame, row, price),
      h("div", { class: "fd-row", "data-row": "stock" }, h("dt", { class: "fd-row__key" }, "Stock"), h("dd", { class: "fd-row__value" }, stockBadge)),
    );

    return [header, h("div", { class: "fd-layout" }, gallery(frame), h("div", { class: "fd-side" }, stats, details))];
  }

  // ---- Mounting ------------------------------------------------------------------------------

  function route() {
    const content = document.getElementById("content");
    const match = /^inventory\/(frames|accessories)\/([^/]+)$/.exec(location.hash.slice(1));
    const wanted = match ? `${match[1]}/${decodeURIComponent(match[2])}` : null;
    if (wanted !== null && wanted === shownId && root?.isConnected) return;
    if (root) {
      root.remove();
      root = null;
      shownId = null;
      token++;
    }
    if (wanted !== null) {
      shownId = wanted;
      root = build(KINDS[match[1]], decodeURIComponent(match[2]));
      content.replaceChildren(root);
      root.querySelector(".back-button").focus();
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
