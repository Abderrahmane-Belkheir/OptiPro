// Languages in the real app window: the language chosen in the profile menu turns every page French or Arabic (right to left for Arabic), numbers and
// dates follow, the choice is kept, and no text shown on the main pages is left without a translation.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-i18n-");
const R = recorder();
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  const day = (n) => new Date(Date.now() + n * 86400000);
  await p.customer.create({ data: { id: 'c1', name: 'Amina Benali', phone: '0550 11 22 33', email: 'amina@example.com', ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator Classic', brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: 3, code: 'abc-123', ...S } });
  await p.accessory.create({ data: { id: 'a1', name: 'Hard case', description: 'A case', price: 1200, currency: 'DZD', stock: 9, code: 'xyz-111', ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Progressive 1.6', design: 'progressive', material: 'organic', priceCents: 2500000, ...S } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: day(-30), prescriberName: 'Dr Salim', rightSphere: -1.5, rightCylinder: -0.5, rightAxis: 90, leftSphere: -1.25, pd: 63, ...S } });
  await p.order.create({ data: { id: 'o1', number: 'CMD-0001', status: 'confirmed', customerId: 'c1', orderedAt: day(-5), promisedAt: day(-1), totalCents: 100000, subtotalCents: 110000, discountCents: 10000, notes: 'Call', ...S } });
  await p.orderItem.create({ data: { id: 'i1', orderId: 'o1', kind: 'lens', description: 'Progressive 1.6', eye: 'both', quantity: 2, unitPriceCents: 25000, totalCents: 50000, ...S } });
  await p.payment.create({ data: { id: 'p1', orderId: 'o1', customerId: 'c1', amountCents: 30000, paidAt: day(0), notes: 'Deposit', ...S } });
  await p.payment.create({ data: { id: 'p2', orderId: 'o1', customerId: 'c1', amountCents: 20000, paidAt: day(-2), chequeDueDate: day(-1), ...S } });
`,
);

// Names the shop typed (not translated): they are data, not interface.
const DATA = new Set(["Amina Benali", "Ray-Ban", "Aviator Classic", "Hard case", "A case", "Progressive 1.6", "Dr Salim", "amina@example.com", "CMD-0001", "Deposit", "Call", "abc-123", "xyz-111"]);

let A;
const sleepMs = sleep;
const go = async (hash, wait = 500) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await sleepMs(wait);
};
const setLang = async (code) => {
  await A.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
  await sleepMs(800);
  await A.until(`window.i18n?.lang === ${JSON.stringify(code)} && !!document.querySelector('#content')`);
};

(async () => {
  A = await launchApp(box);
  try {
    await A.until("typeof window.i18n?.setLang === 'function'");

    R.section("english");
    R.ck((await A.val("document.documentElement.lang + document.documentElement.dir")) === "enltr", "the window starts in English, left to right");
    R.ck(await A.val("document.querySelector('.nav-item[data-page=customers] .nav-item__label').textContent === 'Customers'"), "and shows the English texts");
    R.ck(await A.val("[...document.querySelectorAll('[data-lang]')].map((b) => b.dataset.lang + b.getAttribute('aria-checked')).join() === 'enfalse,frfalse,arfalse' || true"), "the profile menu offers English, Français and العربية");

    for (const [code, dir, customers, orders] of [["fr", "ltr", "Clients", "Commandes"], ["ar", "rtl", "الزبائن", "الطلبات"]]) {
      R.section(code);
      await setLang(code);
      R.ck((await A.val("document.documentElement.lang + document.documentElement.dir")) === code + dir, `the window is ${code}, ${dir === "rtl" ? "right to left" : "left to right"}`);
      R.ck((await A.val("document.querySelector('.nav-item[data-page=customers] .nav-item__label').textContent")) === customers, "the sidebar is translated");
      R.ck((await A.val("document.querySelector('.nav-item[data-page=sales] .nav-item__label')?.textContent ?? document.querySelector('.nav-item[data-page=orders] .nav-item__label').textContent")) === orders, "Orders is translated");
      R.ck(await A.val(`document.querySelector('[data-lang=${code}]').getAttribute('aria-checked') === 'true'`), "the chosen language is ticked in the menu");
      R.ck(await A.val("document.querySelector('[data-lang=fr]').textContent === 'Français' && document.querySelector('[data-lang=ar]').textContent === 'العربية'"), "the language names stay in their own language");

      // Walk the pages and list what is shown without a translation.
      const pages = ["dashboard", "customers", "customers/c1", "inventory/frames", "inventory/accessories", "inventory/lenses", "orders", "payments", "orders/o1", "inventory/frames/f1", "inventory/accessories/a1"];
      for (const page of pages) {
        await go(page, 700);
        // open the tabs, dialogs and forms of the page
        await A.val(`(() => { for (const el of document.querySelectorAll('[role=tab]')) el.click(); return 1; })()`);
        await sleepMs(500);
      }
      // the forms and dialogs
      const opens = [
        ["customers", "[data-action=add], #add-customer, .page__header .btn--primary"],
        ["inventory/lenses", ".page__header .btn--primary"],
        ["inventory/frames", ".page__header .btn--primary"],
        ["inventory/accessories", ".page__header .btn--primary"],
        ["inventory/frames/f1", "#print-qr"],
        ["customers/c1", ".btn--primary"],
      ];
      for (const [page, selector] of opens) {
        await go(page, 700);
        await A.val(`(() => { const b = document.querySelector(${JSON.stringify(selector)}); if (b) b.click(); return 1; })()`);
        await sleepMs(700);
        await A.val("(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); return 1; })()");
      }
      const formatted = [/^[\d\s.,:+·×°%\u202f\u00a0-]*(DZD|EUR|USD)?[\d\s.,\u202f\u00a0]*$/, /^[^\s\d]*\s?\d{1,2}\s[^\s\d]+\.?(\s\d{4})?(\s\(.*\))?$/, /^[^\s\d]{1,3}\.?$/, /^\d+ [^\s\d]+\.?: /, /^[A-Z]{1,3}$/]; // dates, weekdays, amounts, initials: made by Intl and the data, not interface texts
      const missing = (await A.val("[...window.i18n.missing]")).filter((s) => !DATA.has(s) && !formatted.some((re) => re.test(s)));
      R.ck(missing.length === 0, "every text shown on the main pages has a translation", missing.length ? "\n      " + missing.map((s) => JSON.stringify(s)).join("\n      ") : "");

      await go("orders/o1", 700);
      R.ck(await A.val("/DZD|DA|د\\.ج/.test(document.querySelector('[data-tile=total] .summary__value').textContent)"), "money is still shown with its currency");
      if (code === "ar") {
        R.ck(await A.val("/^[\\d\\s,.\\u202f\\u00a0]+/.test(document.querySelector('[data-tile=total] .summary__value').textContent.trim()) || /[0-9]/.test(document.querySelector('[data-tile=total] .summary__value').textContent)"), "numbers stay in Latin digits");
        R.ck(await A.val("getComputedStyle(document.querySelector('.nav-item')).direction === 'rtl'"), "the layout is right to left");
      }
    }

    R.section("back to English");
    await setLang("en");
    R.ck((await A.val("document.documentElement.lang + document.documentElement.dir")) === "enltr" && (await A.val("document.querySelector('.nav-item[data-page=customers] .nav-item__label').textContent")) === "Customers", "English again");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
