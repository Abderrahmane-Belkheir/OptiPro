// The page shown instead of the app when the licence is over: either the day saved on this computer is before today, or the server refused the key
// (?refused=1). The main process opens it (see src/main.ts); it has no access to the app and nothing runs behind it. It names no date.
(() => {
  "use strict";

  const refused = new URLSearchParams(location.search).get("refused") === "1";
  document.getElementById("expired-text").textContent = window.i18n.t(
    refused
      ? "The server no longer accepts this copy of OptiPro. Please contact support."
      : "This copy of OptiPro can no longer be used. Its licence has ended. Please contact support to renew it.",
  );
  document.documentElement.dataset.ready = "true";
})();
