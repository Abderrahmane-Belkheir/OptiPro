// Compares what this computer holds with what the (fake) server holds: the core check of the sync. Used by the end-to-end tests.
//   dumpLocal(box)               reads every synced table of the sandbox's database (the app must not be running on it): { table: [row, ...] }
//   reconcile(R, fake, local)    records the checks: the same rows on both sides, the same values in them, nothing left unsynced
const { runScript } = require("./app.cjs");

const TABLES = {
  brands: "brand", customers: "customer", lenses: "lens", suppliers: "supplier", frames: "frame", accessories: "accessory", prescriptions: "prescription", orders: "order",
  supplier_orders: "supplierOrder", supplier_order_items: "supplierOrderItem", order_items: "orderItem", payments: "payment", invoices: "invoice", invoice_items: "invoiceItem",
  number_sequences: "numberSequence",
};

/** Every row of every synced table (dates as ISO text), with the app's own `synced` flag. */
function dumpLocal(box) {
  const out = runScript(
    box,
    `
    const tables = ${JSON.stringify(TABLES)};
    const dump = {};
    for (const [table, delegate] of Object.entries(tables)) dump[table] = await p[delegate].findMany();
    dump._pendingDeletions = await p.pendingDeletion.findMany();
    console.log('DUMP ' + JSON.stringify(dump));
  `,
  );
  return JSON.parse(/DUMP (.*)/.exec(out)[1]);
}

const isIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v);
const same = (a, b) => {
  if (a === b) return true;
  if (isIso(a) && isIso(b)) return Date.parse(a) === Date.parse(b);
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && typeof b === "string") return JSON.stringify(a) === b; // a list the server keeps as a list, here as JSON text
  if (typeof a === "boolean" && typeof b === "number") return a === (b !== 0);
  return false;
};

/**
 * For every table: the ids held here and on the server are the same; every value the server holds is the one held here (the server's rows are what the app sent: a difference
 * is a change that was made here and never sent). Answers the differences found, for the report.
 */
function differences(fake, local) {
  const found = [];
  for (const table of Object.keys(TABLES)) {
    const here = new Map((local[table] ?? []).map((r) => [String(r.id), r]));
    const there = new Map(fake.rows(table).map((r) => [String(r.id), r]));
    for (const id of here.keys()) if (!there.has(id)) found.push(`${table} ${id}: held here, not on the server`);
    for (const id of there.keys()) if (!here.has(id)) found.push(`${table} ${id}: on the server, not held here`);
    for (const [id, remote] of there) {
      const mine = here.get(id);
      if (!mine) continue;
      for (const [field, value] of Object.entries(remote)) {
        if (field === "tenantKey" || value === undefined) continue;
        const localValue = mine[field];
        if (localValue === undefined) continue; // a field the app does not keep under that name
        if (!same(value, localValue) && !(value === null && localValue === null)) found.push(`${table} ${id}.${field}: server ${JSON.stringify(value)} here ${JSON.stringify(localValue)}`);
      }
    }
  }
  return found;
}

function reconcile(R, fake, local, label = "") {
  const waitingDeletions = (local._pendingDeletions ?? []).map((d) => `${d.kind} ${d.targetId} (${d.attempts} tries: ${d.lastError ?? ""})`);
  R.ck(waitingDeletions.length === 0, `${label}no deletion is still waiting to be sent`, waitingDeletions.join("; "));
  const unsynced = Object.entries(local).filter(([table]) => !table.startsWith("_")).flatMap(([table, rows]) => rows.filter((r) => r.synced === false || r.synced === 0).map((r) => `${table} ${r.id}`));
  R.ck(unsynced.length === 0, `${label}every row held here is marked synced`, unsynced.slice(0, 8).join("; "));
  const diff = differences(fake, local);
  R.ck(diff.length === 0, `${label}the server holds exactly what this computer holds (${Object.entries(local).filter(([table]) => !table.startsWith("_")).reduce((n, [, rows]) => n + rows.length, 0)} rows)`, diff.slice(0, 10).join("\n      "));
}

module.exports = { dumpLocal, differences, reconcile, TABLES };
