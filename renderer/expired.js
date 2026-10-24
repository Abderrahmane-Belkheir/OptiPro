// The page shown instead of the app when the server no longer accepts the shop's key (unknown, or its licence ended). The settings file has been removed; the app ends
// when this window is closed, and the next start asks for a valid key. The main process opens it (see src/main.ts); it has no access to the app and nothing runs behind it.
(() => {
  "use strict";

  document.getElementById("expired-text").textContent = window.i18n.t("The server no longer accepts this copy of OptiPro. Its settings were set aside: contact support, then start OptiPro again and check your key.");
  document.documentElement.dataset.ready = "true";
})();
