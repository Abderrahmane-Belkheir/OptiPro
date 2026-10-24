// The Supplier orders page in the real window: it is in the sidebar (under Suppliers), opens as the current page, is EMPTY (a message, no table, no button yet),
// and is translated in French and Arabic.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-supplier-orders-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
runScript(box, `await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });`);

(async () => {
  const A = await launchApp(box);
  const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
  try {
    await A.until("!!document.querySelector('[data-page=supplier-orders]')");
    R.section("the sidebar");
    R.ck(await A.val("(() => { const links = [...document.querySelectorAll('.nav-item[data-page]')].map((a) => a.dataset.page); return links.indexOf('supplier-orders') === links.indexOf('suppliers') + 1; })()"), "'Supplier orders' is in the sidebar, right after 'Suppliers'");
    R.ck((await A.val("document.querySelector('[data-page=supplier-orders] .nav-item__label').textContent")) === "Supplier orders", "with its own name");

    R.section("the page");
    await A.val("(() => { location.hash = '#supplier-orders'; return 1; })()");
    await A.until("!!document.querySelector('[data-supplier-orders-page]')");
    R.ck(await A.val("document.querySelector('[data-page=supplier-orders]').getAttribute('aria-current') === 'page' && document.getElementById('page-title').textContent === 'Supplier orders' && document.title.startsWith('Supplier orders')"), "it opens as the current page, with its title");
    R.ck((await A.val("document.querySelector('.page__title').textContent")) === "Supplier orders", "the page has its heading");
    R.ck(await A.val("/frames and accessories/.test(document.querySelector('.page__description').textContent) && /Lens orders stay with the customer's order/.test(document.querySelector('.page__description').textContent)"), "the description says what the page is for: frames and accessories to restock, and that lens orders stay with the customer's order");
    R.ck(await A.val("!!document.querySelector('[data-supplier-orders] [data-state=empty]') && /No frame or accessory order yet/.test(document.querySelector('[data-state=empty]').textContent)"), "it is empty: a message says there is no frame or accessory order yet");
    R.ck(await A.val("!document.querySelector('[data-supplier-orders-page] [role=tab]') && !/lens/i.test(document.querySelector('[data-supplier-orders]').textContent)"), "and there are no tabs and no lens list: lens orders are not here");
    R.ck(await A.val("!document.querySelector('[data-supplier-orders-page] table') && [...document.querySelectorAll('[data-supplier-orders-page] button')].map((b) => b.id).join() === 'new-supplier-order'"), "there is no table, and one button, 'New supplier order': nothing is saved behind it yet");
    await A.val("(() => { location.hash = '#suppliers'; return 1; })()");
    await A.until("!document.querySelector('[data-supplier-orders-page]')");
    R.ck(await A.val("document.querySelector('[data-page=suppliers]').getAttribute('aria-current') === 'page'"), "leaving it takes the page away");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 500));
  } finally {
    await A.stop();
  }

  const B = await launchApp(box);
  try {
    await B.until("typeof window.i18n?.setLang === 'function'");
    for (const [code, nav, empty] of [["fr", "Commandes fournisseurs", "Aucune commande de montures ou d'accessoires pour l'instant"], ["ar", "طلبات الموردين", "لا يوجد طلب إطارات أو إكسسوارات بعد"]]) {
      R.section(code);
      await B.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(900);
      await B.val("(() => { location.hash = '#dashboard'; return 1; })()");
      await B.val("(() => { location.hash = '#supplier-orders'; return 1; })()");
      await B.until("!!document.querySelector('[data-supplier-orders-page]')");
      await sleep(300);
      R.ck(await B.val(`document.querySelector('[data-page=supplier-orders] .nav-item__label').textContent === ${JSON.stringify(nav)} && document.querySelector('[data-state=empty] .state__title').textContent === ${JSON.stringify(empty)}`), "the sidebar entry and the message are translated");
      const missing = await B.val("[...window.i18n.missing].filter((s) => !/^\\d|^DZD/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s))");
      R.ck(missing.length === 0, "every text has a translation", JSON.stringify(missing));
    }
  } catch (error) {
    R.ck(false, "languages: ERR", String(error.stack).slice(0, 500));
  } finally {
    await B.stop();
  }
  process.exit(R.done());
})();
