// The setup page (setup.html), shown instead of the app while the settings file is missing or lacks tenant.key or server.url.
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
    const details = Object.fromEntries(Object.entries(FIELDS).map(([field, id]) => [field, document.getElementById(id).value]));
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
    show(outcome.message, "error");
    mark(outcome.field);
    confirm.disabled = false;
  });
  form.dataset.ready = "true"; // the form can be used (a test waits for this before it clicks)
})();
