// Behaviour of the application shell: which page is active, the collapsible sidebar and the
// profile menu. Plain script, no dependencies. It only drives the shell; there are no pages yet,
// so choosing a navigation entry just updates the active item and the title in the top bar.
(() => {
  "use strict";

  const STORE_NAME = "Maison Clair";
  const SIDEBAR_KEY = "optipro.sidebar";
  const DEFAULT_PAGE = "dashboard";

  const app = document.querySelector(".app");
  const navLinks = [...document.querySelectorAll(".nav-item[data-page]")];
  const pageTitle = document.getElementById("page-title");
  const pageEyebrow = document.getElementById("page-eyebrow");

  // ---- Active page ---------------------------------------------------------------------------
  // The page is the URL hash (#dashboard, #inventory, …), so a page can later hook into the same
  // value without the shell changing.

  function showPage() {
    const wanted = location.hash.slice(1) || DEFAULT_PAGE;
    const active = navLinks.find((link) => link.dataset.page === wanted) ?? navLinks.find((link) => link.dataset.page === DEFAULT_PAGE);
    for (const link of navLinks) {
      if (link === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    const label = active.querySelector(".nav-item__label").textContent.trim();
    pageTitle.textContent = label;
    pageEyebrow.textContent = active.dataset.eyebrow; // the navigation group the page belongs to
    document.title = `${label} · ${STORE_NAME}`;
  }

  window.addEventListener("hashchange", showPage);
  showPage();

  // ---- Sidebar -------------------------------------------------------------------------------
  // Expanded or icon-only. The choice is remembered; below 1024 px wide the sidebar is always
  // icon-only to leave room for the page, and the toggle is hidden.

  const toggle = document.getElementById("sidebar-toggle");
  const toggleIcon = toggle.querySelector("use");
  const toggleLabel = toggle.querySelector(".nav-item__label");
  const narrow = window.matchMedia("(max-width: 1023px)");

  function readPreference() {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
    } catch {
      return false;
    }
  }

  let userCollapsed = readPreference();

  function renderSidebar() {
    const collapsed = userCollapsed || narrow.matches;
    app.dataset.sidebar = collapsed ? "collapsed" : "expanded";

    toggle.hidden = narrow.matches;
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    toggleLabel.textContent = collapsed ? "Expand" : "Collapse";
    toggleIcon.setAttribute("href", collapsed ? "#i-sidebar-open" : "#i-sidebar-close");

    // With the words hidden, a native tooltip tells what each icon is.
    for (const link of navLinks) {
      const label = link.querySelector(".nav-item__label").textContent.trim();
      if (collapsed) link.title = label;
      else link.removeAttribute("title");
    }
    if (collapsed) toggle.title = toggle.getAttribute("aria-label");
    else toggle.removeAttribute("title");
  }

  toggle.addEventListener("click", () => {
    userCollapsed = !userCollapsed;
    try {
      localStorage.setItem(SIDEBAR_KEY, userCollapsed ? "collapsed" : "expanded");
    } catch {
      // a private or restricted profile can't store it; the choice just isn't remembered
    }
    renderSidebar();
  });

  narrow.addEventListener("change", renderSidebar);
  renderSidebar();

  // ---- Search --------------------------------------------------------------------------------
  // Visual only for now: submitting does nothing.
  document.querySelector(".search").addEventListener("submit", (event) => event.preventDefault());

  // ---- Profile menu --------------------------------------------------------------------------

  const profileButton = document.getElementById("profile-button");
  const profileMenu = document.getElementById("profile-menu");
  const menuItems = [...profileMenu.querySelectorAll('[role="menuitem"]')];

  function openMenu(focusFirst) {
    profileMenu.hidden = false;
    profileButton.setAttribute("aria-expanded", "true");
    if (focusFirst) menuItems[0].focus();
  }

  function closeMenu(returnFocus) {
    if (profileMenu.hidden) return;
    profileMenu.hidden = true;
    profileButton.setAttribute("aria-expanded", "false");
    if (returnFocus) profileButton.focus();
  }

  // A click with detail 0 came from the keyboard (Enter or Space): move into the menu, as a native menu does.
  profileButton.addEventListener("click", (event) => (profileMenu.hidden ? openMenu(event.detail === 0) : closeMenu(false)));

  profileButton.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu(true);
    }
  });

  profileMenu.addEventListener("keydown", (event) => {
    const index = menuItems.indexOf(document.activeElement);
    if (event.key === "ArrowDown") menuItems[(index + 1) % menuItems.length].focus();
    else if (event.key === "ArrowUp") menuItems[(index - 1 + menuItems.length) % menuItems.length].focus();
    else if (event.key === "Home") menuItems[0].focus();
    else if (event.key === "End") menuItems[menuItems.length - 1].focus();
    else if (event.key === "Tab") closeMenu(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  });

  // The entries don't do anything yet; choosing one just closes the menu.
  for (const item of menuItems) item.addEventListener("click", () => closeMenu(true));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu(true);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".profile")) closeMenu(false);
  });
})();
