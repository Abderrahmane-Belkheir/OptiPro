// The "Confirmed" list: the orders can be ticked, "Generate PDF and send" makes ONE PDF of their lab sheets, and the person chooses the lenses supplier:
// none = told to add one, one = chosen directly, several = asked to choose. The Send button does nothing yet. Other lists have no ticks.
const fs = require("node:fs");
const path = require("node:path");
const { sandbox, runScript, launchApp, recorder, sleep } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-labsend-");
const docs = path.join(box.dir, "docs");
const external = path.join(box.dir, "external.log"); // what would have been opened in the browser, and the copies of the PDF that were saved
const optician = path.join(box.dir, "optician"); // the person's optician folder (the app uses <user folder>/optician)
const kept = path.join(box.dir, "kept"); // where Download puts the PDF (instead of asking)
box.writeConfig(["server.url=http://127.0.0.1:9", "tenant.key=t1"]);
runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { id: 'c1', name: 'Amina Benali', ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Progressive 1.6', brand: 'Essilor', design: 'progressive', material: 'organic', priceCents: 1400000, ...S } });
  const order = async (id, number, status, lens) => {
    await p.order.create({ data: { id, number, status, customerId: 'c1', orderedAt: new Date(), totalCents: 100000, ...S } });
    await p.orderItem.create({ data: { orderId: id, kind: lens ? 'lens' : 'frame', lensId: lens ? 'l1' : null, description: lens ? 'Essilor Progressive 1.6' : 'Frame', quantity: 1, unitPriceCents: 100000, totalCents: 100000, ...S } });
  };
  await order('o1', 'CMD-0001', 'confirmed', true);
  await order('o2', 'CMD-0002', 'confirmed', true);
  await order('o3', 'CMD-0003', 'confirmed', false);
  await order('o4', 'CMD-0004', 'at_lab', true);
  await p.supplier.create({ data: { id: 's1', name: 'Frames Import', kinds: 'frames', ...S } });
  await p.supplier.create({ data: { id: 's2', name: 'Retired Lab', kinds: 'lenses', isActive: false, ...S } });
`,
);

let A;
const click = (selector) => A.val(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`);
const open = async (hash) => {
  await A.until("!!document.querySelector('.nav-item')");
  await A.val(`(() => { location.hash = ${JSON.stringify(hash)}; return 1; })()`);
  await A.until("!!document.querySelector('[data-sales]') && document.querySelector('[data-sales]').dataset.status === 'ready'");
};
const tick = (id) => A.val(`(() => { const b = document.querySelector('[data-select=${id}]'); b.checked = !b.checked; b.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);

(async () => {
  try {
    A = await launchApp(box, { OPTIPRO_DOCUMENT_PDF_DIR: docs });
    R.section("only the Confirmed list has ticks");
    await open("orders");
    R.ck(await A.val("!document.querySelector('[data-select]') && document.querySelector('[data-sendbar]').hidden"), "the full list has no ticks and no bar");
    await open("orders/at_lab");
    R.ck(await A.val("!document.querySelector('[data-select]') && document.querySelector('[data-sendbar]').hidden"), "At the lab has none either");
    await open("orders/confirmed");
    R.ck(await A.val("document.querySelectorAll('[data-select]').length === 3 && !!document.querySelector('[data-select-all]')"), "Confirmed: a tick for each of its three orders, and one for all");
    R.ck(await A.val("!document.querySelector('[data-sendbar]').hidden && /Tick the orders/.test(document.querySelector('[data-selected-count]').textContent) && document.querySelector('[data-action=generate-send]').disabled"), "the bar asks to tick orders and the button waits");

    R.section("ticking");
    await tick("o1");
    R.ck(await A.val("document.querySelector('[data-selected-count]').textContent === '1 order selected' && !document.querySelector('[data-action=generate-send]').disabled"), "one ticked: '1 order selected', the button is ready");
    await tick("o2");
    R.ck(await A.val("document.querySelector('[data-selected-count]').textContent === '2 orders selected'"), "two ticked");
    await click("[data-select-all]");
    R.ck(await A.val("document.querySelector('[data-selected-count]').textContent === '3 orders selected' && [...document.querySelectorAll('[data-select]')].every((b) => b.checked)"), "the tick above selects all of them");
    await click("[data-select-all]");
    R.ck(await A.val("document.querySelector('[data-selected-count]').textContent.startsWith('Tick') && [...document.querySelectorAll('[data-select]')].every((b) => !b.checked)"), "and unticks all of them");

    R.section("an order with no lens is refused, and the problem is shown");
    await tick("o3");
    await click("[data-action=generate-send]");
    await A.until("!!document.querySelector('[data-send-error]')");
    R.ck(await A.val("/CMD-0003 has no lens/.test(document.querySelector('[data-send-error]').textContent) && !document.querySelector('[data-lab-send]')"), "the error names the order and no dialog opens");
    await tick("o3");

    R.section("no lenses supplier yet (a frames supplier and a retired lab do not count)");
    await tick("o1");
    await tick("o2");
    await click("[data-action=generate-send]");
    await A.until("!!document.querySelector('[data-lab-send]') && /lenses supplier yet|Essilor|Choose/.test(document.querySelector('[data-supplier-part]').textContent)");
    { const t = await A.val("document.querySelector('[data-pdf]').textContent"); R.ck(/^2 lab sheets in one PDF: CMD-000[12], CMD-000[12]$/.test(t), "the dialog says what is in the PDF: 2 lab sheets, with their numbers", t); }
    const files = fs.existsSync(docs) ? fs.readdirSync(docs).filter((f) => f.endsWith(".pdf")) : [];
    R.ck(files.length === 1 && /^lab-orders-.*\.pdf$/.test(files[0]) && fs.readFileSync(path.join(docs, files[0])).subarray(0, 4).toString() === "%PDF", "one PDF file was written", files.join());
    { const t = await A.val("document.querySelector('[data-file]').textContent"); R.ck(t === files[0], "and the dialog shows its name", t); }
    R.ck(await A.val("/no lenses supplier yet/.test(document.querySelector('[data-supplier-part]').textContent) && document.querySelector('[data-action=send-lab-pdf]').disabled"), "with no lenses supplier it says to add one in Suppliers, and Send is disabled");
    await click("[data-lab-send] .btn--secondary");
    await A.until("!document.querySelector('[data-lab-send]')");
    R.ck(A.problems.length === 0, "no errors or exceptions in the window", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }

  // ---- one lenses supplier: chosen directly
  runScript(box, `await p.supplier.create({ data: { id: 's3', name: 'Essilor Algérie', kinds: 'lenses,frames', email: 'orders@essilor.dz', phone: '0555 11 22 33', tenantKey: 't1', synced: true } });`);
  try {
    A = await launchApp(box, { OPTIPRO_DOCUMENT_PDF_DIR: docs, OPTIPRO_PDF_SAVE_TO: kept, OPTIPRO_EXTERNAL_LOG: external, OPTIPRO_PDF_FOLDER: optician });
    R.section("one lenses supplier: chosen directly");
    await open("orders/confirmed");
    await tick("o1");
    await click("[data-action=generate-send]");
    await A.until("!!document.querySelector('[data-supplier-select][data-chosen]')");
    R.ck(await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); return [...s.options].map((o) => o.textContent).join('|') === 'Essilor Algérie' && s.value === 's3' && !document.querySelector('[data-action=send-lab-pdf]').disabled && /1 lab sheet in one PDF/.test(document.querySelector('[data-pdf]').textContent); })()"), "with one lenses supplier the list holds it and it is already chosen, and Send is ready");

    R.section("download");
    R.ck(await A.val("!!document.querySelector('[data-action=download-lab-pdf]') && document.querySelector('[data-saved]').hidden"), "there is a Download button");
    await click("[data-action=download-lab-pdf]");
    await A.until("!document.querySelector('[data-saved]').hidden");
    const copies = fs.existsSync(kept) ? fs.readdirSync(kept) : [];
    R.ck(copies.length === 1 && /^lab-orders-.*.pdf$/.test(copies[0]) && fs.readFileSync(path.join(kept, copies[0])).subarray(0, 4).toString() === "%PDF", "the PDF was copied where the person chose", copies.join());
    R.ck(await A.val("/^Saved to /.test(document.querySelector('[data-saved]').textContent)"), "and the dialog says where it was saved");
    R.ck(await A.val("window.electronAPI.documents.savePdf('C:\Windows\win.ini').then(() => 'saved', (e) => e.kind ?? e.message)").then((x) => /invalid-input|not a PDF/.test(String(x))), "a file the app did not make can not be saved this way");
    R.section("how to send it");
    await click("[data-action=send-lab-pdf]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'methods'");
    R.ck(await A.val("/Choose how to reach Essilor Algérie/.test(document.querySelector('[data-supplier-name]').textContent) && [...document.querySelectorAll('[data-method]')].map((b) => b.dataset.method).join() === 'email,whatsapp'"), "Send shows the ways to reach the supplier: Email and WhatsApp (it has both)");
    R.ck(await A.val("document.querySelector('[data-detail=email]').textContent === 'orders@essilor.dz' && document.querySelector('[data-detail=whatsapp]').textContent === '0555 11 22 33'"), "each with what it will use: the email address and the phone number");
    // WhatsApp: a form like the email, then the chat is opened with the number and the text
    await click("[data-method=whatsapp]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'whatsapp'");
    R.ck(await A.val("document.querySelector('[data-email-to]').value === '0555 11 22 33' && !!document.querySelector('[data-action=send-whatsapp]') && !!document.querySelector('[data-email-message]') && /CMD-0001.pdf/.test(document.querySelector('[data-email-file]').textContent)"), "WhatsApp: a form with the number, the file of the order (CMD-0001.pdf) and a message box, and a button that opens WhatsApp");
    await A.val("(() => { const m = document.querySelector('[data-email-message]'); m.value = 'Bonjour, voici les commandes & urgentes #1'; m.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
    await click("[data-action=send-whatsapp]");
    await A.until("!document.querySelector('[data-opened]').hidden");
    const log1 = fs.existsSync(external) ? fs.readFileSync(external, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
    R.ck(log1.length === 2 && log1[1].open === "https://wa.me/213555112233?text=" + encodeURIComponent("Bonjour, voici les commandes & urgentes #1") && log1[0].saved?.startsWith(optician) && log1[0].saved.endsWith("CMD-0001.pdf"), "WhatsApp opens in the browser with the number in international form (213555112233) and the text exactly as typed; the lab sheet of the order was put in the optician folder first", JSON.stringify(log1));
    const copied = fs.existsSync(optician) ? fs.readdirSync(optician) : [];
    R.ck(copied.join() === "CMD-0001.pdf" && fs.readFileSync(path.join(optician, "CMD-0001.pdf")).subarray(0, 4).toString() === "%PDF", "the file is there, named by the order number, a real PDF (one file per order)", copied.join());
    R.ck(await A.val("/The lab sheets are in /.test(document.querySelector('[data-opened]').textContent) && document.querySelector('[data-opened]').textContent.includes('optician') && document.querySelector('[data-opened]').dataset.made === '1' && document.querySelector('[data-opened]').dataset.already === '0' && !document.querySelector('[data-opened]').classList.contains('field__error')"), "and the dialog says where they are: 1 saved now, 0 already there (no file explorer is opened)");
    await click("[data-action=back]");
    await click("[data-method=email]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'email'");
    R.ck(await A.val("document.querySelector('[data-email-to]').value === 'orders@essilor.dz' && document.querySelector('[data-email-to]').readOnly && /CMD-0001.pdf/.test(document.querySelector('[data-email-file]').textContent) && !!document.querySelector('[data-email-message]') && !!document.querySelector('[data-action=send-email]')"), "Email: a form with the address (not editable), the file of the order, a box for a message, and a button that opens the email");
    R.ck((await A.val("document.querySelector('[data-email-file]').title")).endsWith(".pdf") && (await A.val("document.querySelector('[data-email-file]').title")).includes("lab-orders-"), "the file is the PDF that was just made");
    await A.val("(() => { const m = document.querySelector('[data-email-message]'); m.value = 'Please send before Friday.\\nThanks é'; m.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()");
    fs.writeFileSync(external, "");
    await click("[data-action=send-email]");
    await A.until("!document.querySelector('[data-opened]').hidden");
    const log2 = fs.readFileSync(external, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const openedLine = log2.find((l) => l.open);
    const url2 = new URL(openedLine.open);
    R.ck(url2.origin === "https://mail.google.com" && url2.searchParams.get("view") === "cm" && url2.searchParams.get("to") === "orders@essilor.dz" && url2.searchParams.get("body") === "Please send before Friday.\nThanks é" && /^Lens orders: CMD-000[12](, CMD-000[12])?$/.test(url2.searchParams.get("su") ?? ""), "Email opens Gmail's compose page in the browser: to the address, the subject with the order numbers, and the text exactly as typed (line break and accent kept)", log2[0].open);
    R.ck(log2.length === 1 && !!log2[0].open && fs.readdirSync(optician).join() === "CMD-0001.pdf" && (await A.val("document.querySelector('[data-opened]').dataset.made === '0' && document.querySelector('[data-opened]').dataset.already === '1'")), "the sheet of the order is already in the folder, so it is not copied again: nothing new was saved (0 saved now, 1 already there), only the message opened");
    R.ck(await A.val("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'email' && document.querySelector('[data-email-message]').value.startsWith('Please send') && document.querySelectorAll('dialog[open]').length === 1"), "the form stays, the message is kept");
    await click("[data-action=back]");
    R.ck(await A.val("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'methods'"), "Back from the email goes to the ways of sending");
    await click("[data-action=back]");
    R.ck(await A.val("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'supplier' && document.querySelector('[data-supplier-select]').value === 's3' && !!document.querySelector('[data-action=download-lab-pdf]')"), "and Back again to the supplier, still chosen");

    R.section("several orders, some already in the folder");
    await click("[data-lab-send] .dialog__footer .btn--secondary");
    await A.until("!document.querySelector('[data-lab-send]')");
    await tick("o2"); // o1 is still ticked: two orders, and the sheet of o1 is already in the folder
    await click("[data-action=generate-send]");
    await A.until("!!document.querySelector('[data-lab-send]') && !!document.querySelector('[data-supplier-select]')");
    await click("[data-action=send-lab-pdf]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'methods'");
    await click("[data-method=whatsapp]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'whatsapp'");
    R.ck(await A.val("(() => { const x = document.querySelector('[data-email-file]').textContent; return x.includes('CMD-0001.pdf') && x.includes('CMD-0002.pdf'); })()"), "two orders: the form lists the file of each");
    fs.writeFileSync(external, "");
    await click("[data-action=send-whatsapp]");
    await A.until("!document.querySelector('[data-opened]').hidden");
    const log3 = fs.readFileSync(external, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    R.ck(log3.filter((l) => l.saved).map((l) => path.basename(l.saved)).join() === "CMD-0002.pdf" && log3.filter((l) => l.open).length === 1 && fs.readdirSync(optician).sort().join() === "CMD-0001.pdf,CMD-0002.pdf", "only the sheet that was missing (CMD-0002) was made and put in the folder; CMD-0001 was left as it was", JSON.stringify(log3));
    R.ck(await A.val("document.querySelector('[data-opened]').dataset.made === '1' && document.querySelector('[data-opened]').dataset.already === '1'"), "the dialog says: 1 saved now, 1 already there");
    fs.writeFileSync(external, "");
    await click("[data-action=send-whatsapp]");
    await A.until("!document.querySelector('[data-opened]').hidden");
    await sleep(300);
    const log4 = fs.readFileSync(external, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    R.ck(log4.filter((l) => l.saved).length === 0 && log4.filter((l) => l.open).length === 1 && fs.readdirSync(optician).length === 2 && (await A.val("document.querySelector('[data-opened]').dataset.made === '0' && document.querySelector('[data-opened]').dataset.already === '2'")), "pressing it again: both sheets are already there, nothing is copied (0 saved now, 2 already there)");
    R.ck(A.problems.length === 0, "no errors or exceptions", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR2", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }

  // ---- several: asked to choose
  runScript(box, `await p.supplier.create({ data: { id: 's4', name: 'Bio Optic', kinds: 'lenses', phone: '0661 00 00 00', email: '   ', tenantKey: 't1', synced: true } });
  await p.supplier.create({ data: { id: 's5', name: 'Mail Lab', kinds: 'lenses', email: 'hello@maillab.dz', tenantKey: 't1', synced: true } });
  await p.supplier.create({ data: { id: 's6', name: 'Silent Lab', kinds: 'lenses', tenantKey: 't1', synced: true } });`);
  try {
    A = await launchApp(box, { OPTIPRO_DOCUMENT_PDF_DIR: docs });
    R.section("several lenses suppliers: asked to choose");
    await open("orders/confirmed");
    await tick("o1");
    await tick("o2");
    await click("[data-action=generate-send]");
    await A.until("!!document.querySelector('[data-supplier-select]')");
    R.ck(await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); return [...s.options].map((o) => o.textContent).join('|') === 'Choose a supplier|Bio Optic|Essilor Algérie|Mail Lab|Silent Lab' && /choose the one to send this to/.test(document.querySelector('[data-supplier-part]').textContent) && document.querySelector('[data-action=send-lab-pdf]').disabled; })()"), "a list of the lenses suppliers (by name), a message saying to choose, and Send waits");
    await A.val("(() => { const s = document.querySelector('[data-supplier-select]'); s.value = 's4'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()");
    R.ck(await A.val("!document.querySelector('[data-action=send-lab-pdf]').disabled"), "once one is chosen, Send is ready");
    const choose = (id) => A.val(`(() => { const s = document.querySelector('[data-supplier-select]'); s.value = '${id}'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    const methods = () => A.val("[...document.querySelectorAll('[data-method]')].map((b) => b.dataset.method + ':' + b.querySelector('[data-detail]').textContent).join('|')");
    R.section("the ways to reach each supplier");
    await click("[data-action=send-lab-pdf]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'methods'");
    R.ck((await methods()) === "whatsapp:0661 00 00 00", "a supplier with only a phone number (its email is empty or spaces): only WhatsApp is offered", await methods());
    await click("[data-action=back]");
    await choose("s5");
    await click("[data-action=send-lab-pdf]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'methods'");
    R.ck((await methods()) === "email:hello@maillab.dz", "a supplier with only an email address: only Email is offered", await methods());
    await click("[data-method=email]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'email'");
    R.ck(await A.val("document.querySelector('[data-email-to]').value === 'hello@maillab.dz' && /Mail Lab/.test(document.querySelector('[data-email-form]').textContent)"), "its address is in the email form, with its name");
    await click("[data-action=back]");
    await click("[data-action=back]");
    await choose("s6");
    await click("[data-action=send-lab-pdf]");
    await A.until("document.querySelector('[data-lab-send] .dialog__body').dataset.step === 'methods'");
    R.ck(await A.val("!!document.querySelector('[data-state=no-method]') && !document.querySelector('[data-method]') && /no email address and no phone number/.test(document.querySelector('[data-state=no-method]').textContent)"), "a supplier with neither says so, and offers no way");
    await click("[data-action=back]");
    await choose("s4");
    R.ck(await A.val("!document.querySelector('[data-action=send-lab-pdf]').disabled"), "(Send is ready again once a supplier is chosen)");
    R.ck(A.problems.length === 0, "no errors or exceptions", A.problems.join(" | "));
  } catch (error) {
    R.ck(false, "ERR3", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }

  // ---- languages
  try {
    A = await launchApp(box, { OPTIPRO_DOCUMENT_PDF_DIR: docs });
    for (const [code, text] of [["fr", "Générer le PDF et envoyer"], ["ar", "إنشاء ملف PDF وإرساله"]]) {
      R.section(code);
      await A.until("typeof window.i18n?.setLang === 'function'");
      await A.val(`(() => { window.i18n.setLang(${JSON.stringify(code)}, { persist: false }); return 1; })()`);
      await sleep(900);
      await open("dashboard");
      await open("orders/confirmed");
      await tick("o1");
      await sleep(400);
      R.ck((await A.val("document.querySelector('[data-action=generate-send]').textContent.trim()")) === text, "the button is translated");
      const missing = await A.val("[...window.i18n.missing].filter((s) => !/^\\d|^DZD|^CMD-/.test(s) && !/^\\S+ \\d{1,2} \\S+$/.test(s) && !/Benali|Retired|Essilor|Bio Optic|Frames Import|Mail Lab|Silent Lab|@|^0\d/.test(s) && !/^(null|[a-z]{2})$/.test(s))");
      R.ck(missing.length === 0, "every text has a translation", JSON.stringify(missing));
    }
  } catch (error) {
    R.ck(false, "ERR4", String(error.stack).slice(0, 600));
  } finally {
    await A.stop();
  }
  process.exit(R.done());
})();
