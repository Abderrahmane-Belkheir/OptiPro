// Behaviour of the application shell: which page is active, the collapsible sidebar and the
// profile menu and the Inventory sub-navigation. Plain script, no dependencies. It only drives the shell; there are no pages yet,
// so choosing a navigation entry just updates the active item and the title in the top bar.
(() => {
  "use strict";

  // What the sidebar and the window title call the shop: the name saved with the licence (the one typed when the shop was activated, or changed in
  // the Settings). Until it is known, or when there is none, the app's own name.
  const DEFAULT_NAME = "OptiPro";
  let storeName = DEFAULT_NAME;
  let pageLabel = "";
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
    const wanted = (location.hash.slice(1) || DEFAULT_PAGE).split("/")[0]; // "#customers/<id>" is still the Customers page
    const active = navLinks.find((link) => link.dataset.page === wanted) ?? navLinks.find((link) => link.dataset.page === DEFAULT_PAGE);
    for (const link of navLinks) {
      if (link === active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    const label = active.querySelector(".nav-item__label").textContent.trim();
    pageTitle.textContent = label;
    pageEyebrow.textContent = active.dataset.eyebrow; // the navigation group the page belongs to
    pageLabel = label;
    document.title = `${label} · ${storeName}`;
  }

  /** Reads the shop's name again and puts it in the sidebar and in the window title (called at start and after the Settings saved a new name). */
  async function refreshShopName() {
    try {
      const info = await window.electronAPI?.shopInfo?.get();
      storeName = info?.name || DEFAULT_NAME;
    } catch {
      storeName = DEFAULT_NAME;
    }
    const brand = document.getElementById("shop-brand-name");
    if (brand) {
      brand.textContent = storeName;
      brand.title = storeName; // (a long name is cut in the sidebar: hovering shows all of it)
    }
    if (pageLabel) document.title = `${pageLabel} · ${storeName}`;
  }
  window.refreshShopName = refreshShopName;

  window.addEventListener("hashchange", showPage);
  showPage();
  void refreshShopName();

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
  // ---- Inventory sub-navigation --------------------------------------------------------------
  // The sub-items sit inside the sidebar, under Inventory. Hovering or focusing the entry opens
  // them (pure CSS, see .nav-sub in shell.css); they also stay open while the current page is
  // inside Inventory, and the highlighted sub-item follows the URL hash.

  const submenuOwners = [...document.querySelectorAll("[data-has-submenu]")];
  const subLinks = [...document.querySelectorAll(".nav-subitem")];

  function expandedState(owner) {
    return owner.dataset.open === "true" || owner.matches(":hover, :focus-within");
  }

  function showSubmenus() {
    const hash = location.hash.slice(1);
    const page = (hash || DEFAULT_PAGE).split("/")[0];
    for (const owner of submenuOwners) {
      const link = owner.querySelector(".nav-item[data-page]");
      owner.dataset.open = String(link.dataset.page === page);
      link.setAttribute("aria-expanded", String(expandedState(owner)));
    }
    for (const link of subLinks) {
      const href = link.getAttribute("href");
      if (href === `#${hash}` || hash.startsWith(`${href.slice(1)}/`)) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }

  // Hover and focus open it visually; keep aria-expanded truthful for screen readers too.
  for (const owner of submenuOwners) {
    const link = owner.querySelector(".nav-item[data-page]");
    const sync = () => link.setAttribute("aria-expanded", String(expandedState(owner)));
    owner.addEventListener("pointerenter", sync);
    owner.addEventListener("pointerleave", sync);
    owner.addEventListener("focusin", sync);
    owner.addEventListener("focusout", () => setTimeout(sync));
  }

  window.addEventListener("hashchange", showSubmenus);
  showSubmenus();

  // ---- Rows that open ----------------------------------------------------------------------------
  // A table row with a data-href ("orders/<id>", "customers/<id>") opens that page when it is clicked anywhere. A link, a button or a field inside the row keeps its own
  // click (the row's own link is there for the keyboard), and selecting text in the row is not a click.
  document.addEventListener("click", (event) => {
    const row = event.target.closest?.("tr[data-href]");
    if (!row || event.target.closest('a, button, input, select, textarea, label, summary')) return;
    if (String(window.getSelection?.() ?? "") !== "") return;
    location.hash = row.dataset.href;
  });
})();
