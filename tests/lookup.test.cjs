// POST /api/orders/lookup: a customer's orders found with the customer's full name and year of birth, on the Cloudflare Worker and on the Express backend (both with an in-memory stand-in
// for the database). Public, no key, the shop is the request's host. Each order comes with its lines, the sum of its payments and its total, and NEVER the prescription, the measurements,
// the notes, the customer's details, the list of payments or what the lines cost the shop. Guesses at customers that do not exist are slowed down per address.
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const url = (...parts) => pathToFileURL(path.join(ROOT, ...parts)).href;
const today = new Date().toISOString().slice(0, 10);
const shift = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const THIS_YEAR = new Date().getUTCFullYear();

const SHOPS = {
  "a.example.com": { key: "keyA", expiry: shift(30) },
  "b.example.com": { key: "keyB", expiry: shift(5) },
  "old.example.com": { key: "keyOld", expiry: shift(-1) },
};
const CUSTOMERS = [
  { id: "c1", tenant: "keyA", name: "Amina Benali", year: 1985 },
  { id: "c2", tenant: "keyA", name: "Amina  Benali ", year: 1990 }, // the same name, another person
  { id: "c3", tenant: "keyA", name: "Karim Haddad", year: 1970 }, // no order
  { id: "c4", tenant: "keyB", name: "Amina Benali", year: 1985 }, // another shop
  { id: "c5", tenant: "keyOld", name: "Old Customer", year: 1980 },
  { id: "c6", tenant: "keyA", name: "Amina Benali", year: 1985 }, // a second record of the same person
];
const line = (kind, description, eye, quantity, unit) => ({ kind, description, eye, quantity, unitPriceCents: unit, totalCents: unit * quantity });
const ORDERS = [
  { customer: "c1", tenant: "keyA", number: "CMD-2026-0042", status: "ready", ordered_at: new Date("2026-10-01T09:00:00Z"), promised_at: new Date("2026-10-10T00:00:00Z"), delivered_at: null, subtotal_cents: 3300000, discount_cents: 100000, total_cents: 3200000, paid: [1000000, 500000],
    items: [line("frame", "Ray-Ban Aviator", null, 1, 1850000), line("lens", "Essilor Progressive 1.6", "both", 1, 1450000)] },
  { customer: "c1", tenant: "keyA", number: "CMD-2026-0043", status: "cancelled", ordered_at: new Date("2026-10-02T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 500000, discount_cents: 0, total_cents: 500000, paid: [200000], items: [] },
  { customer: "c6", tenant: "keyA", number: "CMD-2026-0044", status: "delivered", ordered_at: new Date("2026-09-01T09:00:00Z"), promised_at: null, delivered_at: new Date("2026-09-04T10:00:00Z"), subtotal_cents: 120000, discount_cents: 0, total_cents: 120000, paid: [120000],
    items: [line("accessory", "Hard case", "", 2, 60000)] },
  { customer: "c2", tenant: "keyA", number: "CMD-2026-0045", status: "confirmed", ordered_at: new Date("2026-10-05T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 900000, discount_cents: 0, total_cents: 900000, paid: [], items: [line("frame", "Oakley", null, 1, 900000)] },
  { customer: "c4", tenant: "keyB", number: "CMD-2026-0001", status: "confirmed", ordered_at: new Date("2026-10-03T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 100000, discount_cents: 0, total_cents: 100000, paid: [150000], items: [] },
  { customer: "c5", tenant: "keyOld", number: "CMD-2025-0009", status: "ready", ordered_at: new Date("2025-01-01T09:00:00Z"), promised_at: null, delivered_at: null, subtotal_cents: 1, discount_cents: 0, total_cents: 1, paid: [], items: [] },
];
const sameName = (a, b) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** The rows LOOKUP_SQL gives for the shop (by key), the full name and the year. */
function lookupRows(tenantKey, name, year) {
  const rows = [];
  for (const customer of CUSTOMERS.filter((c) => c.tenant === tenantKey && c.year === year && sameName(c.name, name))) {
    const orders = ORDERS.filter((o) => o.customer === customer.id);
    if (orders.length === 0) rows.push({ number: null });
    for (const o of orders) {
      rows.push({ number: o.number, status: o.status, ordered_at: o.ordered_at, promised_at: o.promised_at, delivered_at: o.delivered_at, subtotal_cents: o.subtotal_cents, discount_cents: o.discount_cents, total_cents: o.total_cents, paid_cents: String(o.paid.reduce((a, b) => a + b, 0)), items: JSON.stringify(o.items) });
    }
  }
  return rows.sort((a, b) => (b.ordered_at?.getTime() ?? 0) - (a.ordered_at?.getTime() ?? 0));
}

function makeSql(core) {
  const state = { tenant: "", transactions: 0, lookups: [] };
  const exec = async (text, params = []) => {
    if (/^SELECT set_config\('app\.tenant_key'/.test(text)) {
      state.tenant = SHOPS[params[0]]?.key ?? "";
      return [{ set_config: state.tenant }];
    }
    if (/^SELECT 1 AS expired FROM tenants WHERE host = \$1 AND expiry IS NOT NULL AND expiry::date < /.test(text)) {
      const shop = SHOPS[params[0]];
      return shop && shop.expiry < today ? [{ expired: 1 }] : [];
    }
    if (text === core.LOOKUP_SQL) {
      state.lookups.push(params);
      if (typeof params[0] !== "string" || typeof params[1] !== "number") throw new Error("the name is sent as text and the year as a number");
      return lookupRows(state.tenant, params[0], params[1]);
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

const SENSITIVE = /prescription|unit_cost|\bcost|\bnotes?\b|\bpd_|fitting|customer|payment|measure|synced|phone|email|address|birth/i;
const deepKeys = (value, keys = new Set()) => {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, keys));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { keys.add(k); deepKeys(v, keys); }
  return keys;
};

/** The same scenarios against any server: call(host, body, { ip, method, raw }) -> { status, body, headers }. */
async function scenarios(label, call, { resetBrake }) {
  R.section(label);
  resetBrake();
  const ask = (name, yearOfBirth, host = "a.example.com", extra = {}) => call(host, { name, yearOfBirth }, extra);

  const amina = await ask("Amina Benali", 1985);
  const orders = amina.body?.orders ?? [];
  R.ck(amina.status === 200 && orders.length === 3, "the full name and the year find the orders of every record of that person (3: two of one record, one of the other)", JSON.stringify(orders.map((o) => o.number)));
  R.ck(orders.map((o) => o.number).join() === "CMD-2026-0043,CMD-2026-0042,CMD-2026-0044", "newest first", orders.map((o) => o.number).join());
  const first = orders.find((o) => o.number === "CMD-2026-0042");
  R.ck(first?.status === "ready" && first.currency === "DZD" && first.subtotalCents === 3300000 && first.discountCents === 100000 && first.totalCents === 3200000, "an order: status, currency, subtotal, discount and total price in centimes");
  R.ck(first?.paidCents === 1500000 && first.remainingCents === 1700000 && typeof first.paidCents === "number", "the total of the payments received (10 000 + 5 000) and what is left, as numbers", JSON.stringify([first?.paidCents, first?.remainingCents]));
  R.ck(first?.orderedAt === "2026-10-01T09:00:00.000Z" && first.promisedAt === "2026-10-10T00:00:00.000Z" && first.deliveredAt === null, "dates as ISO text (null when there is none)");
  R.ck(first?.items?.length === 2 && first.items[0].description === "Ray-Ban Aviator" && first.items[0].eye === null && first.items[1].eye === "both" && first.items[1].unitPriceCents === 1450000, "each order has its lines: what, which eye, quantity, price");
  R.ck(JSON.stringify(Object.keys(first.items[0]).sort()) === JSON.stringify(["description", "eye", "kind", "quantity", "totalCents", "unitPriceCents"]), "a line holds exactly those fields", Object.keys(first.items[0]).join());
  const cancelled = orders.find((o) => o.number === "CMD-2026-0043");
  R.ck(cancelled?.status === "cancelled" && cancelled.paidCents === 200000 && cancelled.remainingCents === 0 && cancelled.items.length === 0, "a cancelled order is listed, shows what was paid and owes nothing");
  const delivered = orders.find((o) => o.number === "CMD-2026-0044");
  R.ck(delivered?.remainingCents === 0 && delivered.items[0].eye === null && delivered.items[0].quantity === 2 && delivered.deliveredAt === "2026-09-04T10:00:00.000Z", "a delivered order paid in full: nothing left, delivered date shown");
  const leaked = [...deepKeys(amina.body)].filter((k) => SENSITIVE.test(k));
  R.ck(leaked.length === 0, "nothing private goes out: no prescription, measurements, notes, customer details, payments list, cost", leaked.join());
  R.ck(/no-store/.test(amina.headers.get("cache-control") ?? ""), "the answer is never cached (no-store)", amina.headers.get("cache-control"));

  R.section(`${label}: who is found`);
  const other = await ask("amina   BENALI ", 1990);
  R.ck(other.status === 200 && other.body?.orders?.map((o) => o.number).join() === "CMD-2026-0045" && other.body.orders[0].paidCents === 0 && other.body.orders[0].remainingCents === 900000, "capital letters and extra spaces do not matter; another year is another person (unpaid order: paid 0, all left)", JSON.stringify(other.body)?.slice(0, 120));
  const none = await ask("Karim Haddad", 1970);
  R.ck(none.status === 200 && Array.isArray(none.body?.orders) && none.body.orders.length === 0, "a customer with no order gets an empty list");
  const stringYear = await ask("Karim Haddad", "1970");
  R.ck(stringYear.status === 200, "the year may come as digits in a text");
  const wrongYear = await ask("Amina Benali", 1986);
  const wrongName = await ask("Amina Benalo", 1985);
  const unknownHost = await ask("Amina Benali", 1985, "nobody.example.com");
  R.ck([wrongYear, wrongName, unknownHost].every((r) => r.status === 404 && r.body?.code === "CUSTOMER_NOT_FOUND") && JSON.stringify(wrongYear.body) === JSON.stringify(wrongName.body) && JSON.stringify(wrongName.body) === JSON.stringify(unknownHost.body), "a wrong year, a wrong name or an unknown shop: 404 CUSTOMER_NOT_FOUND, the same answer for any reason");
  const shopB = await ask("Amina Benali", 1985, "b.example.com");
  R.ck(shopB.status === 200 && shopB.body?.orders?.map((o) => o.number).join() === "CMD-2026-0001" && shopB.body.orders[0].remainingCents === 0, "the shop is the host: the same name and year at another shop find that shop's orders (paid more than the total: nothing left, never negative)");
  R.ck((await ask("Old Customer", 1980, "b.example.com")).status === 404, "a customer of one shop is not found at another shop's address");

  R.section(`${label}: what is refused`);
  for (const [why, body] of [["no name", { yearOfBirth: 1985 }], ["a name that is not text", { name: 5, yearOfBirth: 1985 }], ["a one-letter name", { name: "A", yearOfBirth: 1985 }], ["a name of spaces", { name: "   ", yearOfBirth: 1985 }], ["a name that is too long", { name: "x".repeat(201), yearOfBirth: 1985 }]]) {
    const r = await call("a.example.com", body);
    R.ck(r.status === 400 && r.body?.code === "INVALID_NAME", `${why}: 400 INVALID_NAME`, String(r.status));
  }
  for (const year of [undefined, null, 1920, THIS_YEAR, THIS_YEAR + 1, 85, 1985.5, "abc", "19850", true, []]) {
    const r = await call("a.example.com", { name: "Amina Benali", yearOfBirth: year });
    R.ck(r.status === 400 && r.body?.code === "INVALID_YEAR_OF_BIRTH", `year ${JSON.stringify(year)}: 400 INVALID_YEAR_OF_BIRTH`, String(r.status));
  }
  R.ck((await ask("Karim Haddad", THIS_YEAR - 1)).status === 404 && (await ask("Karim Haddad", 1921)).status === 404, "the first and the last year allowed are asked, not refused");
  for (const raw of ['"just text"', "[1,2]", "null", "42"]) {
    const r = await call("a.example.com", undefined, { raw });
    R.ck(r.status === 400 && r.body?.code === "BODY_NOT_AN_OBJECT", `the body ${raw} is not an object: 400 BODY_NOT_AN_OBJECT`, `${r.status} ${r.body?.code}`);
  }
  const broken = await call("a.example.com", undefined, { raw: "{not json" });
  R.ck(broken.status === 400 && broken.body?.code === "BODY_NOT_JSON", "a body that is not JSON: 400 BODY_NOT_JSON", `${broken.status} ${broken.body?.code}`);
  const huge = await call("a.example.com", undefined, { raw: JSON.stringify({ name: "x".repeat(5000), yearOfBirth: 1985 }) });
  R.ck(huge.status === 413, "a big body is refused", String(huge.status));
  const get = await call("a.example.com", undefined, { method: "GET" });
  R.ck(get.status === 405 && /POST/.test(get.headers.get("allow") ?? ""), "GET is 405 and Allow names POST", `${get.status} ${get.headers.get("allow")}`);

  R.section(`${label}: the brake`);
  resetBrake();
  for (let i = 0; i < 20; i++) await ask("Nobody Here" + i, 1980, "a.example.com", { ip: "9.9.9.9" });
  const blocked = await ask("Amina Benali", 1985, "a.example.com", { ip: "9.9.9.9" });
  R.ck(blocked.status === 429 && blocked.body?.code === "TOO_MANY_ATTEMPTS" && Number(blocked.headers.get("retry-after")) > 0, "after 20 asks that matched no customer the address is refused, even for a good one (429 with Retry-After)", `${blocked.status} ${blocked.headers.get("retry-after")}`);
  R.ck((await ask("Amina Benali", 1985, "a.example.com", { ip: "8.8.8.8" })).status === 200, "another address is not affected");
  resetBrake();
  R.ck((await ask("Amina Benali", 1985, "a.example.com", { ip: "9.9.9.9" })).status === 200, "(the count starts again once the window has passed)");
  resetBrake();
  for (let i = 0; i < 25; i++) await ask("Amina Benali", 1985, "a.example.com", { ip: "7.7.7.7" });
  R.ck((await ask("Amina Benali", 1985, "a.example.com", { ip: "7.7.7.7" })).status === 200, "customers that exist are never counted: any number of good asks is answered");
}

(async () => {
  const core = await import(url("backend", "src", "lib", "lookupCore.js"));
  const workerCore = await import(url("cloudflare", "src", "lookupCore.js"));

  R.section("the shared file");
  R.ck(core.LOOKUP_SQL === workerCore.LOOKUP_SQL && core.MAX_LOOKUP_BODY_BYTES === workerCore.MAX_LOOKUP_BODY_BYTES, "the Worker's copy of the shared file is the same as the backend's");
  const sql = core.LOOKUP_SQL;
  const readColumns = [...new Set([...sql.matchAll(/\b([cpio])\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`))].sort().join();
  R.ck(!/\bp\.(?!amount_cents|order_id|tenant_key)/.test(sql) && /sum\(p\.amount_cents\)/.test(sql), "of the payments it reads only the amount (added up), the order and the shop", readColumns);
  R.ck(!/\bc\.(?!id\b|tenant_key|year_of_birth|name)/.test(sql), "of the customer it uses only the id, the shop, the name and the year, to find them", readColumns);
  R.ck(/c\.tenant_key = current_setting\('app\.tenant_key'\)/.test(sql) && /i\.tenant_key = o\.tenant_key/.test(sql) && /o\.tenant_key = c\.tenant_key/.test(sql), "it filters on the shop's key itself, for the customer, the orders and the lines");
  R.ck(/\$1/.test(sql) && /\$2/.test(sql) && !/\$3/.test(sql), "and takes the name and the year as parameters (never put into the text)");
  const outSelect = sql.split("FROM customers")[0];
  R.ck(!SENSITIVE.test(outSelect.replace(/\bpayments\b/g, "").replace(/customer_id/g, "")), "the SELECT lists none of the private columns", (SENSITIVE.exec(outSelect.replace(/\bpayments\b/g, "")) ?? [])[0]);

  // ---- the Cloudflare Worker
  const { createWorker } = await import(url("cloudflare", "src", "index.js"));
  const { resetLookupBrake } = await import(url("cloudflare", "src", "lookup.js"));
  const db = makeSql(workerCore);
  const worker = createWorker({ makeSql: () => db.sql });
  const workerCall = async (host, body, { method = "POST", ip = "1.1.1.1", raw } = {}) => {
    const init = { method, headers: { "CF-Connecting-IP": ip, "Content-Type": "application/json" } };
    if (method !== "GET") init.body = raw ?? JSON.stringify(body);
    const response = await worker.fetch(new Request(`https://${host}/api/orders/lookup`, init), {}, {});
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  await scenarios("Cloudflare Worker", workerCall, { resetBrake: resetLookupBrake });
  const expired = await workerCall("old.example.com", { name: "Old Customer", yearOfBirth: 1980 });
  R.ck(expired.status === 403 && expired.body?.code === "LICENSE_EXPIRED", "Worker: a shop whose licence ended answers 403 LICENSE_EXPIRED");
  db.state.transactions = 0;
  db.state.lookups.length = 0;
  await workerCall("a.example.com", { name: "  Amina   Benali ", yearOfBirth: 1985 });
  R.ck(db.state.transactions === 1 && db.state.lookups[0]?.[0] === "Amina Benali" && db.state.lookups[0]?.[1] === 1985, "Worker: one request to Neon finds the customer, the orders and the lines, with the name cleaned of extra spaces", JSON.stringify(db.state.lookups[0]));
  const other = await worker.fetch(new Request("https://a.example.com/api/orders/lookup/extra", { method: "POST", body: "{}" }), {}, {});
  R.ck(other.status === 404, "Worker: a longer address is 404");

  // ---- the Express backend
  const express = (await import(url("backend", "node_modules", "express", "index.js")).catch(() => import("express"))).default;
  const { createLookupRouter } = await import(url("backend", "src", "lib", "lookupApi.js"));
  const brake = core.createMissBrake();
  const app = express();
  app.set("trust proxy", true); // (so the tests can choose the address with X-Forwarded-For)
  app.use("/api/orders", createLookupRouter({ brake, findCustomerOrders: async (host, name, year) => {
    if (typeof name !== "string" || typeof year !== "number") throw new Error("the name is text and the year a number");
    const shop = SHOPS[host];
    return shop ? lookupRows(shop.key, name, year) : [];
  } }));
  app.use((err, _req, res, _next) => res.status(500).json({ error: String(err.message) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const expressCall = async (host, body, { method = "POST", ip = "1.1.1.1", raw } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/orders/lookup`, { method, headers: { "Content-Type": "application/json", "X-Forwarded-Host": host, "X-Forwarded-For": ip }, ...(method === "GET" ? {} : { body: raw ?? JSON.stringify(body) }) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  try {
    await scenarios("Express backend", (host, body, extra) => expressCall(host, body, extra), { resetBrake: () => brake.reset() });
  } finally {
    server.close();
  }
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
