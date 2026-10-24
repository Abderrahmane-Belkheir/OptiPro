// The Supplier orders page with orders: the list (newest first), one order opened with its lines (what one cost, used or waiting), a cancelled order,
// an unknown order, the list reading again after an order is placed from the form, and French / Arabic. Also the data service behind it.
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-supplierlist-");
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  await p.tenant.create({ data: { key: 't2', host: 'h2', name: 'T2' } });
  const S = (key = 't1') => ({ tenantKey: key, synced: true });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S() } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  const frame = (id, name, code, stock) => p.frame.create({ data: { id, name, brandId: 'b1', categoryId: 1, code, price: 18500, currency: 'DZD', stock, ...S() } });
  await frame('f1', 'Aviator', 'abc-123', 10);
  await frame('f2', 'Wayfarer', 'def-456', 4);
  await frame('f3', 'Clubmaster', 'ghi-789', 0);
  await p.supplier.create({ data: { id: 's1', name: 'Optic Import', kinds: 'frames', ...S() } });
  await p.supplier.create({ data: { id: 's2', name: 'Lunettes Gros', kinds: 'frames', ...S() } });
  await p.supplier.create({ data: { id: 'sx', name: 'Other shop supplier', kinds: 'frames', ...S('t2') } });
  const order = (id, supplierId, day, extra) => p.supplierOrder.create({ data: { id, supplierId, orderedAt: new Date(day), ...extra, ...S(extra?.tenantKey ?? 't1') } });
  await order('o1', 's1', '2026-03-01T10:00:00Z', { priceMode: 'unit', totalCents: 15000250 });
  await order('o2', 's2', '2026-05-10T10:00:00Z', { priceMode: 'batch', totalCents: 10000000, notes: 'Spring delivery' });
  await order('o3', 's1', '2026-04-01T10:00:00Z', { priceMode: 'unit', totalCents: 500000, status: 'cancelled' });
  await order('o4', 's1', '2025-12-15T10:00:00Z', { priceMode: 'unit', totalCents: 777700 });
  await order('ox', 'sx', '2026-06-01T10:00:00Z', { totalCents: 100, tenantKey: 't2' });
  const item = (id, orderId, frameId, quantity, unitCostCents, used, at) => p.supplierOrderItem.create({ data: { id, supplierOrderId: orderId, frameId, quantity, unitCostCents, used, createdAt: new Date(at), ...S() } });
  await item('i1', 'o1', 'f1', 10, 950000, true, '2026-03-01T10:00:01Z');
  await item('i2', 'o1', 'f2', 5, 1100050, false, '2026-03-01T10:00:02Z');
  await item('i3', 'o2', 'f3', 3, 3333333, true, '2026-05-10T10:00:01Z');
  await item('i4', 'o3', 'f1', 1, 500000, false, '2026-04-01T10:00:01Z');
  await item('i6', 'o4', 'f2', 2, 388850, true, '2025-12-15T10:00:01Z');
  // an accessory in the same order as a frame
  await p.accessory.create({ data: { id: 'ac1', name: 'Hard case', description: 'case', code: 'cas-001', price: 1500, currency: 'DZD', stock: 2, ...S() } });
  await p.supplierOrderItem.create({ data: { id: 'i5', supplierOrderId: 'o2', accessoryId: 'ac1', quantity: 2, unitCostCents: 80000, used: true, createdAt: new Date('2026-05-10T10:00:02Z'), ...S() } });
`,
);

let A;
const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
const pick = (name, value) => A.val(`(() => { const e = document.querySelector('[data-period=${name}]'); e.value = '${value}'; e.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
const tile = (key) => A.val(`document.querySelector('[data-tile=${key}] .summary__value').textContent`);
const go = async (hash) => {
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
};

(async () => {
  try {
    A = await launchApp(box);
    await A.until("!!document.querySelector('.nav-item')");

    R.section("the data service");
    const rows = await A.val("window.electronAPI.supplierOrders.list({ year: 2026 }).then((l) => l.rows.map((o) => [o.id, o.supplierName, o.products, o.quantity, o.totalCents, o.status].join('|')))");
    R.ck(JSON.stringify(rows) === JSON.stringify(["o2|Lunettes Gros|2|5|10000000|received", "o3|Optic Import|1|1|500000|cancelled", "o1|Optic Import|2|15|15000250|received"]), "list(): the shop's orders only, newest first, with the supplier, the frames and pieces and the total", JSON.stringify(rows));
    const sum = (l) => JSON.stringify([l.rows.map((o) => o.id).join(), l.totals.orders, l.totals.spentCents, l.totals.cancelledOrders, l.years.join()]);
    const L = (filter) => A.val(`window.electronAPI.supplierOrders.list(${JSON.stringify(filter)})`);
    R.ck(sum(await L({ year: 2026 })) === JSON.stringify(["o2,o3,o1", 2, 25000250, 1, "2026,2025"]), "list({ year }): the year's orders, how many (2, the cancelled one not counted), what they cost (150 002.50 + 100 000), and the years that have orders", sum(await L({ year: 2026 })));
    R.ck(sum(await L({ year: 2026, month: 5 })) === JSON.stringify(["o2", 1, 10000000, 0, "2026,2025"]) && sum(await L({ year: 2026, month: 3 })) === JSON.stringify(["o1", 1, 15000250, 0, "2026,2025"]), "list({ year, month }): one month of the year (May: the batch order; March: the first)");
    R.ck(sum(await L({ year: 2026, month: 4 })) === JSON.stringify(["o3", 0, 0, 1, "2026,2025"]), "a month with only a cancelled order: it is listed, counts for no order and no money, and is reported as cancelled");
    R.ck(sum(await L({ year: 2026, month: 1 })) === JSON.stringify(["", 0, 0, 0, "2026,2025"]) && sum(await L({ year: 2025 })) === JSON.stringify(["o4", 1, 777700, 0, "2026,2025"]), "a month with no order is empty (0 and 0); last year has its own order");
    R.ck(sum(await L({})) === JSON.stringify(["o2,o3,o1,o4", 3, 25777950, 1, "2026,2025"]), "without a period: every order of the shop (the other shop's is never there), all years added up", sum(await L({})));
    const badPeriods = await A.val("Promise.all([{ month: 3 }, { year: 2026, month: 13 }, { year: 1800 }, { year: 2026, month: 0 }].map((f) => window.electronAPI.supplierOrders.list(f).then(() => 'listed', (e) => e.kind ?? e.message)))");
    R.ck(badPeriods.every((x) => /invalid-input/.test(x)), "a month without a year, a month that does not exist, or a year that makes no sense is refused", JSON.stringify(badPeriods));
    const refused = await A.val("Promise.all([window.electronAPI.supplierOrders.get('ox'), window.electronAPI.supplierOrders.get('ghost'), window.electronAPI.supplierOrders.get('')].map((p) => p.then(() => 'read', (e) => e.kind ?? e.message)))");
    R.ck(refused.every((x) => /not-found|invalid-input/.test(x)), "get(): another shop's order, an unknown one and no id are refused", JSON.stringify(refused));

    R.section("the list");
    await go("#supplier-orders");
    await A.until("!!document.querySelector('[data-list]') || !!document.querySelector('[data-state=empty-period]')");
    R.ck(await A.val(`document.querySelector('[data-period=year]').value === '${new Date().getFullYear()}' && document.querySelector('[data-period=month]').value === ''`), "the page opens on the current year, the whole year");
    await pick("year", "2026");
    await A.until("!!document.querySelector('[data-list]')");
    R.ck(await A.val("[...document.querySelectorAll('[data-list] tbody tr')].map((r) => r.dataset.id).join() === 'o2,o3,o1'"), "three orders, newest first");
    R.ck(await A.val("[...document.querySelectorAll('[data-list] thead th')].map((t) => t.textContent).join('|') === 'Date|Supplier|Items|Quantity|Total|Status'"), "with its columns");
    R.ck(await A.val("(() => { const r = document.querySelector('[data-list] tr[data-id=o1]'); const c = (k) => r.querySelector('[data-cell=' + k + ']').textContent; return c('supplier') === 'Optic Import' && c('frames') === '2' && c('quantity') === '15' && c('total').replace(/\\D/g, '').startsWith('150002'); })()"), "an order shows its supplier, 2 frames, 15 pieces and its total (150 002.50)");
    R.ck(await A.val("document.querySelector('[data-list] tr[data-id=o3]').classList.contains('sales-row--cancelled') && document.querySelector('[data-list] tr[data-id=o3] .status').textContent === 'Cancelled' && document.querySelector('[data-list] tr[data-id=o1] .status').textContent === 'Received'"), "the status is shown, a cancelled order is struck through");
    R.ck(await A.val("!document.querySelector('[data-state=empty]') && !!document.getElementById('new-supplier-order')"), "no empty message, and the New supplier order button is still there");

    R.section("the period and what it adds up to");
    R.ck(await A.val("[...document.querySelectorAll('[data-period=year] option')].map((o) => o.textContent).join('|').startsWith('All years|') && [...document.querySelectorAll('[data-period=year] option')].some((o) => o.textContent === '2025') && document.querySelector('[data-period=month]').options[0].textContent === 'Whole year' && document.querySelector('[data-period=month]').options.length === 13"), "the year list has 'All years' and the years that have orders, the month list 'Whole year' and the 12 months");
    R.ck((await tile("orders")) === "2" && (await tile("spent")).replace(/\D/g, "").startsWith("250002"), "2026: 2 orders (the cancelled one is not counted) and 250 002.50 spent", await tile("spent"));
    R.ck(await A.val("/1 cancelled order is not counted/.test(document.querySelector('[data-note=spent]').textContent)"), "and a note says that one cancelled order is not counted");
    await pick("month", "5");
    await A.until("document.querySelectorAll('[data-list] tbody tr').length === 1");
    R.ck(await A.val("document.querySelector('[data-list] tbody tr').dataset.id === 'o2'") && (await tile("orders")) === "1" && (await tile("spent")).replace(/\D/g, "") === "100000" && !(await A.val("!!document.querySelector('[data-note=spent]')")), "May: only the batch order, 1 order, 100 000 spent, no note");
    await pick("month", "1");
    await A.until("!!document.querySelector('[data-state=empty-period]')");
    R.ck(/No order in this period/.test(await A.val("document.querySelector('[data-state=empty-period]').textContent")) && (await tile("orders")) === "0" && (await tile("spent")).replace(/\D/g, "") === "0", "a month with no order says so, and shows 0 orders and 0 spent");
    await pick("year", "2025");
    await A.until("!!document.querySelector('[data-state=empty-period]')"); // (the month stays January: January 2025 has no order)
    R.ck(await A.val("document.querySelector('[data-period=month]').value === '1'") && (await tile("orders")) === "0", "changing the year keeps the month: January 2025 has no order");
    await pick("month", "");
    await A.until("!!document.querySelector('[data-list]')");
    R.ck(await A.val("[...document.querySelectorAll('[data-list] tbody tr')].map((r) => r.dataset.id).join() === 'o4'") && (await tile("orders")) === "1" && (await tile("spent")).replace(/\D/g, "") === "7777", "2025: its one order, 7 777 spent");
    await pick("year", "");
    await A.until("document.querySelectorAll('[data-list] tbody tr').length === 4");
    R.ck(await A.val("document.querySelector('[data-period=month]').disabled && document.querySelector('[data-period=month]').value === ''") && (await tile("orders")) === "3" && (await tile("spent")).replace(/\D/g, "").startsWith("257779"), "All years: every order (4 listed, 3 counted), 257 779.50 spent, and the month list is off", await tile("spent"));
    await pick("year", "2026");
    await pick("month", "1");
    await A.until("!!document.querySelector('[data-state=empty-period]')");
    await click("[data-state=empty-period] button");
    await A.until("document.querySelectorAll('[data-list] tbody tr').length === 4");
    R.ck(await A.val("document.querySelector('[data-period=year]').value === ''"), "'Show all orders' in the empty message goes back to all years");
    await pick("year", "2026");
    await A.until("document.querySelectorAll('[data-list] tbody tr').length === 3");

    R.section("one order");
    await click("[data-list] tr[data-id=o1] a");
    await A.until("!!document.querySelector('[data-details]')");
    R.ck(await A.val("location.hash === '#supplier-orders/o1' && document.querySelector('[data-page=supplier-orders]').getAttribute('aria-current') === 'page'"), "it opens on its own address, and the sidebar still shows Supplier orders");
    R.ck(await A.val("document.querySelector('[data-field=supplier]').textContent === 'Optic Import' && document.querySelector('[data-field=mode]').textContent === 'Price per item' && document.querySelector('[data-field=total]').textContent.replace(/\\D/g, '').startsWith('150002') && document.querySelector('[data-field=status]').textContent === 'Received'"), "the supplier, how the price was given, the total and the status");
    R.ck(await A.val("[...document.querySelectorAll('[data-lines] thead th')].map((t) => t.textContent).join('|') === 'Item|Quantity|Cost of one|Total|Stock'"), "the lines have their columns");
    R.ck(await A.val("[...document.querySelectorAll('[data-lines] tbody tr')].map((r) => r.querySelector('[data-cell=name]').textContent + ':' + r.querySelector('[data-cell=quantity]').textContent).join() === 'Ray-Ban Aviator:10,Ray-Ban Wayfarer:5'"), "the frames of the order, in the order they were added, with their quantities");
    R.ck(await A.val("document.querySelector('[data-line=i1] [data-cell=code]').textContent === 'abc-123' && document.querySelector('[data-line=i1] [data-cell=unit]').textContent.replace(/\\D/g, '') === '9500' && document.querySelector('[data-line=i1] [data-cell=total]').textContent.replace(/\\D/g, '') === '95000'"), "a line shows the frame's code, what one cost (9 500) and the line's total (10 x 9 500)");
    R.ck(await A.val("document.querySelector('[data-line=i1]').dataset.used === 'true' && /Set the stock and the cost/.test(document.querySelector('[data-line=i1] [data-cell=used]').textContent) && document.querySelector('[data-line=i2]').dataset.used === 'false' && /Waiting for the last piece/.test(document.querySelector('[data-line=i2] [data-cell=used]').textContent)"), "a line says whether it set the frame's stock and cost, or is waiting for the last piece to be sold");
    await click(".od-back");
    await A.until("!!document.querySelector('[data-list]')");
    await go("#supplier-orders/o2");
    await A.until("!!document.querySelector('[data-details]')");
    R.ck(await A.val("document.querySelector('[data-field=mode]').textContent === 'Price of the whole batch' && document.querySelector('[data-notes]').textContent === 'Spring delivery' && document.querySelectorAll('[data-lines] tbody tr').length === 2 && document.querySelector('[data-line=i5] [data-cell=name]').textContent === 'Hard case' && document.querySelector('[data-line=i5] [data-cell=code]').textContent === 'cas-001' && document.querySelector('[data-line=i3] [data-cell=name]').textContent === 'Ray-Ban Clubmaster'"), "a batch order says so, shows its notes, and has its two lines: a frame (brand and name) and an accessory (its name and code)");
    await go("#supplier-orders/ghost");
    await A.until("!!document.querySelector('[data-state=error]')");
    R.ck(await A.val("/couldn't be opened/.test(document.querySelector('[data-state=error]').textContent) && !!document.querySelector('.od-back')"), "an unknown order says it could not be opened, with a way back");

    R.section("placing an order from the form updates the list");
    await go("#supplier-orders");
    await A.until("!!document.querySelector('[data-list]')");
    await pick("year", "");
    await A.until("document.querySelectorAll('[data-list] tbody tr').length === 4");
    await click("#new-supplier-order");
    await A.until("!!document.querySelector('[data-supplier-order-form]') && document.querySelectorAll('[data-supplier-select] option').length > 1");
    await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); s.value = 's2'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    const type = (selector, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.focus(); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await type("[data-picker=supplier-frames]", "club");
    await sleep(500);
    await click(".pick-result[data-id=f3] [data-action=add-frame]");
    await A.until("document.querySelectorAll('[data-line]').length === 1");
    await type("[data-unit=f3]", "9000");
    await click("[data-action=save-supplier-order]");
    await A.until("!!document.querySelector('[data-saved]')");
    await click("[data-action=close-saved]");
    await A.until("document.querySelectorAll('[data-list] tbody tr').length === 5");
    R.ck(await A.val("document.querySelectorAll('[data-list] tbody tr').length === 5 && document.querySelector('[data-list] tbody tr').dataset.id !== 'o2'"), "the new order is on the list, first, without reopening the page");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 700));
  } finally {
    await A.stop();
  }

  try {
    A = await launchApp(box);
    for (const [code, nav, head, used] of [
      ["fr", "Commandes fournisseurs", "Date|Fournisseur|Articles|Quantité|Total|Statut", "A fixé le stock et le coût"],
      ["ar", "طلبات الموردين", null, "حدّد المخزون والتكلفة"],
    ]) {
      R.section(code);
      await A.until("typeof window.i18n?.setLang === 'function'");
      await A.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(900);
      await go("#dashboard");
      await go("#supplier-orders/o1");
      await A.until("!!document.querySelector('[data-details]')");
      await sleep(300);
      R.ck(await A.val(`document.querySelector('[data-page=supplier-orders] .nav-item__label').textContent === ${JSON.stringify(nav)} && document.querySelector('[data-line=i1] [data-cell=used]').textContent === ${JSON.stringify(used)}`), "the sidebar entry and the lines are translated");
      await go("#supplier-orders");
      await A.until("!!document.querySelector('[data-list]')");
      await sleep(300);
      if (head) R.ck((await A.val("[...document.querySelectorAll('[data-list] thead th')].map((t) => t.textContent).join('|')")) === head, "the list's columns are translated");
      const missing = await A.val("[...window.i18n.missing].filter((s) => !/^\\d|^DZD/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s) && !/Ray-Ban|Aviator|Wayfarer|Clubmaster|Hard case|Optic Import|Lunettes|Spring|abc-123|def-456|ghi-789|cas-001/.test(s))");
      R.ck(missing.length === 0, "every text has a translation", JSON.stringify(missing));
    }
  } catch (error) {
    R.ck(false, "languages: ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
