// The setup page (setup.html), shown instead of the app while the settings file is missing or lacks tenant.key or server.url.
// When the settings file is gone but this computer's database still holds the shop's details, only the tenant key and the server address are asked for
// (the details are the saved ones; a wrong key is refused by the server like in the whole form). Only if the saved details have disappeared meanwhile does the main
// process answer "need-details", and then the whole form appears.
// Confirm sends the form to the main process (window.setupAPI.confirm, src/setupPreload.ts), which asks the server to register the shop:
//   activated -> the settings file is written and the app starts (this window is replaced by the app's)
//   invalid   -> the details are wrong, the server refused the key or could not be reached: the message is shown and the field is marked; the
//                form stays open and can be corrected and sent again (the app never closes because of it)
(() => {
  "use strict";

  const form = document.getElementById("setup-form");
  const confirm = document.getElementById("setup-confirm");
  const status = document.getElementById("setup-status");
  const FIELDS = {
    tenantKey: "tenant-key",
    serverUrl: "server-url",
    name: "shop-name",
    phone: "shop-phone",
    email: "shop-email",
    address: "shop-address",
    instagramUrl: "shop-instagram",
    tiktokUrl: "shop-tiktok",
  };

  const intro = document.getElementById("setup-intro");
  const FULL_INTRO = intro.textContent;
  const SHORT_INTRO = "The settings file is missing, but this computer already has your shop's information. Enter the shop's key and its server address.";
  const detailGroups = [...document.querySelectorAll("[data-details]")];
  let short = false;

  /** Short: only the connection fields. Full: the whole form. */
  function setMode(wantShort) {
    short = wantShort;
    form.dataset.mode = short ? "short" : "full";
    for (const group of detailGroups) group.hidden = short;
    intro.textContent = short ? SHORT_INTRO : FULL_INTRO;
  }

  function show(message, tone) {
    status.hidden = !message;
    status.textContent = message ?? "";
    status.dataset.tone = tone ?? "";
  }

  function mark(field) {
    for (const id of Object.values(FIELDS)) document.getElementById(id).removeAttribute("aria-invalid");
    const el = field ? document.getElementById(FIELDS[field]) : null;
    if (el) {
      el.setAttribute("aria-invalid", "true");
      el.focus();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (confirm.disabled) return;
    const details = short
      ? { tenantKey: document.getElementById(FIELDS.tenantKey).value, serverUrl: document.getElementById(FIELDS.serverUrl).value, useSaved: true }
      : Object.fromEntries(Object.entries(FIELDS).map(([field, id]) => [field, document.getElementById(id).value]));
    confirm.disabled = true;
    mark(null);
    show("Activating… this can take a moment on a slow connection.", "busy");
    let outcome;
    try {
      outcome = await window.setupAPI.confirm(details);
    } catch {
      outcome = { kind: "invalid", message: "The app could not complete the activation. Try again." };
    }
    if (outcome.kind === "activated") {
      show("Activated. Starting the app…", "ok");
      return; // the main process replaces this window
    }
    if (outcome.kind === "need-details") {
      setMode(false); // the saved details are gone: the whole form
      show(outcome.message, "error");
      mark("name");
      confirm.disabled = false;
      return;
    }
    show(outcome.message, "error");
    mark(outcome.field);
    confirm.disabled = false;
  });

  (async () => {
    try {
      const context = await window.setupAPI.context();
      setMode(context?.savedShop === true);
      // The app was stopped because the server stopped accepting the key (or the key could not be checked): the key and the address it had are filled in.
      if (context?.prefill) {
        document.getElementById(FIELDS.tenantKey).value = context.prefill.tenantKey;
        document.getElementById(FIELDS.serverUrl).value = context.prefill.serverUrl;
        show(
          context.prefill.reason === "refused"
            ? "The server does not accept this shop's key. Check the key and the server address, then confirm."
            : "The server could not be reached, so the key could not be checked. Check the internet connection and the server address, then confirm.",
          "error",
        );
      }
    } catch {
      setMode(false);
    }
    form.dataset.ready = "true"; // the form can be used (a test waits for this before it clicks)
  })();
})();
