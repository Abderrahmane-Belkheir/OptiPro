// POST /api/infos, on the Cloudflare Worker and on the Express backend (both with an in-memory stand-in for the database): a shop whose licence is running sends
// its information, only the fields that have a value update its tenants row (null and empty ones are ignored: nothing is cleared), the key / host / expiry are
// never touched, every refusal changes nothing, and GET /api/infos (the website's public information, the same address) keeps working. The SQL itself is not run
// here (no Postgres): the stand-in reads the same statements the servers send.
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const url = (...parts) => pathToFileURL(path.join(ROOT, ...parts)).href;
const today = new Date().toISOString().slice(0, 10);
const shift = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

const shop = (key, host, expiry, over = {}) => ({ key, name: `Shop ${key}`, host, phone: "0550 00 00 00", email: "old@example.com", address: "Old street", instagram_url: "https://instagram.com/old", tiktok_url: null, expiry, ...over });

/** The tenants table, in memory. `refuseWrites` makes the database refuse every update silently (a row-level-security policy that does not let the shop update its row). */
function makeDatabase() {
  const tenants = new Map([
    ["activekey", shop("activekey", "active.example.com", shift(30))],
    ["todaykey", shop("todaykey", "today.example.com", today)],
    ["expiredkey", shop("expiredkey", "expired.example.com", shift(-1))],
    ["newkey", shop("newkey", "new.example.com", null)],
    ["otherkey", shop("otherkey", "other.example.com", shift(5), { name: "Other shop", phone: "0661" })],
  ]);
  const state = { refuseWrites: false, updates: [] };
  async function query(text, params = []) {
    if (/^SELECT key, expiry FROM tenants WHERE key = \$1 AND expiry IS NOT NULL AND expiry::date >= /.test(text)) {
      const t = tenants.get(params[0]);
      return t && t.expiry !== null && t.expiry >= today ? [{ key: t.key, expiry: t.expiry }] : [];
    }
    if (/^SELECT 1 AS expired FROM tenants WHERE host = \$1 AND expiry IS NOT NULL AND expiry::date < /.test(text)) {
      const t = [...tenants.values()].find((x) => x.host === params[0]);
      return t && t.expiry !== null && t.expiry < today ? [{ expired: 1 }] : [];
    }
    if (/^SELECT name, instagram_url, tiktok_url, address, phone, email FROM tenants WHERE host = \$1$/.test(text)) {
      const t = [...tenants.values()].find((x) => x.host === params[0]);
      return t ? [{ name: t.name, instagram_url: t.instagram_url, tiktok_url: t.tiktok_url, address: t.address, phone: t.phone, email: t.email }] : [];
    }
    if (/^UPDATE tenants SET /.test(text)) {
      const m = /^UPDATE tenants SET (.*) WHERE key = \$1 AND expiry IS NOT NULL AND expiry::date >= \(now\(\) AT TIME ZONE 'UTC'\)::date RETURNING key, name, phone, email, address, instagram_url, tiktok_url$/.exec(text);
      if (!m) throw new Error("unexpected UPDATE: " + text);
      const sets = [...m[1].matchAll(/(\w+) = \$(\d+)/g)].map((x) => [x[1], params[Number(x[2]) - 1]]);
      for (const [column, value] of sets) {
        if (["key", "host", "expiry"].includes(column)) throw new Error(`the ${column} must never be updated by /api/infos`);
        if (value === null || value === undefined || value === "") throw new Error(`an empty value was sent to the database for ${column}`);
      }
      state.updates.push(sets.map(([c]) => c));
      const t = tenants.get(params[0]);
      if (state.refuseWrites || !t || t.expiry === null || t.expiry < today) return [];
      for (const [column, value] of sets) t[column] = value;
      return [{ key: t.key, name: t.name, phone: t.phone, email: t.email, address: t.address, instagram_url: t.instagram_url, tiktok_url: t.tiktok_url }];
    }
    throw new Error("unexpected statement: " + text);
  }
  return { tenants, query, state };
}

/** The same scenarios against any server: call(key, body, { method, rawBody }) -> { status, body, headers }. */
async function scenarios(label, call, db) {
  R.section(label);
  const code = async (key, body, options) => {
    const r = await call(key, body, options);
    return `${r.status} ${r.body?.code ?? ""}`.trim();
  };
  const snapshot = () => JSON.stringify([...db.tenants.entries()]);

  // the key
  const before = snapshot();
  const unknown = await call("nosuchkey", { phone: "0550 11 22 33" });
  const expired = await call("expiredkey", { phone: "0550 11 22 33" });
  const never = await call("newkey", { phone: "0550 11 22 33" });
  R.ck(unknown.status === 401 && unknown.body.code === "UNAUTHORIZED", "a key that does not exist: 401 UNAUTHORIZED");
  R.ck(expired.status === 401 && expired.body.code === "UNAUTHORIZED", "an expired key: 401 UNAUTHORIZED");
  R.ck(never.status === 401 && never.body.code === "UNAUTHORIZED", "a shop that never registered (no expiry): 401 UNAUTHORIZED (it registers first)");
  R.ck(JSON.stringify(unknown.body) === JSON.stringify(expired.body) && JSON.stringify(unknown.body) === JSON.stringify(never.body), "and the answer is the same for all of them");
  R.ck((await code(null, { phone: "0550 11 22 33" })) === "401 UNAUTHORIZED", "no Authorization header: 401 UNAUTHORIZED");
  R.ck((await code("bad key!", { phone: "0550 11 22 33" })) === "401 UNAUTHORIZED" && (await code("x".repeat(200), { phone: "0550 11 22 33" })) === "401 UNAUTHORIZED", "a key in the wrong format: 401 UNAUTHORIZED");
  R.ck((await code("expiredkey", "not an object")) === "401 UNAUTHORIZED" && (await code("nosuchkey", { bogus: 1 })) === "401 UNAUTHORIZED", "the key is checked before the body");
  R.ck(snapshot() === before, "and a refused key changes nothing");

  // the body
  R.ck((await code("activekey", null, { rawBody: "{not json" })) === "400 BODY_NOT_JSON", "a body that is not JSON: 400 BODY_NOT_JSON");
  R.ck((await code("activekey", ["a"])) === "400 INVALID_BODY" && (await code("activekey", null)) === "400 INVALID_BODY" && (await code("activekey", "text")) === "400 INVALID_BODY", "a body that is not an object: 400 INVALID_BODY");
  for (const field of ["host", "key", "expiry", "id", "tenant_key"]) {
    R.ck((await code("activekey", { phone: "0550 11 22 33", [field]: "x" })) === "400 UNKNOWN_FIELD", `"${field}" is not accepted at all: 400 UNKNOWN_FIELD`);
  }
  for (const [what, body] of [
    ["an e-mail without @", { email: "nope" }],
    ["a phone with letters", { phone: "call me" }],
    ["an Instagram address that is not http(s)", { instagramUrl: "javascript:alert(1)" }],
    ["a TikTok address that is not an address", { tiktokUrl: "tiktok" }],
    ["a name that is too long", { name: "x".repeat(121) }],
    ["an address that is too long", { address: "x".repeat(301) }],
    ["a number as phone", { phone: 5 }],
    ["an object as address", { address: { a: 1 } }],
    ["a bad value next to a good one", { phone: "0550 11 22 33", email: "nope" }],
  ]) {
    R.ck((await code("activekey", body)) === "400 INVALID_FIELD", `${what}: 400 INVALID_FIELD`);
  }
  for (const [what, body] of [["an empty object", {}], ["only null values", { phone: null, email: null, address: null }], ["only empty texts", { name: "", phone: "  ", address: "" }]]) {
    R.ck((await code("activekey", body)) === "400 NOTHING_TO_UPDATE", `${what}: 400 NOTHING_TO_UPDATE`);
  }
  R.ck(snapshot() === before, "and a body that is refused changes nothing (and nothing was sent to the database)");
  R.ck(db.state.updates.length === 0, "(no UPDATE reached the database)");

  // the update: only what has a value
  const part = await call("activekey", { phone: "0661 11 22 33", email: null, address: "", name: "   " });
  const row = db.tenants.get("activekey");
  R.ck(part.status === 200 && part.body.updated === true, "a valid request: 200 { updated: true }", JSON.stringify(part.body).slice(0, 140));
  R.ck(row.phone === "0661 11 22 33", "the field with a value is updated");
  R.ck(row.email === "old@example.com" && row.address === "Old street" && row.name === "Shop activekey", "and the null, the empty and the blank ones are ignored: nothing is cleared");
  R.ck(JSON.stringify(part.body.fields) === JSON.stringify(["phone"]) && part.body.tenant.phone === "0661 11 22 33" && part.body.tenant.email === "old@example.com", "the answer says which fields were updated, and holds the shop as stored");
  R.ck(JSON.stringify(db.state.updates.at(-1)) === JSON.stringify(["phone"]), "the database was sent only the phone column");

  const full = await call("activekey", { name: "  Maison Clair ", phone: "+213 550 00 00 00", email: "hello@maison-clair.example.com", address: "12 Rue Didouche Mourad, Algiers", instagramUrl: "https://instagram.com/maisonclair", tiktokUrl: "https://tiktok.com/@maisonclair" });
  R.ck(full.status === 200 && JSON.stringify(full.body.fields) === JSON.stringify(["name", "phone", "email", "address", "instagramUrl", "tiktokUrl"]), "every field can be updated at once", JSON.stringify(full.body.fields));
  R.ck(row.name === "Maison Clair" && row.email === "hello@maison-clair.example.com" && row.instagram_url === "https://instagram.com/maisonclair" && row.tiktok_url === "https://tiktok.com/@maisonclair", "the row holds them, the name trimmed");
  R.ck(row.host === "active.example.com" && row.key === "activekey" && row.expiry === shift(30), "the host, the key and the expiry are untouched");
  R.ck(db.tenants.get("otherkey").name === "Other shop" && db.tenants.get("otherkey").phone === "0661", "and another shop's row is untouched");
  R.ck((await code("todaykey", { phone: "0550 99 99 99" })) === "200" && db.tenants.get("todaykey").phone === "0550 99 99 99", "a licence that ends today is still running: accepted");

  // a database that refuses the write is not a refused key
  db.state.refuseWrites = true;
  const refused = await call("activekey", { phone: "0550 12 12 12" });
  R.ck(refused.status === 500 && refused.body.code === "NOT_UPDATED" && refused.body.retry === "same-request", "when the database refuses the write the answer is 500 NOT_UPDATED, not 401 (the key is fine: the app must not read it as a refusal)", JSON.stringify(refused.body));
  db.state.refuseWrites = false;
  R.ck(row.phone === "+213 550 00 00 00", "and nothing changed");
}

(async () => {
  // ---- the pure rules
  const core = await import(url("backend", "src", "lib", "infosCore.js"));
  R.section("infosCore");
  const copy = fs.readFileSync(path.join(ROOT, "cloudflare", "src", "infosCore.js"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "backend", "src", "lib", "infosCore.js"), "utf8");
  R.ck(copy.replace(/^\/\/ COPY[^\n]*\n/, "").replace(/\r/g, "") === source.replace(/\r/g, ""), "the Worker's infosCore.js is an exact copy of the backend's");
  const ok = core.validateInfosBody({ phone: "0550 11 22 33", email: null, name: "" });
  R.ck(JSON.stringify(ok.values) === JSON.stringify({ phone: "0550 11 22 33" }), "validateInfosBody keeps only the fields that have a value", JSON.stringify(ok));
  R.ck(!("host" in (core.validateInfosBody({ name: "A" }).values)) && core.validateInfosBody({ host: "x.example.com" }).failure?.body.code === "UNKNOWN_FIELD", "it never produces a host column, and refuses a host in the body");
  const update = core.buildInfosUpdate("k", { name: "A", phone: "0550 00 00 00" });
  R.ck(update.text === "UPDATE tenants SET name = $2, phone = $3 WHERE key = $1 AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE 'UTC')::date RETURNING key, name, phone, email, address, instagram_url, tiktok_url" && JSON.stringify(update.params) === JSON.stringify(["k", "A", "0550 00 00 00"]), "the UPDATE sets those columns only, for a running licence, and never the expiry", update.text);

  // ---- the Cloudflare Worker
  const { createWorker } = await import(url("cloudflare", "src", "index.js"));
  const { resetFailures } = await import(url("cloudflare", "src", "auth.js"));
  const workerDb = makeDatabase();
  const worker = createWorker({ makeSql: () => ({ query: workerDb.query }) });
  const workerCall = async (key, body, { method = "POST", rawBody, host = "shop.example.com" } = {}) => {
    resetFailures();
    const headers = { "content-type": "application/json" };
    if (key !== null) headers.authorization = `Bearer ${key}`;
    const response = await worker.fetch(new Request(`https://${host}/api/infos`, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : (rawBody ?? JSON.stringify(body)) }), {}, {});
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  await scenarios("Cloudflare Worker", workerCall, workerDb);
  const put = await workerCall("activekey", { phone: "0550 11 22 33" }, { method: "PUT" });
  R.ck(put.status === 405 && /POST/.test(put.headers.get("allow") ?? ""), "Worker: PUT /api/infos is 405, and Allow names POST", put.headers.get("allow"));
  const publicInfo = await workerCall(null, null, { method: "GET", host: "active.example.com" });
  R.ck(publicInfo.status === 200 && publicInfo.body?.name === "Maison Clair", "Worker: GET /api/infos (the website's public information) still works at the same address, and shows what was updated", JSON.stringify(publicInfo.body).slice(0, 100));

  // ---- the Express backend
  const express = (await import(url("backend", "node_modules", "express", "index.js")).catch(() => import("express"))).default;
  const { createInfosRouter } = await import(url("backend", "src", "lib", "infosApi.js"));
  const backendDb = makeDatabase();
  const app = express();
  app.use("/api/infos", createInfosRouter({ findActiveTenant: async (key) => (await backendDb.query("SELECT key, expiry FROM tenants WHERE key = $1 AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE 'UTC')::date", [key]))[0] ?? null, query: backendDb.query }));
  app.get("/api/infos", (_req, res) => res.json({ public: "the website's shop information" })); // (server.js answers GET /api/infos after the router)
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const backendCall = async (key, body, { method = "POST", rawBody } = {}) => {
    const headers = { "content-type": "application/json", host: "shop.example.com" };
    if (key !== null) headers.authorization = `Bearer ${key}`;
    const response = await fetch(`http://127.0.0.1:${port}/api/infos`, { method, headers, body: method === "GET" ? undefined : (rawBody ?? JSON.stringify(body)) });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  await scenarios("Express backend", backendCall, backendDb);
  const put2 = await backendCall("activekey", null, { method: "PUT" });
  R.ck(put2.status === 405 && /POST/.test(put2.headers.get("allow") ?? ""), "Express: PUT /api/infos is 405, and Allow names POST", put2.headers.get("allow"));
  const get2 = await backendCall(null, null, { method: "GET" });
  R.ck(get2.status === 200 && get2.body?.public === "the website's shop information", "Express: GET /api/infos still reaches the website's handler (the router lets it through)", JSON.stringify(get2.body));
  await new Promise((resolve) => server.close(resolve));

  // ---- the real server file mounts it before the website's GET handler
  const serverSource = fs.readFileSync(path.join(ROOT, "backend", "src", "server.js"), "utf8");
  R.section("server.js");
  const mount = serverSource.indexOf("createInfosRouter({");
  const read = serverSource.indexOf("app.get('/api/infos'");
  R.ck(mount > 0 && read > mount, "the update router is mounted before the website's GET /api/infos");
  process.exit(R.done());
})();
