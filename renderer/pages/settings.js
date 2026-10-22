// The Settings page (#settings): the shop's own information (name, phone, email, address, Instagram, TikTok).
// The boxes start EMPTY and show what the shop has now as their placeholder: only what is typed changes, an empty box stays as it is. Confirming goes through
// window.electronAPI.shopInfo.save, which validates, keeps the change on this computer and sends it to the server (with a null for every field that did not
// change); when the server can not be reached the change waits and the sync pass sends it later.
(() => {
  "use strict";

  const api = window.electronAPI.shopInfo;
  const FIELDS = [
    ["name", "Shop name", { autocomplete: "organization" }],
    ["phone", "Phone", { type: "tel", autocomplete: "tel" }],
    ["email", "Email", { type: "email", autocomplete: "email" }],
    ["address", "Address", { autocomplete: "street-address", wide: true }],
    ["instagramUrl", "Instagram", { type: "url", spellcheck: "false" }],
    ["tiktokUrl", "TikTok", { type: "url", spellcheck: "false" }],
  ];

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

  function toast(message, kind = "success") {
    let box = document.querySelector(".toasts");
    if (!box) {
      box = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
      document.body.append(box);
    }
    const el = h("div", { class: `toast toast--${kind}` }, icon(kind === "error" ? "alert" : "check"), h("span", null, message));
    box.append(el);
    setTimeout(() => el.remove(), kind === "error" ? 8000 : 4000);
  }

  const state = { status: "loading", info: null, error: "", token: 0, busy: false };
  let root = null;
  let refs = null;

  async function load() {
    const token = ++state.token;
    state.status = "loading";
    render();
    try {
      const info = await api.get();
      if (token !== state.token) return;
      state.info = info;
      state.status = info === null ? "empty" : "ready";
    } catch (error) {
      if (token !== state.token) return;
      state.status = "error";
      state.error = errorText(error);
    }
    render();
  }

  function build() {
    refs = { inputs: {}, errors: {}, banner: null, sync: null, save: null, note: null };
    const banner = h("div", { class: "alert", role: "alert", hidden: true, "data-banner": "" }, icon("alert"), h("span"));
    refs.banner = banner;
    const fieldEls = FIELDS.map(([name, label, props]) => {
      const id = `shop-${name}`;
      const input = h("input", { class: "input", id, name, type: props.type ?? "text", autocomplete: props.autocomplete ?? "off", spellcheck: props.spellcheck ?? false, "aria-describedby": `${id}-error` });
      const error = h("p", { class: "field__error", id: `${id}-error`, hidden: true });
      input.addEventListener("input", () => setError(name, ""));
      refs.inputs[name] = input;
      refs.errors[name] = error;
      return h("div", { class: `field${props.wide ? " field--wide" : ""}` }, h("label", { class: "field__label", for: id }, label), input, error);
    });
    refs.sync = h("p", { class: "settings-sync", role: "status", "data-sync": "" });
    refs.note = h("p", { class: "settings-note", role: "status", "data-note": "", hidden: true });
    refs.save = h("button", { class: "btn btn--primary", type: "submit", id: "save-shop-info", "data-action": "save" }, "Save changes");
    const form = h(
      "form",
      { class: "settings-form", novalidate: true, "data-shop-form": "", onsubmit: submit },
      banner,
      h("p", { class: "settings-hint" }, "The boxes show what you have now. Type only what you want to change: a box left empty stays as it is."),
      h("div", { class: "form-grid" }, fieldEls),
      h("div", { class: "settings-actions" }, refs.save, refs.sync),
      refs.note,
    );
    return h(
      "section",
      { class: "page", "aria-labelledby": "settings-title", "data-settings-page": "" },
      h("header", { class: "page__header" }, h("div", null, h("h2", { class: "page__title", id: "settings-title" }, "Settings"), h("p", { class: "page__description" }, "Your shop's information, as your customers and your website show it."))),
      h("div", { class: "table-card settings-card" }, h("h3", { class: "settings-card__title" }, "Shop information"), form),
    );
  }

  function setError(name, message) {
    const box = refs?.errors[name];
    if (!box) return;
    box.textContent = message;
    box.hidden = !message;
    if (message) refs.inputs[name].setAttribute("aria-invalid", "true");
    else refs.inputs[name].removeAttribute("aria-invalid");
  }

  function say(message) {
    refs.note.textContent = message;
    refs.note.hidden = !message;
  }

  function render() {
    if (!root || !refs) return;
    const ready = state.status === "ready";
    for (const [name] of FIELDS) {
      const input = refs.inputs[name];
      input.disabled = !ready || state.busy;
      input.placeholder = ready ? state.info[name] ?? "Not set" : "";
    }
    refs.save.disabled = !ready || state.busy;
    refs.banner.hidden = true;
    if (state.status === "empty") showBanner("This computer has no record of your shop yet, so the information can't be edited. Start the app once with the server reachable.");
    if (state.status === "error") showBanner(`The shop information couldn't be loaded: ${state.error}`);
    refs.sync.hidden = !ready;
    refs.sync.dataset.synced = ready ? String(state.info.onServer) : "";
    refs.sync.textContent = ready ? (state.info.onServer ? "Up to date on the server." : "Saved on this computer. It will be sent to the server automatically.") : "";
  }

  function showBanner(message) {
    refs.banner.querySelector("span").textContent = message;
    refs.banner.hidden = !message;
  }

  async function submit(event) {
    event.preventDefault();
    if (state.busy || state.status !== "ready") return;
    showBanner("");
    say("");
    for (const [name] of FIELDS) setError(name, "");
    const values = Object.fromEntries(FIELDS.map(([name]) => [name, refs.inputs[name].value.trim()]));
    state.busy = true;
    refs.save.replaceChildren(h("span", { class: "btn__spinner" }), "Saving…");
    render();
    try {
      const result = await api.save(values);
      if (result.status === "invalid") {
        for (const [name, message] of Object.entries(result.errors)) setError(name, message);
        const first = FIELDS.find(([name]) => result.errors[name]);
        if (first) refs.inputs[first[0]].focus();
      } else if (result.status === "unchanged") {
        say("Nothing to change: type a new value in a box first.");
      } else {
        state.info = result.info;
        for (const [name] of FIELDS) refs.inputs[name].value = ""; // the boxes show what is saved as their placeholder again
        if (result.sentToServer) toast("Your shop information was saved.");
        else toast("Saved on this computer. The server could not take it now: it will be sent automatically.", "error");
      }
    } catch (error) {
      showBanner(errorText(error));
    }
    state.busy = false;
    refs.save.replaceChildren("Save changes");
    render();
  }

  function route() {
    const content = document.getElementById("content");
    const here = location.hash.slice(1) === "settings";
    if (here && !root) {
      root = build();
      content.replaceChildren(root);
      load(); // read again each time the page is opened
    } else if (!here && root) {
      root.remove();
      root = null;
      refs = null;
      state.token++;
    }
  }

  window.addEventListener("hashchange", route);
  route();
})();
