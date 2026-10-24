/**
 * The two printed documents of an order, as pages of HTML (A4, black on white, whatever the app's theme): no database, no Electron, so they can be
 * tested alone. documentService.ts reads the order and fills the data; src/documentPrinter.ts sends the page to a printer.
 *
 *   invoiceHtml(doc, lang)   for the CUSTOMER: the shop, the invoice number, what was sold, the total, what was paid and what is left.
 *   labSheetHtml(doc, lang)  for the LAB: the prescription as written, the lens of each eye, the measurements, the frame, the promised day.
 *
 * Both are written in the language the person is using (en, fr, ar; Arabic is laid out right to left). Every value is escaped.
 */

export type DocLang = "en" | "fr" | "ar";
export const DOC_LANGS: readonly DocLang[] = ["en", "fr", "ar"];

export interface DocShop {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface InvoiceDoc {
  shop: DocShop;
  number: string;
  orderNumber: string;
  issuedAt: string;
  customer: { name: string; phone: string | null; address: string | null } | null;
  lines: InvoiceLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
}

export interface LabEye {
  sphere: number | null;
  cylinder: number | null;
  axis: number | null;
  add: number | null;
}

export interface LabLens {
  /** What the order line says, as sold. */
  description: string;
  /** What the catalogue knows about it (null for a lens described in words). */
  spec: { design: string; material: string; refractiveIndex: number | null; antiReflective: boolean; blueLightFilter: boolean; photochromic: boolean; polarized: boolean; tint: string | null } | null;
}

export interface LabDoc {
  /** The order's id. */
  orderId: string;
  shop: DocShop;
  orderNumber: string;
  orderedAt: string;
  promisedAt: string | null;
  customerName: string | null;
  prescription: { prescribedAt: string; prescriberName: string | null; right: LabEye; left: LabEye; notes: string | null } | null;
  measurements: { pdRight: number | null; pdLeft: number | null; fittingHeightRight: number | null; fittingHeightLeft: number | null };
  lenses: LabLens[];
  frame: { description: string; code: string | null; reference: string | null; eyeSize: number | null; bridge: number | null; templeLength: number | null } | null;
  notes: string | null;
}

type Words = Record<string, string>;

const WORDS: Record<DocLang, Words> = {
  en: {
    invoice: "Invoice", labOrder: "Lens order", order: "Order", date: "Date", customer: "Customer", phone: "Phone", email: "Email", address: "Address",
    description: "Description", qty: "Qty", unitPrice: "Unit price", amount: "Amount", subtotal: "Subtotal", discount: "Discount", total: "Total", paid: "Paid",
    balance: "Balance due", paidInFull: "Paid in full", thanks: "Thank you for your trust.", promised: "Promised for", prescription: "Prescription",
    prescribedOn: "Prescribed on", prescriber: "Prescriber", right: "Right", left: "Left", eye: "Eye", sphere: "Sphere", cylinder: "Cylinder", axis: "Axis", add: "Add",
    measurements: "Measurements", pd: "PD (mm)", fittingHeight: "Fitting height (mm)", lenses: "Lenses", frame: "Frame", size: "Size (eye / bridge / temple)",
    code: "Code", reference: "Reference", frameSent: "Frame sent with this order", notes: "Notes", noPrescription: "No prescription on this order.", noLens: "No lens on this order.",
    singleVision: "Single vision", bifocal: "Bifocal", progressive: "Progressive", organic: "Organic", polycarbonate: "Polycarbonate", mineral: "Mineral", highIndex: "High index",
    index: "Index", antiReflective: "Anti-reflective", blueLight: "Blue light filter", photochromic: "Photochromic", polarized: "Polarized", tint: "Tint",
    plano: "plano", preparedBy: "Prepared by",
  },
  fr: {
    invoice: "Facture", labOrder: "Commande de verres", order: "Commande", date: "Date", customer: "Client", phone: "Téléphone", email: "E-mail", address: "Adresse",
    description: "Désignation", qty: "Qté", unitPrice: "Prix unitaire", amount: "Montant", subtotal: "Sous-total", discount: "Remise", total: "Total", paid: "Réglé",
    balance: "Reste à payer", paidInFull: "Soldée", thanks: "Merci de votre confiance.", promised: "Promise pour le", prescription: "Ordonnance",
    prescribedOn: "Établie le", prescriber: "Prescripteur", right: "Droit", left: "Gauche", eye: "Œil", sphere: "Sphère", cylinder: "Cylindre", axis: "Axe", add: "Addition",
    measurements: "Mesures", pd: "EP (mm)", fittingHeight: "Hauteur de montage (mm)", lenses: "Verres", frame: "Monture", size: "Taille (calibre / pont / branche)",
    code: "Code", reference: "Référence", frameSent: "Monture envoyée avec cette commande", notes: "Notes", noPrescription: "Aucune ordonnance sur cette commande.", noLens: "Aucun verre sur cette commande.",
    singleVision: "Unifocal", bifocal: "Bifocal", progressive: "Progressif", organic: "Organique", polycarbonate: "Polycarbonate", mineral: "Minéral", highIndex: "Haut indice",
    index: "Indice", antiReflective: "Anti-reflet", blueLight: "Filtre lumière bleue", photochromic: "Photochromique", polarized: "Polarisé", tint: "Teinte",
    plano: "plan", preparedBy: "Préparé par",
  },
  ar: {
    invoice: "فاتورة", labOrder: "طلب عدسات", order: "الطلب", date: "التاريخ", customer: "الزبون", phone: "الهاتف", email: "البريد الإلكتروني", address: "العنوان",
    description: "البيان", qty: "الكمية", unitPrice: "سعر الوحدة", amount: "المبلغ", subtotal: "المجموع الجزئي", discount: "التخفيض", total: "المجموع", paid: "المدفوع",
    balance: "المتبقي", paidInFull: "مدفوعة بالكامل", thanks: "شكرًا لثقتكم.", promised: "موعد التسليم", prescription: "الوصفة",
    prescribedOn: "تاريخ الوصفة", prescriber: "الطبيب", right: "اليمنى", left: "اليسرى", eye: "العين", sphere: "الكروية", cylinder: "الأسطوانية", axis: "المحور", add: "الإضافة",
    measurements: "القياسات", pd: "المسافة الحدقية (مم)", fittingHeight: "ارتفاع التركيب (مم)", lenses: "العدسات", frame: "الإطار", size: "المقاس (العدسة / الجسر / الذراع)",
    code: "الرمز", reference: "المرجع", frameSent: "الإطار مرسل مع هذا الطلب", notes: "ملاحظات", noPrescription: "لا توجد وصفة في هذا الطلب.", noLens: "لا توجد عدسات في هذا الطلب.",
    singleVision: "أحادية البؤرة", bifocal: "ثنائية البؤرة", progressive: "تدرجية", organic: "عضوية", polycarbonate: "بولي كربونات", mineral: "معدنية", highIndex: "معامل مرتفع",
    index: "المعامل", antiReflective: "مضادة للانعكاس", blueLight: "فلتر الضوء الأزرق", photochromic: "متغيرة اللون", polarized: "مستقطبة", tint: "لون",
    plano: "صفر", preparedBy: "أعدّه",
  },
};

export function docLang(value: unknown): DocLang {
  return DOC_LANGS.includes(value as DocLang) ? (value as DocLang) : "en";
}

const LOCALE: Record<DocLang, string> = { en: "en-GB-u-nu-latn", fr: "fr-DZ-u-nu-latn", ar: "ar-DZ-u-nu-latn" };

/** Escapes text for HTML (every value that comes from the shop's data goes through this). */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function dayText(iso: string, lang: DocLang): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE[lang], { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(date);
}

/** Centimes as an amount in the shop's currency: "18 500,00 DA" style, in the language's own grouping. */
export function money(cents: number, lang: DocLang): string {
  const amount = cents / 100;
  const whole = Number.isInteger(amount);
  return `${new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount)} ${lang === "ar" ? "د.ج" : "DZD"}`;
}

/** A power in diopters with its sign: +2.00, -1.25; an empty one stays empty. */
export function diopter(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

const mm = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

const STYLE = `
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; font-size: 10.5pt; line-height: 1.4; }
  h1 { font-size: 20pt; margin: 0; letter-spacing: 0.02em; }
  h2 { font-size: 11pt; margin: 14pt 0 4pt; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #000; padding-bottom: 2pt; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16pt; padding-bottom: 8pt; border-bottom: 2px solid #000; }
  .shop { font-size: 9.5pt; }
  .shop b { display: block; font-size: 13pt; }
  .doc { text-align: end; }
  .doc .no { font-size: 12pt; font-weight: 700; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4pt 16pt; margin-top: 8pt; }
  .meta div span { color: #444; }
  table { width: 100%; border-collapse: collapse; margin-top: 4pt; }
  th, td { padding: 4pt 6pt; border-bottom: 1px solid #bbb; text-align: start; vertical-align: top; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #000; }
  td.n, th.n { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .totals { margin-top: 10pt; margin-inline-start: auto; width: 55%; }
  .totals div { display: flex; justify-content: space-between; padding: 2pt 0; font-variant-numeric: tabular-nums; }
  .totals .grand { font-size: 12pt; font-weight: 700; border-top: 1px solid #000; margin-top: 3pt; padding-top: 4pt; }
  .totals .due { font-size: 13pt; font-weight: 700; border: 2px solid #000; padding: 4pt 6pt; margin-top: 6pt; }
  .foot { margin-top: 22pt; text-align: center; font-size: 9.5pt; color: #333; }
  .box { display: inline-block; width: 11pt; height: 11pt; border: 1.5px solid #000; vertical-align: -2pt; margin-inline-end: 6pt; }
  .eyes th:first-child, .eyes td:first-child { width: 22%; font-weight: 700; }
  .note { white-space: pre-wrap; }
  .muted { color: #444; }
`;

function page(lang: DocLang, title: string, body: string): string {
  const dir = lang === "ar" ? "rtl" : "ltr";
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function shopBlock(shop: DocShop): string {
  const lines = [shop.address, shop.phone, shop.email].filter((x): x is string => Boolean(x));
  return `<div class="shop">${shop.name ? `<b>${esc(shop.name)}</b>` : ""}${lines.map((line) => `<div>${esc(line)}</div>`).join("")}</div>`;
}

export function invoiceHtml(doc: InvoiceDoc, langIn: unknown): string {
  const lang = docLang(langIn);
  const w = WORDS[lang];
  const customer = doc.customer
    ? `<h2>${esc(w.customer)}</h2><div><b>${esc(doc.customer.name)}</b></div>${doc.customer.phone ? `<div class="muted">${esc(w.phone)}: ${esc(doc.customer.phone)}</div>` : ""}${doc.customer.address ? `<div class="muted">${esc(doc.customer.address)}</div>` : ""}`
    : "";
  const rows = doc.lines
    .map((l) => `<tr><td>${esc(l.description)}</td><td class="n">${esc(l.quantity)}</td><td class="n">${esc(money(l.unitPriceCents, lang))}</td><td class="n">${esc(money(l.totalCents, lang))}</td></tr>`)
    .join("");
  const totals = [
    `<div><span>${esc(w.subtotal)}</span><span>${esc(money(doc.subtotalCents, lang))}</span></div>`,
    doc.discountCents > 0 ? `<div><span>${esc(w.discount)}</span><span>− ${esc(money(doc.discountCents, lang))}</span></div>` : "",
    `<div class="grand"><span>${esc(w.total)}</span><span>${esc(money(doc.totalCents, lang))}</span></div>`,
    `<div><span>${esc(w.paid)}</span><span>${esc(money(doc.paidCents, lang))}</span></div>`,
    doc.balanceCents > 0 ? `<div class="due"><span>${esc(w.balance)}</span><span>${esc(money(doc.balanceCents, lang))}</span></div>` : `<div class="due"><span>${esc(w.paidInFull)}</span><span>✓</span></div>`,
  ].join("");
  const body = `
    <div class="head">${shopBlock(doc.shop)}<div class="doc"><h1>${esc(w.invoice)}</h1><div class="no">${esc(doc.number)}</div><div class="muted">${esc(w.date)}: ${esc(dayText(doc.issuedAt, lang))}</div><div class="muted">${esc(w.order)}: ${esc(doc.orderNumber)}</div></div></div>
    ${customer}
    <table><thead><tr><th>${esc(w.description)}</th><th class="n">${esc(w.qty)}</th><th class="n">${esc(w.unitPrice)}</th><th class="n">${esc(w.amount)}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="totals">${totals}</div>
    <div class="foot">${esc(w.thanks)}</div>`;
  return page(lang, `${w.invoice} ${doc.number}`, body);
}

function lensSpecText(spec: NonNullable<LabLens["spec"]>, w: Words): string {
  const design: Record<string, string> = { single_vision: w.singleVision, bifocal: w.bifocal, progressive: w.progressive };
  const material: Record<string, string> = { organic: w.organic, polycarbonate: w.polycarbonate, mineral: w.mineral, high_index: w.highIndex };
  return [
    design[spec.design] ?? spec.design,
    material[spec.material] ?? spec.material,
    spec.refractiveIndex ? `${w.index} ${spec.refractiveIndex}` : null,
    spec.antiReflective ? w.antiReflective : null,
    spec.blueLightFilter ? w.blueLight : null,
    spec.photochromic ? w.photochromic : null,
    spec.polarized ? w.polarized : null,
    spec.tint ? `${w.tint}: ${spec.tint}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function labSheetHtml(doc: LabDoc, langIn: unknown): string {
  const lang = docLang(langIn);
  return page(lang, `${WORDS[lang].labOrder} ${doc.orderNumber}`, labSheetBody(doc, lang));
}

/** Several lab sheets in one document, one per page, in the order given (what is sent to a lens supplier in one go). */
export function labBundleHtml(docs: LabDoc[], langIn: unknown): string {
  const lang = docLang(langIn);
  const body = docs.map((doc) => `<section style="break-after:page;page-break-after:always">${labSheetBody(doc, lang)}</section>`).join("");
  return page(lang, `${WORDS[lang].labOrder} (${docs.length})`, body);
}

function labSheetBody(doc: LabDoc, lang: DocLang): string {
  const w = WORDS[lang];
  const eyeRow = (label: string, eye: LabEye) => {
    const sphere = eye.sphere === null && eye.cylinder !== null ? w.plano : diopter(eye.sphere);
    return `<tr><td>${esc(label)}</td><td class="n">${esc(sphere)}</td><td class="n">${esc(diopter(eye.cylinder))}</td><td class="n">${esc(eye.axis === null ? "" : `${eye.axis}°`)}</td><td class="n">${esc(diopter(eye.add))}</td></tr>`;
  };
  const rx = doc.prescription
    ? `<table class="eyes"><thead><tr><th>${esc(w.eye)}</th><th class="n">${esc(w.sphere)}</th><th class="n">${esc(w.cylinder)}</th><th class="n">${esc(w.axis)}</th><th class="n">${esc(w.add)}</th></tr></thead><tbody>${eyeRow(w.right, doc.prescription.right)}${eyeRow(w.left, doc.prescription.left)}</tbody></table>
       <div class="muted">${esc(w.prescribedOn)}: ${esc(dayText(doc.prescription.prescribedAt, lang))}${doc.prescription.prescriberName ? ` · ${esc(w.prescriber)}: ${esc(doc.prescription.prescriberName)}` : ""}</div>
       ${doc.prescription.notes ? `<div class="note muted">${esc(doc.prescription.notes)}</div>` : ""}`
    : `<div class="muted">${esc(w.noPrescription)}</div>`;
  const m = doc.measurements;
  const measurements = `<table class="eyes"><thead><tr><th>${esc(w.eye)}</th><th class="n">${esc(w.pd)}</th><th class="n">${esc(w.fittingHeight)}</th></tr></thead><tbody>
      <tr><td>${esc(w.right)}</td><td class="n">${esc(mm(m.pdRight))}</td><td class="n">${esc(mm(m.fittingHeightRight))}</td></tr>
      <tr><td>${esc(w.left)}</td><td class="n">${esc(mm(m.pdLeft))}</td><td class="n">${esc(mm(m.fittingHeightLeft))}</td></tr></tbody></table>`;
  const lenses = doc.lenses.length
    ? doc.lenses.map((l) => `<div><b>${esc(l.description)}</b>${l.spec ? `<div class="muted">${esc(lensSpecText(l.spec, w))}</div>` : ""}</div>`).join("")
    : `<div class="muted">${esc(w.noLens)}</div>`;
  const f = doc.frame;
  const size = f && (f.eyeSize !== null || f.bridge !== null || f.templeLength !== null) ? [f.eyeSize, f.bridge, f.templeLength].map((x) => (x === null ? "–" : x)).join(" / ") : null;
  const frame = f
    ? `<div><b>${esc(f.description)}</b></div><div class="muted">${[f.code ? `${w.code}: ${f.code}` : null, f.reference ? `${w.reference}: ${f.reference}` : null, size ? `${w.size}: ${size}` : null].filter(Boolean).map(esc).join(" · ")}</div>`
    : "";
  const body = `
    <div class="head">${shopBlock(doc.shop)}<div class="doc"><h1>${esc(w.labOrder)}</h1><div class="no">${esc(doc.orderNumber)}</div><div class="muted">${esc(w.date)}: ${esc(dayText(doc.orderedAt, lang))}</div>${doc.promisedAt ? `<div class="no">${esc(w.promised)}: ${esc(dayText(doc.promisedAt, lang))}</div>` : ""}</div></div>
    ${doc.customerName ? `<div class="meta"><div><span>${esc(w.customer)}:</span> <b>${esc(doc.customerName)}</b></div></div>` : ""}
    <h2>${esc(w.prescription)}</h2>${rx}
    <h2>${esc(w.measurements)}</h2>${measurements}
    <h2>${esc(w.lenses)}</h2>${lenses}
    ${f ? `<h2>${esc(w.frame)}</h2>${frame}` : ""}
    <div style="margin-top:12pt"><span class="box"></span>${esc(w.frameSent)}</div>
    ${doc.notes ? `<h2>${esc(w.notes)}</h2><div class="note">${esc(doc.notes)}</div>` : ""}`;
  return body;
}
