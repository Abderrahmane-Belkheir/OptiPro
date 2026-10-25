// Opening a message to a supplier in the browser (src/local/contactService.ts): the WhatsApp number in international form, the Gmail compose address and the wa.me address
// (what is typed is encoded exactly), the lab sheet of EACH order put in the person's optician folder as a file of its own (a sheet that is already there is not made or copied
// again; the file explorer is not opened), and what is refused: another address, another file, a text that is too long.
const { sandbox, runScript, recorder } = require("./helpers/app.cjs");

const R = recorder();
const box = sandbox("op-contact-");
box.writeConfig(["tenant.key=t1", "server.url=http://127.0.0.1:9"]);
const out = runScript(
  box,
  `
  await p.tenant.create({ data: { key: 't1', host: 'h1', name: 'T1' } });
  const S = { tenantKey: 't1', synced: true };
  await p.customer.create({ data: { yearOfBirth: 1990, id: 'c1', name: 'Amina', ...S } });
  const order = async (id, number) => {
    await p.order.create({ data: { id, number, status: 'confirmed', customerId: 'c1', orderedAt: new Date(), totalCents: 100000, ...S } });
    await p.orderItem.create({ data: { orderId: id, kind: 'lens', description: 'Essilor Progressive 1.6', quantity: 1, unitPriceCents: 100000, totalCents: 100000, ...S } });
  };
  await order('o1', 'CMD-2026-0001');
  await order('o2', 'CMD-2026-0002');
  await order('o3', 'A B/C:1?x');
  const L = require(ROOT + '/dist/local/index.js');
  const C = L.localContactService;
  const out = {};

  // the phone numbers WhatsApp wants
  const numbers = ['0555 11 22 33', '+213 555 11 22 33', '00213555112233', '555112233', '0555-11-22-33', '(0555) 11 22 33', '+33 6 12 34 56 78', '213555112233', '+1 (415) 555-2671', '12', '0', 'abc', '0555 abc', '', '+', '0000', '+0555112233', '05551122334455667788'];
  out.numbers = Object.fromEntries(numbers.map((n) => [n, L.whatsappNumber(n)]));

  // the PDF maker (a stand-in that counts what it is asked to make) and the PDFs the app made
  let made = 0;
  const madeFor = [];
  L.setPdfMaker(async (html, name) => { made += 1; madeFor.push(name); return { file: 'C:/pdfs/' + name + '-' + made + '.pdf' }; });
  const pdf = await L.localDocumentService.labPdf(['o1', 'o2'], 'en');
  const file = pdf.file;
  out.bundle = { made, numbers: pdf.numbers };

  // nothing plugged in yet
  out.noOpener = await C.openEmail({ to: 'a@b.dz', file }).then(() => 'opened', (e) => e.kind);

  // the browser and the optician folder (a stand-in: a list of the files that are in it)
  const opened = [];
  const folder = new Set();
  const order_ = []; // what happened, in the order it happened
  let failFor = null;
  L.setExternalOpener({
    openUrl: async (url) => { order_.push('open'); opened.push(url); },
    place: async (name) => ({ path: 'C:/Users/me/optician/' + name, exists: folder.has(name) }),
    moveIn: async (f, name) => { if (failFor && name.startsWith(failFor)) throw new Error('disk full'); folder.add(name); order_.push('move:' + name); return 'C:/Users/me/optician/' + name; },
  });

  // the first send: the sheet of each order is made and put in the folder, then the message opens
  const text = 'Bonjour,\\nVoici les commandes & urgentes #1 : 100% é à ñ 中 😀 ?x=1';
  const e1 = await C.openEmail({ to: ' orders@essilor.dz ', subject: 'Verres\\nurgents', message: text, file });
  out.first = { sheets: e1.sheets, madeAfter: made, madeFor: madeFor.slice(1), order: order_.slice(), folder: [...folder].sort() };
  out.email = { url: e1.url, opened: opened.slice() };
  const u = new URL(e1.url);
  out.emailParts = { origin: u.origin, path: u.pathname, view: u.searchParams.get('view'), to: u.searchParams.get('to'), su: u.searchParams.get('su'), body: u.searchParams.get('body') };

  // sending again (the same orders): every sheet is already there, nothing is made again
  const madeBefore = made;
  const e2 = await C.openEmail({ to: 'a@b.dz', lang: 'fr', numbers: ['CMD-1', 'CMD-2'], file });
  const e3 = await C.openEmail({ to: 'a@b.dz', lang: 'ar', numbers: ['CMD-1'], file });
  const e4 = await C.openEmail({ to: 'a@b.dz', lang: 'xx', numbers: ['CMD-1'], file });
  const e5 = await C.openEmail({ to: 'a@b.dz', file });
  out.subjects = [e2, e3, e4, e5].map((e) => decodeURIComponent(new URL(e.url).searchParams.get('su')));
  out.emptyBody = new URL(e5.url).searchParams.get('body');
  const w1 = await C.openWhatsApp({ phone: '0555 11 22 33', message: text, file });
  const w2 = await C.openWhatsApp({ phone: '+213 555 11 22 33', file });
  out.again = { madeMore: made - madeBefore, sheets: e2.sheets, allThere: [e2, e3, e4, e5, w1, w2].every((e) => e.sheets.every((s) => s.saved === false && s.path)) };
  out.whatsapp = { url: w1.url, text: new URL(w1.url).searchParams.get('text') };
  out.whatsappNoText = w2.url;

  // only one sheet is missing from the folder (the person deleted it): only that one is made
  folder.delete('CMD-2026-0002.pdf');
  const madeBeforePartial = made;
  const w3 = await C.openWhatsApp({ phone: '0555 11 22 33', file });
  out.partial = { sheets: w3.sheets.map((s) => s.number + ':' + s.saved), madeMore: made - madeBeforePartial };

  // a sheet cannot be saved: the other is, and the message is opened all the same
  folder.clear();
  failFor = 'CMD-2026-0001';
  const openedBefore = opened.length;
  const e6 = await C.openEmail({ to: 'a@b.dz', message: 'x', file });
  out.failed = { sheets: e6.sheets.map((s) => s.number + ':' + s.saved + ':' + (s.path ? 'path' : 'none')), opened: opened.length - openedBefore };
  failFor = null;

  // the file name is made of the order number, kept to safe characters
  folder.clear();
  const pdf3 = await L.localDocumentService.labPdf(['o3'], 'en');
  const e7 = await C.openEmail({ to: 'a@b.dz', file: pdf3.file });
  out.safeName = e7.sheets.map((s) => s.path);

  // refused: nothing is opened
  const before = opened.length;
  const bad = {
    noAddress: () => C.openEmail({ file }),
    notAnAddress: () => C.openEmail({ to: 'not-an-address', file }),
    twoAddresses: () => C.openEmail({ to: 'a@b.dz, c@d.dz', file }),
    injected: () => C.openEmail({ to: 'a@b.dz&bcc=evil@x.dz', file }),
    textNotText: () => C.openEmail({ to: 'a@b.dz', message: 42, file }),
    tooLong: () => C.openEmail({ to: 'a@b.dz', message: 'x'.repeat(2001), file }),
    subjectTooLong: () => C.openEmail({ to: 'a@b.dz', subject: 'x'.repeat(2001), file }),
    otherFile: () => C.openEmail({ to: 'a@b.dz', file: 'C:/Windows/win.ini' }),
    noFile: () => C.openEmail({ to: 'a@b.dz' }),
    fileNotText: () => C.openEmail({ to: 'a@b.dz', file: { path: file } }),
    noPhone: () => C.openWhatsApp({ file }),
    badPhone: () => C.openWhatsApp({ phone: 'call me', file }),
    shortPhone: () => C.openWhatsApp({ phone: '12', file }),
    waOtherFile: () => C.openWhatsApp({ phone: '0555 11 22 33', file: '../../secret.pdf' }),
    waTooLong: () => C.openWhatsApp({ phone: '0555 11 22 33', message: 'x'.repeat(2001), file }),
    nothing: () => C.openEmail(undefined),
    nothingWa: () => C.openWhatsApp(null),
  };
  out.bad = {};
  for (const [name, run] of Object.entries(bad)) out.bad[name] = await run().then(() => 'OPENED', (e) => e.kind ?? e.message);
  out.nothingOpened = opened.length === before;
  out.api = Object.keys(C);

  process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n', () => process.exit(0));
`,
);
const r = JSON.parse(/RESULT (.*)/.exec(out)?.[1] ?? "{}");

R.section("the WhatsApp number");
const n = r.numbers ?? {};
R.ck(n["0555 11 22 33"] === "213555112233" && n["0555-11-22-33"] === "213555112233" && n["(0555) 11 22 33"] === "213555112233", "a national number (0555 11 22 33, with dashes or brackets) gets the country code: 213555112233");
R.ck(n["+213 555 11 22 33"] === "213555112233" && n["00213555112233"] === "213555112233" && n["213555112233"] === "213555112233" && n["555112233"] === "213555112233", "an international one (+213, 00213, 213) or one typed without its 0 gives the same number");
R.ck(n["+33 6 12 34 56 78"] === "33612345678" && n["+1 (415) 555-2671"] === "14155552671", "another country's number keeps its own code");
R.ck(["12", "0", "abc", "0555 abc", "", "+", "0000", "05551122334455667788"].every((k) => n[k] === null), "what cannot be a number (too short or too long, letters, zeros) gives nothing", JSON.stringify(n));

R.section("the email");
R.ck(r.noOpener === "invalid-input", "with no browser available it is refused, not lost");
R.ck(r.emailParts?.origin === "https://mail.google.com" && r.emailParts?.path === "/mail/" && r.emailParts?.view === "cm" && r.emailParts?.to === "orders@essilor.dz", "it opens Gmail's compose page, to the address (spaces around it removed)", JSON.stringify(r.emailParts));
R.ck(r.emailParts?.body === "Bonjour,\nVoici les commandes & urgentes #1 : 100% é à ñ 中 😀 ?x=1", "the text arrives exactly as typed (line break, &, #, %, accents, other scripts, an emoji, a question mark)", JSON.stringify(r.emailParts?.body));
R.ck(r.emailParts?.su === "Verres urgents", "a subject keeps to one line", JSON.stringify(r.emailParts?.su));
R.ck(JSON.stringify(r.subjects) === JSON.stringify(["Commandes de verres: CMD-1, CMD-2", "طلبات العدسات: CMD-1", "Lens orders: CMD-1", ""]), "with no subject one is made from the order numbers, in the language (an unknown language gives English; no numbers, no subject)", JSON.stringify(r.subjects));
R.ck(r.emptyBody === "", "no message: an empty text");

R.section("the lab sheets in the optician folder");
R.ck(r.bundle?.made === 1 && JSON.stringify(r.bundle?.numbers) === JSON.stringify(["CMD-2026-0001", "CMD-2026-0002"]), "the PDF the person got holds the two orders");
R.ck(r.first?.sheets?.length === 2 && r.first.sheets.every((s) => s.saved === true && s.path === "C:/Users/me/optician/" + s.number + ".pdf"), "the first send makes the sheet of each order and puts it in the folder, one file per order, named by the order number", JSON.stringify(r.first?.sheets));
R.ck(r.first?.madeFor?.join() === "lab-sheet,lab-sheet" && JSON.stringify(r.first?.folder) === JSON.stringify(["CMD-2026-0001.pdf", "CMD-2026-0002.pdf"]), "two single-order PDFs were made (not the whole bundle again)", JSON.stringify([r.first?.madeFor, r.first?.folder]));
R.ck(r.first?.order?.join() === "move:CMD-2026-0001.pdf,move:CMD-2026-0002.pdf,open", "the sheets are in the folder first, then the message opens", JSON.stringify(r.first?.order));
R.ck(r.again?.madeMore === 0 && r.again?.allThere === true, "sending again, by email or by WhatsApp: every sheet is already there, so none is made or copied again (not one PDF made)", JSON.stringify(r.again));
R.ck(r.partial?.sheets?.join() === "CMD-2026-0001:false,CMD-2026-0002:true" && r.partial?.madeMore === 1, "one sheet is missing from the folder: only that one is made again", JSON.stringify(r.partial));
R.ck(r.failed?.sheets?.join() === "CMD-2026-0001:false:none,CMD-2026-0002:true:path" && r.failed?.opened === 1, "a sheet that cannot be saved is reported (no path); the other is saved and the message is opened all the same", JSON.stringify(r.failed));
R.ck(r.safeName?.join() === "C:/Users/me/optician/A_B_C_1_x.pdf", "the file name keeps to safe characters (an order number with spaces, slashes and ? is cleaned)", JSON.stringify(r.safeName));

R.section("WhatsApp");
R.ck(r.whatsapp?.url?.startsWith("https://wa.me/213555112233?text=") && r.whatsapp?.text === "Bonjour,\nVoici les commandes & urgentes #1 : 100% é à ñ 中 😀 ?x=1", "it opens wa.me with the international number and the text exactly as typed", r.whatsapp?.url);
R.ck(r.whatsappNoText === "https://wa.me/213555112233", "without a message there is no text part", r.whatsappNoText);

R.section("what is refused");
const b = r.bad ?? {};
R.ck(Object.entries(b).every(([, v]) => v === "invalid-input"), "every one of these is refused as invalid input: no address, a wrong one, two addresses, an address with something added, a message that is not text or too long, another file, no file, no phone, a phone that is not one, nothing at all", JSON.stringify(Object.entries(b).filter(([, v]) => v !== "invalid-input")));
R.ck(r.nothingOpened === true, "and nothing was opened for any of them");
R.ck(r.api?.join() === "openEmail,openWhatsApp", "contact.openEmail and contact.openWhatsApp are what the window may call");

process.exit(R.done());
