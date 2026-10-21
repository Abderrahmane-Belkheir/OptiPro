// Label printing and scanning, in the real app window: the QR card prints (to PDF here, through the real print pipeline) at the label size from the
// settings file, and a scanned code or label address picks a product in the New order form.
// Run (after `npm run build`, with nothing else using the app):  npm run test:labels-window
const fs = require("node:fs");
const path = require("node:path");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const box = sandbox("op-labels-");
const R = recorder();
const SERVER = "http://127.0.0.1:9"; // nothing listens there: the app's sync finds the server unreachable and leaves the data alone
const settings = (...extra) => box.writeConfig([`server.url=${SERVER}`, "tenant.key=t1", ...extra]);
settings();

runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina Benali', ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator Classic', brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: 3, code: 'abc-123', ...S } });
  await p.frame.create({ data: { id: 'f2', name: 'Wayfarer', brandId: 'b1', categoryId: 1, price: 16500, currency: 'DZD', stock: 1, code: 'def-456', ...S } });
  await p.accessory.create({ data: { id: 'a1', name: 'Hard case', description: 'A case', price: 1200, currency: 'DZD', stock: 9, code: 'xyz-111', ...S } });
`,
);

const pdfPages = (file) => {
  const text = fs.readFileSync(file).toString("latin1");
  const counts = [...text.matchAll(/\/Count (\d+)/g)].map((m) => Number(m[1]));
  const box_ = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { pages: counts.length ? Math.max(...counts) : 0, width: box_ ? Number(box_[1]) : NaN, height: box_ ? Number(box_[2]) : NaN };
};
const mmToPt = (mm) => (mm * 72) / 25.4;

(async () => {
  const A = await launchApp(box);
  try {
    const card = "document.querySelector('dialog[data-qr-card]')";
    const type = (sel, value) => A.val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    await A.until("typeof window.electronAPI?.labels?.print === 'function'");

    // ------------------------------------------------------------------ the card prints
    R.section("the QR card prints");
    await A.val("(() => { location.hash = 'inventory/frames/f1'; return 1; })()");
    await A.until("document.getElementById('print-qr')");
    await A.val("document.getElementById('print-qr').click()");
    await A.until(`${card}?.open && ${card}.querySelector('[data-qr] svg') && ${card}.querySelector('[data-qr-size]').textContent !== ''`);
    R.ck(await A.val(`/Label size 40 × 25 mm/.test(${card}.querySelector('[data-qr-size]').textContent) && /you choose the printer/.test(${card}.querySelector('[data-qr-size]').textContent)`), "the card says the label size (40 × 25 mm by default) and that the printer is chosen when printing");
    R.ck(await A.val(`${card}.querySelector('[data-qr-size]').dataset.small === 'false'`), "and the default size is not flagged: the QR code has enough printer dots per square to scan");
    await type("#qr-copies", "2");
    await A.val(`${card}.querySelector('[data-action=confirm-print]').click()`);
    R.ck(await A.until(`/Saved to /.test(${card}.querySelector('[data-qr-status]').textContent)`), "Print sends the labels through the real print pipeline (here to a PDF) and says where they went");
    const file = path.join(box.pdf, "labels-abc-123-2.pdf");
    R.ck(fs.existsSync(file), "the file for 2 labels of abc-123 exists", file);
    const info = fs.existsSync(file) ? pdfPages(file) : {};
    R.ck(info.pages === 2 && Math.abs(info.width - mmToPt(40)) < 1.5 && Math.abs(info.height - mmToPt(25)) < 1.5, "2 pages, each exactly 40 × 25 mm", JSON.stringify(info));
    R.ck(await A.val(`!${card}.querySelector('[data-action=confirm-print]').disabled && !${card}.querySelector('#qr-copies').disabled`), "afterwards the card is usable again");
    await A.val(`${card}.querySelector('.btn--secondary').click()`);

    settings("label.width=30", "label.height=20");
    await A.val("document.getElementById('print-qr').click()");
    await A.until(`${card}?.open && /30 × 20/.test(${card}.querySelector('[data-qr-size]').textContent)`);
    R.ck(await A.val(`/Label size 30 × 20 mm/.test(${card}.querySelector('[data-qr-size]').textContent)`), "a change of label.width / label.height in the settings file is used the next time (no restart)");
    R.ck(await A.val(`${card}.querySelector('[data-qr-size]').dataset.small === 'true' && /printer dots wide/.test(${card}.querySelector('[data-qr-size]').textContent)`), "30 × 20 is flagged: each square of the QR code is only about 3 printer dots wide (it needs 4), and the card says so");
    await A.val(`${card}.querySelector('[data-action=confirm-print]').click()`);
    await A.until(`/Saved to /.test(${card}.querySelector('[data-qr-status]').textContent)`);
    const info2 = pdfPages(path.join(box.pdf, "labels-abc-123-1.pdf"));
    R.ck(info2.pages === 1 && Math.abs(info2.width - mmToPt(30)) < 1.5 && Math.abs(info2.height - mmToPt(20)) < 1.5, "and the page is now 30 × 20 mm (a flagged size can still be printed: it is a warning, not a block)", JSON.stringify(info2));
    await A.val(`${card}.querySelector('.btn--secondary').click()`);

    settings("label.width=40", "label.height=12");
    await A.val("document.getElementById('print-qr').click()");
    await A.until(`${card}?.open && /40 × 12/.test(${card}.querySelector('[data-qr-size]').textContent)`);
    R.ck(await A.val(`${card}.querySelector('[data-qr-size]').dataset.small === 'true' && /may not scan/.test(${card}.querySelector('[data-qr-size]').textContent)`), "a label too short for a readable QR code is warned about on the card");
    await A.val(`${card}.querySelector('.btn--secondary').click()`);

    settings("label.width=abc");
    await A.val("document.getElementById('print-qr').click()");
    await A.until(`${card}?.open && /label\\.width/.test(${card}.querySelector('[data-qr-size]').textContent)`);
    R.ck(await A.val(`/label\\.width/.test(${card}.querySelector('[data-qr-size]').textContent)`), "a label.width that is not a number is explained on the card");
    await A.val(`${card}.querySelector('[data-action=confirm-print]').click()`);
    R.ck(await A.until(`${card}.querySelector('[data-qr-status]').dataset.kind === 'error' && /label\\.width/.test(${card}.querySelector('[data-qr-status]').textContent)`), "and printing says why it did not print instead of failing silently");
    await A.val(`${card}.querySelector('.btn--secondary').click()`);
    settings();

    await A.val("(() => { location.hash = 'inventory/accessories/a1'; return 1; })()");
    await A.until("document.querySelector('.product-details[data-kind=accessory]') && document.getElementById('print-qr')");
    await A.val("document.getElementById('print-qr').click()");
    await A.until(`${card}?.open && ${card}.querySelector('[data-qr] svg')`);
    await A.val(`${card}.querySelector('[data-action=confirm-print]').click()`);
    await A.until(`/Saved to /.test(${card}.querySelector('[data-qr-status]').textContent)`);
    R.ck(fs.existsSync(path.join(box.pdf, "labels-xyz-111-1.pdf")), "an accessory's labels print the same way (labels-xyz-111-1.pdf)");
    await A.val(`${card}.querySelector('.btn--secondary').click()`);

    // ------------------------------------------------------------------ scanning in the order form
    R.section("scanning in the order form");
    await A.val("(() => { location.hash = 'customers/c1'; return 1; })()");
    await A.until("document.getElementById('new-order')");
    await A.val("document.querySelector('[data-tab=orders]').click()");
    await A.val("document.getElementById('new-order').click()");
    const form = "document.querySelector('dialog[data-new-order]')";
    await A.until(`${form}?.open && ${form}.querySelectorAll('[data-results=frame] .pick-result').length === 2`);
    const scan = async (sel, text) => {
      await type(sel, text);
      await A.val(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`);
      await sleep(500);
    };
    const chosen = (kind) => A.val(`(() => { const c = ${form}.querySelector('[data-chosen=${kind}]'); return c.hidden ? null : c.querySelector('.pick-chosen__name').textContent; })()`);
    const message = (kind) => A.val(`${form}.querySelector('[data-results=${kind}] [data-scan-message]')?.textContent ?? null`);

    await scan("#order-frame-search", "abc-123");
    R.ck((await chosen("frame")) === "Aviator Classic", "scanning a frame's code (abc-123 + Enter) picks that frame at once");
    await A.val(`${form}.querySelector('[data-chosen=frame] [data-action=change]').click()`);
    await scan("#order-frame-search", `${SERVER}/frames/def-456`);
    R.ck((await chosen("frame")) === "Wayfarer", "scanning a label's QR code (its address) picks the frame too");
    await A.val(`${form}.querySelector('[data-chosen=frame] [data-action=change]').click()`);
    await scan("#order-frame-search", " DEF-456 ");
    R.ck((await chosen("frame")) === "Wayfarer", "capitals and spaces around the code do not matter");
    await A.val(`${form}.querySelector('[data-chosen=frame] [data-action=change]').click()`);

    await scan("#order-frame-search", "zzz-999");
    R.ck(!(await chosen("frame")) && /No frame has the code zzz-999/.test((await message("frame")) ?? ""), "a code no frame has says so (and picks nothing)");
    await scan("#order-frame-search", `${SERVER}/accessories/xyz-111`);
    R.ck(!(await chosen("frame")) && /accessory's code\. Scan it in the Accessory box/.test((await message("frame")) ?? ""), "an accessory's label scanned in the Frame box says to scan it in the Accessory box");
    await scan("#order-frame-search", "xyz-111");
    R.ck(!(await chosen("frame")) && /No frame has the code xyz-111/.test((await message("frame")) ?? ""), "a bare code that belongs to an accessory is not a frame (nothing is picked)");

    await scan("#order-accessory-search", `${SERVER}/frames/abc-123`);
    R.ck(!(await chosen("accessory")) && /frame's code\. Scan it in the Frame box/.test((await message("accessory")) ?? ""), "a frame's label scanned in the Accessory box says to scan it in the Frame box");
    await scan("#order-accessory-search", `${SERVER}/accessories/xyz-111`);
    R.ck((await chosen("accessory")) === "Hard case", "an accessory's label scanned in the Accessory box picks the accessory");
    R.ck((await chosen("frame")) === null, "the frame box was not touched by that");

    await type("#order-frame-search", "avi");
    await A.val("document.querySelector('#order-frame-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await sleep(600);
    R.ck((await chosen("frame")) === null && (await A.val(`[...${form}.querySelectorAll('[data-results=frame] .pick-result__name')].map((e) => e.textContent).join()`)) === "Aviator Classic", "plain text + Enter is just a search: it lists the matching frame and does not pick it");
    R.ck(await A.val(`${form}.open`), "Enter in a search box does not submit or close the form");

    R.section("the window");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
