// The papers of an order (src/local/documents.ts, documentService.ts): the customer's invoice is issued once and keeps its number, the lab sheet carries the
// prescription and the job, both come out in English, French and Arabic, everything typed is escaped, and the printer gets the page.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");
const fs = require("node:fs");

const R = recorder();
const box = sandbox("op-documents-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);

const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 't1' } });
  const S = { tenantKey: 't1', synced: true };
  // the shop's details, as saved with the licence when the shop was activated
  await p.licenseExpiry.create({ data: { id: 1, expiresAt: new Date('2099-01-01T00:00:00Z'), shopName: 'Optique Soleil', phone: '0550 12 34 56', address: '12 Rue Didouche Mourad, Alger' } });
  await p.customer.create({ data: { id: 'c1', name: 'Amina <b>Benali</b>', phone: '0661 00 00 00', address: 'Cité 5 Juillet', ...S } });
  await p.prescription.create({ data: { id: 'rx1', customerId: 'c1', prescribedAt: new Date('2026-01-10T00:00:00Z'), prescriberName: 'Dr Saidi', rightSphere: -2.25, rightCylinder: -0.5, rightAxis: 90, rightAdd: 1.5, leftSphere: 1, notes: 'Wears them all day', ...S } });
  await p.brand.create({ data: { id: 'b1', name: 'Ray-Ban', ...S } });
  await p.category.create({ data: { id: 1, name: 'Optical Frames', imageUrl: 'u' } }).catch(() => {});
  await p.frame.create({ data: { id: 'f1', name: 'Aviator', brandId: 'b1', categoryId: 1, price: 18500, currency: 'DZD', stock: 2, code: 'abc-123', reference: 'RB3025', eyeSize: 52, bridge: 18, templeLength: 140, ...S } });
  await p.lens.create({ data: { id: 'l1', name: 'Progressive 1.6', brand: 'Essilor', design: 'progressive', material: 'organic', refractiveIndex: 1.6, antiReflective: true, blueLightFilter: true, priceCents: 1400000, ...S } });

  const L = require(ROOT + '/dist/local/index.js');
  const out = {};
  const placed = await L.localOrderPlacementService.place({ customerId: 'c1', prescriptionId: 'rx1', frameId: 'f1', lensId: 'l1', deposit: 10000, pdRight: 31, pdLeft: 30.5, fittingHeightRight: 22, fittingHeightLeft: 21.5, promisedAt: '2099-02-03', notes: 'Rush <script>alert(1)</script>' });
  const orderId = placed.order.id;
  const D = L.localDocumentService;

  // no printer plugged in yet
  out.noPrinter = await D.print(orderId, 'invoice', 'en').then(() => 'printed', (e) => e.kind);
  out.invoicesBefore = await p.invoice.count();

  // the invoice is issued once, whoever asks and however often
  const [a, b, c] = await Promise.all([D.issueInvoice(orderId), D.issueInvoice(orderId), D.issueInvoice(orderId)]);
  out.issued = { numbers: [a.number, b.number, c.number].join(','), invoices: await p.invoice.count(), items: await p.invoiceItem.count(), total: a.totalCents };
  const row = await p.invoice.findFirst({ where: { id: a.id } });
  out.row = { kind: row.kind, order: row.orderId === orderId, customer: row.customerName, address: row.customerAddress, total: row.totalCents, subtotal: row.subtotalCents, discount: row.discountCents, vat: row.vatCents, tenant: row.tenantKey, synced: row.synced };
  out.again = (await D.issueInvoice(orderId)).number;
  out.counts = { invoices: await p.invoice.count(), items: await p.invoiceItem.count() };

  // the HTML in three languages
  const inv = {};
  for (const lang of ['en', 'fr', 'ar', 'xx']) inv[lang] = await D.html(orderId, 'invoice', lang);
  out.inv = {
    en: { dir: /dir="ltr"/.test(inv.en), number: inv.en.includes(a.number), shop: inv.en.includes('Optique Soleil') && inv.en.includes('0550 12 34 56') && inv.en.includes('Rue Didouche'), title: /<h1>Invoice<\\/h1>/.test(inv.en), lines: inv.en.includes('Ray-Ban Aviator') && inv.en.includes('Essilor Progressive 1.6'), total: inv.en.includes('32,500'), paid: inv.en.includes('10,000'), due: inv.en.includes('22,500') && inv.en.includes('Balance due'), escaped: inv.en.includes('Amina &lt;b&gt;Benali&lt;/b&gt;') && !inv.en.includes('<b>Benali') },
    fr: { dir: /lang="fr" dir="ltr"/.test(inv.fr), title: /<h1>Facture<\\/h1>/.test(inv.fr), due: inv.fr.includes('Reste à payer') },
    ar: { dir: /lang="ar" dir="rtl"/.test(inv.ar), title: inv.ar.includes('<h1>فاتورة</h1>'), due: inv.ar.includes('المتبقي'), latin: inv.ar.includes('32') && !/[٠-٩]/.test(inv.ar) },
    unknownLanguage: /lang="en"/.test(inv.xx),
  };

  // paying changes what is left, not the invoice
  await L.localOrderDetailsService.pay(orderId, { amountCents: 2250000 });
  const paid = await D.html(orderId, 'invoice', 'en');
  out.paidInFull = { number: paid.includes(a.number), text: paid.includes('Paid in full'), noDue: !paid.includes('Balance due'), sameCount: (await p.invoice.count()) === 1 };

  // the lab sheet
  const lab = await D.html(orderId, 'lab', 'en');
  out.lab = {
    title: /<h1>Lens order<\\/h1>/.test(lab), order: lab.includes(placed.order.number), customer: lab.includes('Amina &lt;b&gt;Benali'), noPhone: !lab.includes('0661'),
    right: lab.includes('-2.25') && lab.includes('-0.50') && lab.includes('90°') && lab.includes('+1.50'), left: lab.includes('+1.00'), prescriber: lab.includes('Dr Saidi'), rxNotes: lab.includes('Wears them all day'),
    measures: ['31', '30.5', '22', '21.5'].every((x) => lab.includes('>' + x + '<')),
    lens: lab.includes('Essilor Progressive 1.6') && lab.includes('Progressive') && lab.includes('Organic') && lab.includes('Index 1.6') && lab.includes('Anti-reflective') && lab.includes('Blue light filter'),
    frame: lab.includes('Ray-Ban Aviator') && lab.includes('abc-123') && lab.includes('RB3025') && lab.includes('52 / 18 / 140'),
    sentBox: lab.includes('class="box"') && lab.includes('Frame sent with this order'),
    promised: lab.includes('03/02/2099'), escapedNotes: lab.includes('Rush &lt;script&gt;') && !lab.includes('<script>alert'),
    noPrices: !lab.includes('DZD') && !lab.includes('18,500'),
  };
  out.labFr = (await D.html(orderId, 'lab', 'fr')).includes('Commande de verres') && (await D.html(orderId, 'lab', 'fr')).includes('Progressif');
  out.labAr = /dir="rtl"/.test(await D.html(orderId, 'lab', 'ar'));
  out.invoicesAfterLab = await p.invoice.count();

  // an order with no prescription, a described lens and no frame
  const plain = await L.localOrderPlacementService.place({ customerId: 'c1', lensDescription: 'Progressive 1.6 with anti-reflective', lensPrice: 14000 });
  const plainLab = await D.html(plain.order.id, 'lab', 'en');
  out.plainLab = { noRx: plainLab.includes('No prescription on this order.'), lens: plainLab.includes('Progressive 1.6 with anti-reflective'), noFrame: !plainLab.includes('<h2>Frame</h2>') };
  const plainInv = await D.issueInvoice(plain.order.id);
  out.second = plainInv.number;

  // refusals
  await L.localOrderService.update(plain.order.id, { status: 'cancelled' });
  const cancelled = await L.localOrderPlacementService.place({ customerId: 'c1', accessoryId: undefined, lensDescription: 'x', lensPrice: 1 });
  await L.localOrderService.update(cancelled.order.id, { status: 'cancelled' });
  out.refused = {
    cancelled: await D.issueInvoice(cancelled.order.id).then(() => 'issued', (e) => e.kind),
    ghost: await D.issueInvoice('ghost').then(() => 'issued', (e) => e.kind),
    nothing: await D.issueInvoice(undefined).then(() => 'issued', (e) => e.kind),
    kind: await D.html(orderId, 'receipt', 'en').then(() => 'ok', (e) => e.kind),
    labOfGhost: await D.html('ghost', 'lab', 'en').then(() => 'ok', (e) => e.kind),
  };
  out.cancelledStillHasSheet = (await D.html(cancelled.order.id, 'lab', 'en')).includes('Lens order');

  // the printer gets the page and the job
  const seen = [];
  L.setDocumentPrinter(async (html, job) => { seen.push({ job, doctype: html.startsWith('<!doctype html>'), size: /size: A4 portrait/.test(html) }); return { status: job.kind === 'lab' ? 'cancelled' : 'sent' }; });
  const r1 = await D.print(orderId, 'invoice', 'fr');
  const r2 = await D.print(orderId, 'lab', 'ar');
  out.print = { r1: r1.status + ':' + r1.kind + ':' + r1.number, r2: r2.status + ':' + r2.kind + ':' + r2.number, jobs: seen.map((s) => s.job.kind + ':' + s.job.number + ':' + s.doctype + ':' + s.size).join('|') };
  L.setDocumentPrinter(async () => { throw new Error('out of paper'); });
  out.printerError = await D.print(orderId, 'invoice', 'en').then(() => 'ok', (e) => e.message);

  out.api = require(ROOT + '/dist/ipc/channels.js').API_METHODS.documents;
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");
const yes = (o) => Object.values(o ?? {}).every((v) => v === true);

R.section("the invoice is issued once");
R.ck(r.noPrinter === "invalid-input" && r.invoicesBefore === 0, "no printer in this run: a clear error, and printing alone issued nothing yet");
R.ck(new Set((r.issued?.numbers ?? "").split(",")).size === 1 && /^FAC-\d{4}-0001$/.test(r.issued?.numbers.split(",")[0] ?? ""), "three at once give one invoice and one number (FAC-year-0001)", r.issued?.numbers);
R.ck(r.issued?.invoices === 1 && r.issued?.items === 2 && r.issued?.total === 3250000, "one invoice with a copy of the 2 lines and the total", JSON.stringify(r.issued));
R.ck(r.row?.kind === "invoice" && r.row?.order && r.row?.customer === "Amina <b>Benali</b>" && r.row?.address === "Cité 5 Juillet" && r.row?.total === 3250000 && r.row?.subtotal === 3250000 && r.row?.discount === 0 && r.row?.vat === 0 && r.row?.tenant === "t1", "it keeps the customer's name and address as they were, and the amounts", JSON.stringify(r.row));
R.ck(r.row?.synced === false, "it waits for the server like any row (not reachable here)");
R.ck(r.again === r.issued?.numbers.split(",")[0] && r.counts?.invoices === 1 && r.counts?.items === 2, "asking again gives the same invoice");

R.section("what the customer reads");
R.ck(yes(r.inv?.en), "English: number, shop, lines, total, paid, balance due, everything typed escaped", JSON.stringify(r.inv?.en));
R.ck(yes(r.inv?.fr), "French");
R.ck(yes(r.inv?.ar), "Arabic: right to left, Latin digits", JSON.stringify(r.inv?.ar));
R.ck(r.inv?.unknownLanguage === true, "an unknown language falls back to English");
R.ck(yes(r.paidInFull), "once paid in full the same invoice says so, with no balance due", JSON.stringify(r.paidInFull));

R.section("what the lab reads");
R.ck(yes(r.lab), "title, order, customer, prescription of each eye, measurements, lens, frame, tick box for 'frame sent', promised day, notes escaped, no prices", JSON.stringify(r.lab));
R.ck(r.labFr === true && r.labAr === true, "French and right-to-left Arabic");
R.ck(r.invoicesAfterLab === 1, "printing the lab sheet issues no invoice");
R.ck(yes(r.plainLab), "an order with no prescription and a described lens still gets a sheet", JSON.stringify(r.plainLab));
R.ck(/^FAC-\d{4}-0002$/.test(r.second ?? ""), "the next order's invoice is number 0002", r.second);

R.section("refusals");
R.ck(r.refused?.cancelled === "invalid-input" && r.refused?.ghost === "not-found" && r.refused?.nothing === "invalid-input", "a cancelled order has no invoice; an unknown order and no order are refused", JSON.stringify(r.refused));
R.ck(r.refused?.kind === "invalid-input" && r.refused?.labOfGhost === "not-found", "an unknown kind of document or order is refused");
R.ck(r.cancelledStillHasSheet === true, "a cancelled order's lab sheet can still be read");

R.section("printing");
R.ck(/^sent:invoice:FAC-\d{4}-0001$/.test(r.print?.r1 ?? "") && /^cancelled:lab:CMD-\d{4}-0001$/.test(r.print?.r2 ?? ""), "the printer's answer comes back with the kind and the number", JSON.stringify(r.print));
R.ck(/^invoice:FAC-\d{4}-0001:true:true\|lab:CMD-\d{4}-0001:true:true$/.test(r.print?.jobs ?? ""), "the printer got a whole A4 page for each", r.print?.jobs);
R.ck(r.printerError === "out of paper", "a printer that fails is reported, not hidden", r.printerError);
R.ck(r.api?.join() === "print,issueInvoice,html", "documents.print / issueInvoice / html are on the list of what the window may call");

process.exit(R.done());
