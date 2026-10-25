// A stand-in for the shop's server, for tests of the desktop app's sync and licence logic. It speaks the same HTTP contract as the real servers:
//   GET  /api/expiry                      200 { expiry } for a key whose licence is valid; 401 { code: "UNAUTHORIZED" } for an unknown key or an ended licence
//   POST /api/register                    the shop's details (checked by the REAL validateRegisterBody of the backend); 200 { registered: true, expiry, tenant }
//   POST /api/infos                       the shop's details edited later
//   POST /api/table/<name>?action=        insert | update | delete: the body is checked by the REAL table core of the backend (backend/src/lib/tableCore.js, the same code the
//                                         servers run: column map, types, required fields, parents), the rows are then kept in memory (state.tables), so a test can compare what
//                                         the server holds with what the app holds. A row whose parent the server does not have is refused (422) like the real database does.
// It can be told to misbehave: mode "down" (the connection is dropped), "slow" (answers after delayMs), "error" (answers 500), "portal" (a captive portal: 401 without the server's code),
// and a key's licence can be ended or restored.
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..", "..");
const NEVER_DELETED = new Set(["orders", "order_items", "payments", "invoices", "invoice_items", "number_sequences"]);
const READ_ONLY = new Set(["categories", "tenants"]);
const importEsm = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

async function startFakeServer({ keys = {}, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const { TABLE_COLUMNS } = await importEsm("backend/src/lib/tableColumns.js");
  const { runTableAction } = await importEsm("backend/src/lib/tableCore.js");
  const { validateRegisterBody } = await importEsm("backend/src/lib/registerCore.js");
  // the categories the server already has (read from the source: loading the app's own module here would open a database)
  const categoryIds = [...require("node:fs").readFileSync(path.join(ROOT, "src", "local", "staticCategories.ts"), "utf8").matchAll(/^\s*id: (\d+),/gm)].map((m) => Number(m[1]));

  const state = {
    mode: "ok", // ok | down | slow | error
    delayMs: 0,
    keys: new Map(Object.entries(keys).map(([key, v]) => [key, { licence: "valid", expiry: "2099-12-31", shop: null, registered: 0, ...v }])),
    tables: {}, // table -> Map(id -> row as sent)
    requests: [], // { at, method, path, table, action, key, status, code }
    deleted: [], // { table, id }
  };
  const store = (name) => (state.tables[name] ??= new Map());
  for (const id of categoryIds) store("categories").set(String(id), { id });

  const fieldOfColumn = (t, column) => Object.keys(t.columns).find((f) => t.columns[f].column === column) ?? column;
  const rowsOf = (name) => [...store(name).values()];

  const licenceOk = (entry) => entry && entry.licence === "valid";
  const unauthorized = () => ({ status: 401, body: { error: "Unauthorized", code: "UNAUTHORIZED" } });

  /** The rows of a table that a "where" (or a delete body) names, by the app's own field names. */
  const matching = (name, where) => rowsOf(name).filter((row) => Object.entries(where).every(([field, value]) => row[field] === value));

  /** What the database does for the table core: the parents the core asks about are answered from the rows held here. */
  const databaseFor = (name, action, body) => ({
    removeFiles: async () => [],
    query: async (text, params) => {
      if (/^SELECT id::text AS id FROM "([a-z_]+)"/.test(text)) {
        const parentTable = /FROM "([a-z_]+)"/.exec(text)[1];
        const ids = JSON.parse(params[0]);
        return ids.filter((id) => store(parentTable).has(String(id))).map((id) => ({ id: String(id) }));
      }
      if (action === "insert") return body.rows.map((r) => ({ id: r.id })); // every row is written
      const found = matching(name, action === "update" ? body.where : body);
      return [{ matched: found.length, changed: found.length, photo_ids: [] }];
    },
  });

  async function table(name, action, body, entryKey) {
    if (READ_ONLY.has(name) || !(name in TABLE_COLUMNS)) return { status: name in TABLE_COLUMNS ? 403 : 404, body: { code: name in TABLE_COLUMNS ? "ACTION_NOT_ALLOWED" : "TABLE_NOT_FOUND", error: `no ${action} on ${name}` } };
    if (!["insert", "update", "delete"].includes(action)) return { status: 400, body: { code: "INVALID_ACTION", error: "unknown action" } };
    if (action === "delete" && NEVER_DELETED.has(name)) return { status: 403, body: { code: "ACTION_NOT_ALLOWED", error: `rows of ${name} are never deleted` } };
    const t = TABLE_COLUMNS[name];
    const result = await runTableAction({ table: name, action, body, tenantKey: entryKey, db: databaseFor(name, action, body) });
    if (result.status !== 200) return result;
    // the core accepted it: the rows are kept
    if (action === "insert") {
      const conflictFields = (t.conflict ?? ["id"]).map((c) => fieldOfColumn(t, c));
      for (const row of body.rows) {
        const same = rowsOf(name).find((r) => conflictFields.every((f) => r[f] === row[f]));
        if (same) store(name).set(String(same.id), { ...same, ...row, id: same.id });
        else store(name).set(String(row.id), { ...row });
      }
    } else if (action === "update") {
      for (const row of matching(name, body.where)) Object.assign(row, body.set);
    } else {
      for (const row of matching(name, body)) {
        store(name).delete(String(row.id));
        state.deleted.push({ table: name, id: row.id });
      }
    }
    return result;
  }

  const server = http.createServer((req, res) => {
    let text = "";
    req.on("data", (d) => (text += d));
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? null;
      const record = { at: Date.now(), method: req.method, path: url.pathname, key, table: null, action: null, status: 0, code: null };
      state.requests.push(record);
      if (state.mode === "down") return req.socket.destroy();
      if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
      const send = (r) => {
        record.status = r.status;
        record.code = r.body?.code ?? null;
        res.writeHead(r.status, { "content-type": "application/json" });
        res.end(JSON.stringify(r.body));
      };
      if (state.mode === "error") return send({ status: 500, body: { error: "The server failed.", code: "INTERNAL" } });
      if (state.mode === "portal") return send({ status: 401, body: { error: "Sign in to the Wi-Fi to continue." } }); // a 401 that is not the server's own refusal (no UNAUTHORIZED code)
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { return send({ status: 400, body: { code: "BODY_NOT_JSON", error: "not json" } }); }
      const entry = key ? state.keys.get(key) : undefined;
      try {
        if (url.pathname === "/api/expiry" && req.method === "GET") return send(licenceOk(entry) ? { status: 200, body: { expiry: entry.expiry } } : unauthorized());
        if (url.pathname === "/api/register" && req.method === "POST") {
          if (!licenceOk(entry)) return send(unauthorized());
          const checked = validateRegisterBody(body);
          if (checked.failure) return send(checked.failure);
          entry.shop = { ...(entry.shop ?? {}), ...body };
          entry.registered += 1;
          return send({ status: 200, body: { registered: true, tenant: entry.shop, expiry: entry.expiry } });
        }
        if (url.pathname === "/api/infos" && req.method === "POST") {
          if (!licenceOk(entry)) return send(unauthorized());
          entry.shop = { ...(entry.shop ?? {}), ...body };
          return send({ status: 200, body: { updated: true } });
        }
        const m = /^\/api\/table\/([a-z_]+)$/.exec(url.pathname);
        if (m && req.method === "POST") {
          if (!licenceOk(entry)) return send(unauthorized());
          record.table = m[1];
          record.action = url.searchParams.get("action");
          return send(await table(m[1], record.action, body, key));
        }
        return send({ status: 404, body: { error: "not found" } });
      } catch (err) {
        return send({ status: 500, body: { error: String(err?.message ?? err), code: "INTERNAL" } });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  return {
    state,
    url: `http://127.0.0.1:${server.address().port}`,
    rows: (name) => rowsOf(name),
    row: (name, id) => store(name).get(String(id)) ?? null,
    count: (name) => store(name).size,
    /** The writes the app made, as "table:action" in the order they arrived (reads of /api/expiry and so on are not in it). */
    writes: () => state.requests.filter((r) => r.table).map((r) => `${r.table}:${r.action}`),
    clearRequests: () => (state.requests.length = 0),
    setMode: (mode, delayMs = 0) => { state.mode = mode; state.delayMs = delayMs; },
    setLicence: (key, licence) => { state.keys.get(key).licence = licence; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

module.exports = { startFakeServer };
