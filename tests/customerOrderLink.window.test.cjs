// The orders in a customer's history open the order's page: the order number is a link, and so is "Open order".
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-orderlink-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  const order = (id, number, status) => p.order.create({ data: { id, number, customerId: 'c1', status, subtotalCents: 100000, totalCents: 100000, ...S } });
  await order('o1', 'CMD-1', 'confirmed');
  await order('o2', 'CMD-2', 'cancelled');
`,
);

(async () => {
  const A = await launchApp(box);
  try {
    await A.until("typeof window.electronAPI?.orderDetails?.get === 'function'");
    await A.val("(() => { location.hash = 'customers/c1'; return 1; })()");
    await A.until("!!document.querySelector('[data-tab=orders]')");
    await A.val("document.querySelector('[data-tab=orders]').click()");
    R.section("the history");
    R.ck(await A.until("document.querySelectorAll('article.order').length === 2"), "the customer's orders are listed");
    const hrefs = await A.val("[...document.querySelectorAll('article.order')].map((a) => a.dataset.id + ':' + a.querySelector('[data-open-order]').getAttribute('href') + ':' + a.querySelector('[data-order-link]').getAttribute('href')).sort().join()");
    R.ck(hrefs === "o1:#orders/o1:#orders/o1,o2:#orders/o2:#orders/o2", "each order's number and its Open order link point to its page", hrefs);
    R.ck((await A.val("document.querySelector('article.order[data-id=o2] [data-open-order]').textContent")) === "CMD-2", "a cancelled order too");
    await A.val("document.querySelector('article.order[data-id=o1] [data-order-link]').click()");
    R.ck(await A.until("location.hash === '#orders/o1' && document.querySelector('[data-order-page] [data-number]')?.textContent === 'CMD-1'"), "Open order shows the order's page");
    await A.val("history.back()");
    await sleep(300);
    await A.until("!!document.querySelector('[data-tab=orders]')");
    await A.val("document.querySelector('[data-tab=orders]').click()");
    await A.until("document.querySelectorAll('article.order').length === 2");
    await A.val("document.querySelector('article.order[data-id=o2] [data-open-order]').click()");
    R.ck(await A.until("location.hash === '#orders/o2' && document.querySelector('[data-order-page] [data-number]')?.textContent === 'CMD-2'"), "the order number opens it too");
    R.ck(A.problems.length === 0, "no error in the window", A.problems.join(" | "));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
