// GET /api/orders/<tracking_id>: following an order with its 6-digit tracking code, on the Cloudflare Worker and on the Express backend (both with an in-memory stand-in for the
// database). Public, no key, the shop is the request's host. It answers the status, the dates, the totals, how much is paid (the sum of the order's payments) and what is left,
// the lines and the shop's contact, and NEVER the prescription, the measurements, the notes, the customer, the list of payments or what the lines cost the shop. Wrong codes are slowed down per address. The SQL itself is not run here (no Postgres): the
// stand-in answers the statements the servers send, and the SQL text is checked for what it must not select.
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const url = (...parts) => pathToFileURL(path.join(ROOT, ...parts)).href;
const today = new Date().toISOString().slice(0, 10);
const shift = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// ---- the data: three shops (a live one, another live one, one whose licence ended) and their orders
const SHOPS = {
  "a.example.com": { key: "keyA", name: "Optique Soleil", phone: "0550 12 34 56", address: "12 Rue Didouche Mourad, Alger", expiry: shift(30) },
  "b.example.com": { key: "keyB", name: "Vision Plus", phone: null, address: "  ", expiry: shift(5) },
  "old.example.com": { key: "keyOld", name: "Old Shop", phone: "0661", address: "x", expiry: shift(-1) },
};
const ORDERS = [
  // shop A
  { tenant: "keyA", code: 482915, number: "CMD-2026-0042", status: "ready", ordered_at: new Date("2026-10-01T09:00:00Z"), promised_at: new Date("2026-10-10T00:00:00Z"), delivered_at: null, subtotal_cents: 3300000, discount_cents: 100000, total_cents: 3200000, payments: [1000000, 500000],
    items: [
      { kind: "frame", description: "Ray-Ban Aviator", eye: null, quantity: 1, unitPriceCents: 1850000, totalCents: 1850000 },
      { kind: "lens", description: "Essilor Progressive 1.6", eye: "both", quantity: 1, unitPriceCents: 1450000, totalCents: 1450000 },
    ] },
  { tenant: "keyA", code: 111222, number: "CMD-2026-0043", status: "cancelled", ordered_at: new Date("2026-10-02T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 500000, discount_cents: 0, total_cents: 500000, payments: [200000], items: [] },
  { tenant: "keyA", code: 333444, number: "CMD-2026-0044", status: "delivered", ordered_at: new Date("2026-09-01T09:00:00Z"), promised_at: new Date("2026-09-05T00:00:00Z"), delivered_at: new Date("2026-09-04T10:00:00Z"), subtotal_cents: 120000, discount_cents: 0, total_cents: 120000, payments: [100000, 20000],
    items: [{ kind: "accessory", description: "Hard case", eye: "", quantity: 2, unitPriceCents: 60000, totalCents: 120000 }] },
  // shop B: the same code as shop A's first order, another order
  { tenant: "keyB", code: 482915, number: "CMD-2026-0001", status: "confirmed", ordered_at: new Date("2026-10-03T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 100000, discount_cents: 0, total_cents: 100000, payments: [150000], items: [] }, // (paid more than the total)
  // the shop whose licence ended
  { tenant: "keyOld", code: 555666, number: "CMD-2025-0009", status: "ready", ordered_at: new Date("2025-01-01T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 1, discount_cents: 0, total_cents: 1, payments: [], items: [] },
  // a shop A order with no payment at all
  { tenant: "keyA", code: 777888, number: "CMD-2026-0045", status: "confirmed", ordered_at: new Date("2026-10-05T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 900000, discount_cents: 0, total_cents: 900000, payments: [], items: [] },
];

/** The row TRACK_SQL gives for the shop (by key) and the code. */
function trackRow(tenantKey, code) {
  const order = ORDERS.find((o) => o.tenant === tenantKey && o.code === code);
  if (!order) return null;
  const shop = Object.values(SHOPS).find((s) => s.key === tenantKey);
  return { number: order.number, tracking_code: order.code, status: order.status, ordered_at: order.ordered_at, promised_at: order.promised_at, delivered_at: order.delivered_at, subtotal_cents: order.subtotal_cents, discount_cents: order.discount_cents, total_cents: order.total_cents, paid_cents: order.payments.length === 0 ? "0" : String(order.payments.reduce((a, b) => a + b, 0)), shop_name: shop.name, shop_phone: shop.phone, shop_address: shop.address, items: order.items };
}

/** The Neon driver's client, in memory: query() returns a statement that can be awaited or handed to transaction(). */
function makeSql(core) {
  const state = { tenant: "", statements: [], transactions: 0 };
  const exec = async (text, params = []) => {
    state.statements.push(text.replace(/\s+/g, " ").trim().slice(0, 60));
    if (/^SELECT set_config\('app\.tenant_key'/.test(text)) {
      state.tenant = SHOPS[params[0]]?.key ?? "";
      return [{ set_config: state.tenant }];
    }
    if (/^SELECT 1 AS expired FROM tenants WHERE host = \$1 AND expiry IS NOT NULL AND expiry::date < /.test(text)) {
      const shop = SHOPS[params[0]];
      return shop && shop.expiry < today ? [{ expired: 1 }] : [];
    }
    if (text === core.TRACK_SQL) {
      if (typeof params[0] !== "number") throw new Error("the code must be sent as a number");
      const row = trackRow(state.tenant, params[0]);
      return row ? [row] : [];
    }
    throw new Error("unexpected statement: " + text);
  };
  const statement = (text, params) => {
    const run = () => exec(text, params);
    return { run, then: (resolve, reject) => run().then(resolve, reject) };
  };
  return {
    state,
    sql: {
      query: statement,
      transaction: async (list) => {
        state.transactions += 1;
        const out = [];
        for (const s of list) out.push(await s.run());
        return out;
      },
    },
  };
}

const SENSITIVE = /prescription|unit_cost|\bcost|\bnotes?\b|\bpd_|fitting|customer|payment|measure|synced/i;
const deepKeys = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, keys));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k); deepKeys(v, keys); }
  return keys;
};

/** The same scenarios against any server: call(host, id, { method, ip }) -> { status, body, headers }. */
async function scenarios(label, call, { resetBrake }) {
  R.section(label);
  resetBrake();
  const found = await call("a.example.com", "482915");
  R.ck(found.status === 200 && found.body?.trackingCode === 482915 && found.body?.number === "CMD-2026-0042" && found.body?.status === "ready", "a code finds its order: status, number and code", JSON.stringify(found.body)?.slice(0, 200));
  R.ck(found.body?.orderedAt === "2026-10-01T09:00:00.000Z" && found.body?.promisedAt === "2026-10-10T00:00:00.000Z" && found.body?.deliveredAt === null, "dates as ISO text (null when there is none)");
  R.ck(found.body?.currency === "DZD" && found.body?.subtotalCents === 3300000 && found.body?.discountCents === 100000 && found.body?.totalCents === 3200000, "the totals in centimes: subtotal, discount, total");
  R.ck(found.body?.paidCents === 1500000 && found.body?.remainingCents === 1700000, "how much is paid (the payments added up: 10 000 + 5 000) and what is left (the total minus it)", JSON.stringify([found.body?.paidCents, found.body?.remainingCents]));
  R.ck(typeof found.body?.paidCents === "number" && typeof found.body?.remainingCents === "number", "both are numbers (even though the database hands a sum over as text)");
  R.ck(found.body?.payments === undefined && !("payment" in found.body), "only the sum goes out, never the list of payments");
  R.ck(found.body?.items?.length === 2 && found.body.items[0].description === "Ray-Ban Aviator" && found.body.items[1].eye === "both" && found.body.items[1].unitPriceCents === 1450000 && found.body.items[0].eye === null, "the lines: what was bought, which eye, the quantity and the prices", JSON.stringify(found.body?.items));
  R.ck(JSON.stringify(Object.keys(found.body.items[0]).sort()) === JSON.stringify(["description", "eye", "kind", "quantity", "totalCents", "unitPriceCents"]), "a line holds exactly those fields and nothing else", Object.keys(found.body.items[0]).join());
  R.ck(found.body?.shop?.name === "Optique Soleil" && found.body?.shop?.phone === "0550 12 34 56" && found.body?.shop?.address === "12 Rue Didouche Mourad, Alger", "the shop's name, phone and address are there to call");
  const leaked = [...deepKeys(found.body)].filter((k) => SENSITIVE.test(k));
  R.ck(leaked.length === 0, "nothing private: no prescription, measurements, notes, customer, payments, nor what the lines cost the shop", leaked.join());
  R.ck(/no-store/.test(found.headers.get("cache-control") ?? ""), "the answer is never cached (Cache-Control: no-store)", found.headers.get("cache-control"));

  const cancelled = await call("a.example.com", "111222");
  const delivered = await call("a.example.com", "333444");
  R.ck(cancelled.status === 200 && cancelled.body?.status === "cancelled" && cancelled.body?.items?.length === 0, "a cancelled order is found, and says it is cancelled");
  R.ck(cancelled.body?.paidCents === 200000 && cancelled.body?.remainingCents === 0, "a cancelled order owes nothing: what was paid is shown, nothing is left");
  const unpaid = await call("a.example.com", "777888");
  R.ck(unpaid.body?.paidCents === 0 && unpaid.body?.remainingCents === 900000, "an order with no payment: paid 0, all of the total is left");
  R.ck(delivered.body?.paidCents === 120000 && delivered.body?.remainingCents === 0, "an order paid in full: nothing is left");
  R.ck(delivered.status === 200 && delivered.body?.deliveredAt === "2026-09-04T10:00:00.000Z" && delivered.body?.items?.[0]?.eye === null && delivered.body?.items?.[0]?.quantity === 2, "a delivered order shows when it was delivered (an empty eye is null)");

  const other = await call("b.example.com", "482915");
  R.ck(other.status === 200 && other.body?.number === "CMD-2026-0001" && other.body?.shop?.name === "Vision Plus", "the same code in another shop is another order: the shop is the host", JSON.stringify(other.body)?.slice(0, 160));
  R.ck(other.body?.paidCents === 150000 && other.body?.remainingCents === 0, "an order paid more than its total: nothing is left (never negative)");
  R.ck(other.body?.shop?.phone === null && other.body?.shop?.address === null, "a shop contact that is empty (or only spaces) is null");
  const wrongShop = await call("b.example.com", "333444");
  R.ck(wrongShop.status === 404 && wrongShop.body?.code === "ORDER_NOT_FOUND", "a code of one shop does not open at another shop's address");
  const unknownHost = await call("nobody.example.com", "482915");
  R.ck(unknownHost.status === 404 && unknownHost.body?.code === "ORDER_NOT_FOUND", "an unknown host finds nothing");
  const missing = await call("a.example.com", "999999");
  R.ck(missing.status === 404 && missing.body?.code === "ORDER_NOT_FOUND" && JSON.stringify(missing.body) === JSON.stringify(unknownHost.body), "a code that matches nothing: 404 ORDER_NOT_FOUND, the same answer for any reason");

  for (const bad of ["12345", "1234567", "abcdef", "012345", "48291a", "-48291", "48.291", "000000"]) {
    const r = await call("a.example.com", bad);
    R.ck(r.status === 400 && r.body?.code === "INVALID_TRACKING_CODE", `"${bad}" is not a tracking code: 400 INVALID_TRACKING_CODE`, String(r.status));
  }

  const post = await call("a.example.com", "482915", { method: "POST" });
  R.ck(post.status === 405 && /GET/.test(post.headers.get("allow") ?? ""), "POST is 405, and Allow names GET", post.headers.get("allow"));
  const none = await call("a.example.com", "");
  R.ck(none.status === 404, "no code in the address: 404");

  // the brake: 20 codes that match nothing, from one address
  resetBrake();
  for (let i = 0; i < 20; i++) await call("a.example.com", String(900000 + i), { ip: "9.9.9.9" });
  const blocked = await call("a.example.com", "482915", { ip: "9.9.9.9" });
  R.ck(blocked.status === 429 && blocked.body?.code === "TOO_MANY_ATTEMPTS" && Number(blocked.headers.get("retry-after")) > 0, "after 20 codes that matched nothing the address is refused, even with a good code (429 with Retry-After)", String(blocked.status));
  const neighbour = await call("a.example.com", "482915", { ip: "8.8.8.8" });
  R.ck(neighbour.status === 200, "another address is not affected");
  resetBrake();
  const afterReset = await call("a.example.com", "482915", { ip: "9.9.9.9" });
  R.ck(afterReset.status === 200, "(the count starts again once the window has passed)");
  resetBrake();
  for (let i = 0; i < 25; i++) await call("a.example.com", "482915", { ip: "7.7.7.7" });
  R.ck((await call("a.example.com", "482915", { ip: "7.7.7.7" })).status === 200, "good codes are never counted: any number of them is answered");
}

(async () => {
  const core = await import(url("backend", "src", "lib", "trackCore.js"));
  const workerCore = await import(url("cloudflare", "src", "trackCore.js"));

  R.section("the shared file");
  R.ck(core.TRACK_SQL === workerCore.TRACK_SQL && core.TRACKING_ID.source === workerCore.TRACKING_ID.source, "the Worker's copy of the shared file is the same as the backend's");
  const withoutPayments = core.TRACK_SQL.replace(/\bpayments\b/g, "").replace(/\bcurrent_setting\b/g, "");
  R.ck(!SENSITIVE.test(withoutPayments), "the SQL selects none of the private columns", (SENSITIVE.exec(withoutPayments) ?? [])[0]);
  const paymentColumns = [...new Set([...core.TRACK_SQL.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))].sort().join();
  R.ck(paymentColumns === "amount_cents,order_id,tenant_key" && /sum\(p\.amount_cents\)/.test(core.TRACK_SQL), "of the payments it reads only the amount (added up), the order and the shop: nothing about when, how, who or any note", paymentColumns);
  R.ck(/o\.tenant_key = current_setting\('app\.tenant_key'\)/.test(core.TRACK_SQL) && /i\.tenant_key = o\.tenant_key/.test(core.TRACK_SQL), "it filters on the shop's key itself, for the order and for its lines");
  R.ck(/\$1/.test(core.TRACK_SQL) && !/\$2/.test(core.TRACK_SQL), "and takes the code as a parameter (never put into the text)");
  R.ck(core.TRACKING_ID.test("100000") && core.TRACKING_ID.test("999999") && !core.TRACKING_ID.test("099999") && !core.TRACKING_ID.test("1000000"), "a tracking code is 100000 to 999999");

  // ---- the Cloudflare Worker
  const { createWorker } = await import(url("cloudflare", "src", "index.js"));
  const { resetTrackBrake } = await import(url("cloudflare", "src", "track.js"));
  const db = makeSql(workerCore);
  const worker = createWorker({ makeSql: () => db.sql });
  const workerCall = async (host, id, { method = "GET", ip = "1.1.1.1" } = {}) => {
    const response = await worker.fetch(new Request(`https://${host}/api/orders${id === "" ? "" : "/" + id}`, { method, headers: { "CF-Connecting-IP": ip } }), {}, {});
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  await scenarios("Cloudflare Worker", workerCall, { resetBrake: resetTrackBrake });
  const expired = await workerCall("old.example.com", "555666");
  R.ck(expired.status === 403 && expired.body?.code === "LICENSE_EXPIRED", "Worker: a shop whose licence ended answers 403 LICENSE_EXPIRED");
  const escape = await workerCall("a.example.com", "%E0");
  R.ck(escape.status === 400, "Worker: an invalid percent-escape in the address is 400");
  db.state.statements.length = 0;
  db.state.transactions = 0;
  await workerCall("a.example.com", "482915");
  R.ck(db.state.transactions === 1, "Worker: one request to Neon finds the order, its lines and the shop (the tenant is set and the order read in one transaction)", String(db.state.transactions));

  // ---- the Express backend
  const express = (await import(url("backend", "node_modules", "express", "index.js")).catch(() => import("express"))).default;
  const { createTrackRouter } = await import(url("backend", "src", "lib", "trackApi.js"));
  const brake = core.createMissBrake();
  const app = express();
  app.set("trust proxy", true); // (so the tests can choose the address with X-Forwarded-For)
  app.use("/api/orders", createTrackRouter({ brake, findTrackedOrder: async (host, code) => {
    if (typeof code !== "number") throw new Error("the code must be a number");
    const shop = SHOPS[host];
    return shop ? trackRow(shop.key, code) : null;
  } }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  // (node:http, not fetch: fetch does not let a request choose its Host header)
  const backendCall = (host, id, { method = "GET", ip = "1.1.1.1" } = {}) =>
    new Promise((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port, method, path: `/api/orders${id === "" ? "" : "/" + id}`, headers: { host, "x-forwarded-for": ip } }, (response) => {
        let raw = "";
        response.on("data", (c) => (raw += c));
        response.on("end", () => {
          let body = null;
          try { body = JSON.parse(raw); } catch { /* not JSON */ }
          resolve({ status: response.statusCode, body, headers: { get: (name) => response.headers[name.toLowerCase()] ?? null } });
        });
      });
      request.on("error", reject);
      request.end();
    });
  await scenarios("Express backend", backendCall, { resetBrake: () => brake.reset() });

  R.section("the brake over time");
  let clock = 1_000_000;
  const timed = core.createMissBrake({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) timed.recordMiss("ip", clock);
  R.ck(timed.blockedForMs("ip", clock) === 1000 && timed.blockedForMs("ip", clock + 600) === 400, "after the limit an address waits until its window ends");
  R.ck(timed.blockedForMs("ip", clock + 1001) === 0, "and may ask again once the window has passed");
  timed.recordMiss("ip", clock + 2000);
  R.ck(timed.blockedForMs("ip", clock + 2000) === 0, "a new window starts counting from one");
  await new Promise((resolve) => server.close(resolve));

  // ---- create_tenant(): the read-only login
  R.section("create_tenant()");
  const fn = fs.readFileSync(path.join(ROOT, "backend", "prisma", "create_tenant.sql"), "utf8");
  const tables = /v_read_tables constant text\[\] := ARRAY\[([^\]]*)\]/.exec(fn)?.[1].replace(/'/g, "").split(",").map((s) => s.trim());
  R.ck(JSON.stringify(tables) === JSON.stringify(["orders", "order_items", "payments"]), "the read-only login reads orders, order_items and payments, nothing else", JSON.stringify(tables));
  R.ck(/GRANT SELECT ON %I TO %I', v_read_table, v_ro/.test(fn) && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*\bv_ro\b/.test(fn), "and has SELECT only on them: no insert, update or delete is granted to it");
  R.ck(/CREATE POLICY %I ON %I FOR SELECT TO %I USING \(tenant_key = %L\)', 'tenant_ro_select_' \|\| v_ro, v_read_table, v_ro, v_key/.test(fn), "each table has a policy FOR SELECT only, limited to the shop's own rows (tenant_key = its key)");

  // ---- the real server file mounts it, behind the licence gate
  const serverSource = fs.readFileSync(path.join(ROOT, "backend", "src", "server.js"), "utf8");
  R.section("server.js");
  R.ck(/'\/api\/infos', '\/api\/orders'\]/.test(serverSource), "the licence gate covers /api/orders (a shop whose licence ended shows nothing)");
  R.ck(serverSource.indexOf("createTrackRouter({") > 0 && serverSource.indexOf("createTrackRouter({") < serverSource.indexOf("app.use(express.static(publicDir))"), "the router is mounted before the static files");
  const indexSource = fs.readFileSync(path.join(ROOT, "cloudflare", "src", "index.js"), "utf8");
  R.ck(/case 'orders':/.test(indexSource), "the Worker routes /api/orders");
  process.exit(R.done());
})();
