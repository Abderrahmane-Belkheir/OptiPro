// POST /api/register, on the Cloudflare Worker and on the Express backend (both with an in-memory stand-in for the database): a shop registers (the key's
// format, existence and a licence that is not expired: one 401 UNAUTHORIZED for all of them), the body's checks, the update of the tenants row, the expiry set
// an empty expiry set to today + 15 days (an expiry that is set is kept) and sent back, and which other endpoints look at the expiry. The SQL itself is not run here (no Postgres): the stand-in reads the same statements the servers send.
const path = require("node:path");
const http = require("node:http");
const { pathToFileURL } = require("node:url");
const { recorder, ROOT } = require("./helpers/app.cjs");

const R = recorder();
const url = (...parts) => pathToFileURL(path.join(ROOT, ...parts)).href;
const today = new Date().toISOString().slice(0, 10);
const shift = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

/** The tenants table, in memory. query(text, params) understands the statements the servers send. */
function makeDatabase() {
  const tenants = new Map([
    ["goodkey", { key: "goodkey", name: "Old name", host: "old.example.com", phone: "0550", email: "old@example.com", address: "Old street", instagram_url: "https://instagram.com/old", tiktok_url: null, expiry: null }],
    ["expiredkey", { key: "expiredkey", name: "Expired", host: "expired.example.com", phone: null, email: null, address: null, instagram_url: null, tiktok_url: null, expiry: shift(-1) }],
    ["todaykey", { key: "todaykey", name: "Today", host: "today.example.com", phone: null, email: null, address: null, instagram_url: null, tiktok_url: null, expiry: today }],
    ["activekey", { key: "activekey", name: "Active", host: "active.example.com", phone: null, email: null, address: null, instagram_url: null, tiktok_url: null, expiry: shift(30) }],
    ["unregisteredkey", { key: "unregisteredkey", name: "Never registered", host: "never.example.com", phone: null, email: null, address: null, instagram_url: null, tiktok_url: null, expiry: null }],
    ["foreverkey", { key: "foreverkey", name: "Forever", host: "forever.example.com", phone: null, email: null, address: null, instagram_url: null, tiktok_url: null, expiry: null }],
    ["otherkey", { key: "otherkey", name: "Other", host: "taken.example.com", phone: null, email: null, address: null, instagram_url: null, tiktok_url: null, expiry: shift(5) }],
  ]);
  const statements = [];
  async function query(text, params = []) {
    statements.push(text);
    if (/^SELECT key, expiry FROM tenants WHERE key = \$1 AND expiry IS NOT NULL AND expiry::date >= /.test(text)) { // a shop whose licence is running
      const t = tenants.get(params[0]);
      return t && t.expiry !== null && t.expiry >= today ? [{ key: t.key, expiry: t.expiry }] : [];
    }
    if (/^SELECT 1 AS expired FROM tenants WHERE host = \$1 AND expiry IS NOT NULL AND expiry::date < /.test(text)) { // the website's gate
      const t = [...tenants.values()].find((x) => x.host === params[0]);
      return t && t.expiry !== null && t.expiry < today ? [{ expired: 1 }] : [];
    }
    if (/^SELECT name, instagram_url, tiktok_url, address, phone, email FROM tenants WHERE host = \$1$/.test(text)) { // the site info
      const t = [...tenants.values()].find((x) => x.host === params[0]);
      return t ? [{ name: t.name, instagram_url: t.instagram_url, tiktok_url: t.tiktok_url, address: t.address, phone: t.phone, email: t.email }] : [];
    }
    if (/^SELECT key FROM tenants WHERE key = \$1 AND \(expiry IS NULL OR expiry::date >= \(now\(\) AT TIME ZONE 'UTC'\)::date\)$/.test(text)) { // a shop that can register: not expired
      const t = tenants.get(params[0]);
      return t && (t.expiry === null || t.expiry >= today) ? [{ key: t.key }] : [];
    }
    if (/^SELECT key FROM tenants WHERE key = \$1$/.test(text)) { // the check that only looks at existence (the photo endpoints)
      const t = tenants.get(params[0]);
      return t ? [{ key: t.key }] : [];
    }
    if (/^UPDATE tenants SET /.test(text)) {
      if (!/, expiry = COALESCE\(expiry, \(now\(\) AT TIME ZONE 'UTC'\)::date \+ 15\) WHERE key = \$1 AND \(expiry IS NULL OR expiry::date >= \(now\(\) AT TIME ZONE 'UTC'\)::date\) RETURNING /.test(text)) throw new Error("the UPDATE must keep the expiry it has or set today + 15 when it has none, only for a licence that is not expired: " + text);
      const assignments = /^UPDATE tenants SET (.*), expiry = /.exec(text)?.[1] ?? "";
      const sets = [...assignments.matchAll(/(\w+) = \$(\d+)/g)].map((m) => [m[1], params[Number(m[2]) - 1]]);
      if (!/RETURNING key, name, host, phone, email, address, instagram_url, tiktok_url, expiry$/.test(text)) throw new Error("unexpected UPDATE: " + text);
      const t = tenants.get(params[0]);
      if (state.refuseWrites || !t || (t.expiry !== null && t.expiry < today)) return []; // no such shop, an expired one, or a database policy that refuses the write: no row
      for (const [column, value] of sets) {
        if (column === "key") throw new Error("the key must never be updated");
        if (column === "host") throw new Error("the host must never be updated by /api/register");
        if (column === "expiry") throw new Error("the expiry is only set by the COALESCE, never from the body");
      }
      for (const [column, value] of sets) t[column] = value;
      if (t.expiry === null) t.expiry = shift(15); // COALESCE(expiry, today + 15): a day that is already there is kept
      return [{ ...t }];
    }
    throw new Error("unexpected statement: " + text);
  }
  const state = { refuseWrites: false }; // true: the database refuses every update silently (a row-level-security policy that does not let the shop's login update its row)
  return { tenants, query, statements, state };
}

const GOOD = { name: "Maison Clair", phone: "+213 550 00 00 00", email: "hello@maison-clair.example.com", address: "12 Rue Didouche Mourad, Algiers", instagramUrl: "https://instagram.com/maisonclair", tiktokUrl: "https://tiktok.com/@maisonclair" };

/** The same scenarios against any server: call(key, body, { method, rawBody }) -> { status, body }. */
async function scenarios(label, call, db) {
  R.section(label);
  const code = async (key, body, options) => {
    const r = await call(key, body, options);
    return `${r.status} ${r.body?.code ?? ""}`.trim();
  };

  // the key
  const unknown = await call("nosuchkey", GOOD);
  const expired = await call("expiredkey", GOOD);
  R.ck(unknown.status === 401 && unknown.body.code === "UNAUTHORIZED", "a key that does not exist: 401 UNAUTHORIZED");
  R.ck(expired.status === 401 && expired.body.code === "UNAUTHORIZED", "an expired key: 401 UNAUTHORIZED");
  R.ck(JSON.stringify(unknown.body) === JSON.stringify(expired.body), "and the answer is the same for both (nothing tells them apart)");
  R.ck((await code(null, GOOD)) === "401 UNAUTHORIZED", "no Authorization header: 401 UNAUTHORIZED");
  R.ck((await code("bad key!", GOOD)) === "401 UNAUTHORIZED" && (await code("-startsbad", GOOD)) === "401 UNAUTHORIZED" && (await code("x".repeat(200), GOOD)) === "401 UNAUTHORIZED", "a key in the wrong format: 401 UNAUTHORIZED");
  R.ck(db.tenants.get("expiredkey").name === "Expired", "and a refused request changes nothing");
  R.ck((await code("expiredkey", "not an object")) === "401 UNAUTHORIZED" && (await code("nosuchkey", { bogus: 1 })) === "401 UNAUTHORIZED", "the key is checked before the body: an expired or unknown key with a bad body is still 401");

  // an expiry that is set is KEPT, an empty one becomes today + 15
  const registered = await call("activekey", { ...GOOD, name: "Active shop" });
  R.ck(registered.status === 200 && registered.body.registered === true && registered.body.expiry === shift(30), "a shop that already has an expiry (30 days left) registers: 200, and the answer carries ITS day, not a new one", JSON.stringify(registered.body).slice(0, 150));
  R.ck(db.tenants.get("activekey").expiry === shift(30) && db.tenants.get("activekey").name === "Active shop" && db.tenants.get("activekey").phone === GOOD.phone, "the expiry in the database is untouched, and the details were saved");
  const lastDay = await call("todaykey", { name: "Today shop" });
  R.ck(lastDay.status === 200 && lastDay.body.expiry === today && db.tenants.get("todaykey").expiry === today, "a licence that ends today still registers, and keeps its day (it is not extended)");
  const fresh = await call("foreverkey", { name: "New shop" });
  R.ck(fresh.status === 200 && fresh.body.expiry === shift(15) && db.tenants.get("foreverkey").expiry === shift(15), "a shop whose expiry is empty registers and gets today + 15 days", String(fresh.body.expiry));
  const freshAgain = await call("foreverkey", { name: "New shop renamed" });
  R.ck(freshAgain.status === 200 && freshAgain.body.expiry === shift(15) && db.tenants.get("foreverkey").name === "New shop renamed", "registering it again keeps that day (it is not pushed to another 15 days)");
  db.state.refuseWrites = true;
  const blocked = await call("activekey", { ...GOOD, name: "Blocked" });
  db.state.refuseWrites = false;
  R.ck(blocked.status === 500 && blocked.body.code === "NOT_UPDATED" && blocked.body.retry === "same-request" && db.tenants.get("activekey").name === "Active shop", "when the database refuses the write the answer is 500 NOT_UPDATED, not 401 (the key is fine: the app must not read it as a refusal)", JSON.stringify(blocked.body));

  // the body
  R.ck((await code("goodkey", GOOD, { rawBody: "{not json" })) === "400 BODY_NOT_JSON", "a body that is not JSON: 400 BODY_NOT_JSON");
  R.ck((await code("goodkey", ["a"])) === "400 INVALID_BODY" && (await code("goodkey", null)) === "400 INVALID_BODY" && (await code("goodkey", "text")) === "400 INVALID_BODY", "a body that is not an object: 400 INVALID_BODY");
  R.ck((await code("goodkey", { phone: "0550 00 00 00" })) === "400 MISSING_FIELD" && (await code("goodkey", {})) === "400 MISSING_FIELD", "the name is required: 400 MISSING_FIELD");
  R.ck((await code("goodkey", { name: " " })) === "400 INVALID_FIELD", "a blank name: 400 INVALID_FIELD");
  R.ck((await code("goodkey", { ...GOOD, host: "other.example.com" })) === "400 UNKNOWN_FIELD" && db.tenants.get("goodkey").host === "old.example.com", "the host is not accepted at all: 400 UNKNOWN_FIELD, and the shop's host is unchanged");
  R.ck((await code("goodkey", { ...GOOD, key: "other" })) === "400 UNKNOWN_FIELD" && (await code("goodkey", { ...GOOD, expiry: "2099-01-01" })) === "400 UNKNOWN_FIELD", "a field that is not the shop's information (the key, the expiry...): 400 UNKNOWN_FIELD");
  for (const [what, patch] of [
    ["an e-mail without @", { email: "nope" }],
    ["a phone with letters", { phone: "call me" }],
    ["an Instagram address that is not http(s)", { instagramUrl: "javascript:alert(1)" }],
    ["a TikTok address that is not an address", { tiktokUrl: "tiktok" }],
    ["a name that is too long", { name: "x".repeat(121) }],
    ["a number as name", { name: 5 }],
    ["an object as address", { address: { a: 1 } }],
  ]) {
    R.ck((await code("goodkey", { ...GOOD, ...patch })) === "400 INVALID_FIELD", `${what}: 400 INVALID_FIELD`);
  }
  R.ck(db.tenants.get("goodkey").name === "Old name", "and a body that is refused changes nothing");

  // the update
  const ok = await call("goodkey", GOOD);
  R.ck(ok.status === 200 && ok.body.registered === true, "a valid request: 200 { registered: true }", JSON.stringify(ok.body).slice(0, 120));
  const row = db.tenants.get("goodkey");
  R.ck(row.name === "Maison Clair" && row.phone === "+213 550 00 00 00" && row.email === "hello@maison-clair.example.com" && row.address === "12 Rue Didouche Mourad, Algiers", "the shop's row holds what was sent");
  R.ck(row.instagram_url === "https://instagram.com/maisonclair" && row.tiktok_url === "https://tiktok.com/@maisonclair", "including the social addresses");
  R.ck(row.host === "old.example.com", "the shop's host (set by hand) is never touched");
  R.ck(row.key === "goodkey", "the key is never changed by it");
  R.ck(row.expiry === shift(15), "the expiry (it was empty) is set to today + 15 days", String(row.expiry));
  R.ck(ok.body.tenant.name === "Maison Clair" && ok.body.tenant.instagramUrl === "https://instagram.com/maisonclair" && ok.body.expiry === shift(15), "the answer holds the shop as stored and its expiry day (today + 15)");
  const again = await call("goodkey", { ...GOOD, phone: "+213 661 11 22 33" });
  R.ck(again.status === 200 && again.body.expiry === shift(15) && row.expiry === shift(15) && row.phone === "+213 661 11 22 33", "registering the same key again: 200, the details are updated and the expiry stays the same day");
  row.expiry = null; // (the shop's licence is reset in the database)
  const partial = await call("goodkey", { name: "Renamed", phone: null, email: "" });
  R.ck(partial.status === 200 && row.name === "Renamed" && row.phone === null && row.email === null, "null or \"\" clears an optional field");
  R.ck(row.address === "12 Rue Didouche Mourad, Algiers" && row.instagram_url === "https://instagram.com/maisonclair", "and a field that is not sent is left as it was");
  row.expiry = null; // (the shop is reset in the database, for the checks that follow)
}

(async () => {
  // ---- the pure rules
  const core = await import(url("backend", "src", "lib", "registerCore.js"));
  R.section("registerCore");
  const copy = require("node:fs").readFileSync(path.join(ROOT, "cloudflare", "src", "registerCore.js"), "utf8");
  const source = require("node:fs").readFileSync(path.join(ROOT, "backend", "src", "lib", "registerCore.js"), "utf8");
  R.ck(copy.replace(/^\/\/ COPY[^\n]*\n/, "").replace(/\r/g, "") === source.replace(/\r/g, ""), "the Worker's registerCore.js is an exact copy of the backend's");
  R.ck(!("host" in core.validateRegisterBody(GOOD).values) && core.validateRegisterBody({ ...GOOD, host: "x.example.com" }).failure?.body.code === "UNKNOWN_FIELD", "validateRegisterBody never produces a host column, and refuses a host in the body");
  R.ck(!("key" in core.validateRegisterBody(GOOD).values), "and never produces a key column");
  const update = core.buildRegisterUpdate("k", { name: "A", phone: "0550 00 00 00" });
  R.ck(update.text === "UPDATE tenants SET name = $2, phone = $3, expiry = COALESCE(expiry, (now() AT TIME ZONE 'UTC')::date + 15) WHERE key = $1 AND (expiry IS NULL OR expiry::date >= (now() AT TIME ZONE 'UTC')::date) RETURNING key, name, host, phone, email, address, instagram_url, tiktok_url, expiry" && update.params.join() === "k,A,0550 00 00 00", "buildRegisterUpdate sets the columns sent (values as parameters, never in the text) and keeps the expiry it has, or sets today + 15 when there is none, only for a licence that is not expired", update.text);
  R.ck(core.REGISTER_DAYS === 15, "a new shop's licence lasts 15 days from the day it registers");

  // ---- the Cloudflare Worker
  const { createWorker } = await import(url("cloudflare", "src", "index.js"));
  const { resetFailures } = await import(url("cloudflare", "src", "auth.js"));
  let countingFailures = false; // (the Worker slows an address down after ten wrong keys: only the test of that keeps the count)
  const workerDb = makeDatabase();
  const worker = createWorker({ makeSql: () => ({ query: workerDb.query }) });
  const workerCall = async (key, body, { method = "POST", rawBody } = {}) => {
    if (!countingFailures) resetFailures();
    const headers = { "content-type": "application/json" };
    if (key !== null) headers.authorization = `Bearer ${key}`;
    const response = await worker.fetch(new Request("https://shop.example.com/api/register", { method, headers, body: method === "GET" ? undefined : (rawBody ?? JSON.stringify(body)) }), {}, {});
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  };
  await scenarios("Cloudflare Worker", workerCall, workerDb);
  R.ck((await workerCall("goodkey", null, { method: "GET" })).status === 405, "Worker: GET /api/register is 405");
  const viaWorker = async (pathAndQuery, key, env = {}) => {
    if (!countingFailures) resetFailures();
    const response = await worker.fetch(new Request("https://shop.example.com" + pathAndQuery, { method: "POST", headers: { authorization: "Bearer " + key }, body: "{}" }), env, {});
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const tableExpired = await viaWorker("/api/table/customers?action=bogus", "expiredkey");
  const tableUnknown = await viaWorker("/api/table/customers?action=bogus", "nosuchkey");
  const tableGood = await viaWorker("/api/table/customers?action=bogus", "activekey");
  R.ck(tableExpired.status === 401 && tableExpired.body.code === "UNAUTHORIZED", "Worker: the table API refuses an expired key: 401 UNAUTHORIZED");
  R.ck(JSON.stringify(tableExpired.body) === JSON.stringify(tableUnknown.body), "Worker: and the answer is the same as for a key that does not exist");
  R.ck(tableGood.status === 400 && tableGood.body.code === "INVALID_ACTION", "Worker: a valid key gets past the key check of the table API");
  R.ck((await viaWorker("/api/table/customers?action=bogus", "todaykey")).status === 400, "Worker: a key that expires today is accepted by the table API");
  const tableUnregistered = await viaWorker("/api/table/customers?action=bogus", "unregisteredkey");
  R.ck(tableUnregistered.status === 401 && JSON.stringify(tableUnregistered.body) === JSON.stringify(tableUnknown.body), "Worker: the table API refuses a key that never registered (its expiry is empty): 401 UNAUTHORIZED, the same answer as an unknown key");
  const photoUpload = "/api/images/abc/3f6c1d7e-2b4a-4d8e-9a51-7c0e5b2a8f14?type=bogus";
  const uploadUnregistered = await viaWorker(photoUpload, "unregisteredkey", { IMAGES: {} });
  R.ck(uploadUnregistered.status === 401 && uploadUnregistered.body.code === "UNAUTHORIZED", "Worker: a photo upload refuses a key that never registered: 401 UNAUTHORIZED");
  const uploadExpired = await viaWorker(photoUpload, "expiredkey", { IMAGES: {} }); // (a bucket must be bound for the upload to start)
  const uploadUnknown = await viaWorker(photoUpload, "nosuchkey", { IMAGES: {} });
  R.ck(uploadExpired.status === 401 && uploadExpired.body.code === "UNAUTHORIZED" && JSON.stringify(uploadExpired.body) === JSON.stringify(uploadUnknown.body), "Worker: a photo upload refuses an expired key (401 UNAUTHORIZED, the same answer as an unknown key)");
  const uploadGood = await viaWorker(photoUpload, "activekey", { IMAGES: {} });
  R.ck(uploadGood.status === 400 && uploadGood.body.code === "INVALID_TYPE", "Worker: a valid key gets past the key check of the upload");
  const deleteExpired = await worker.fetch(new Request("https://shop.example.com/api/images/not-a-uuid", { method: "DELETE", headers: { authorization: "Bearer expiredkey" } }), { IMAGES: {} }, {});
  R.ck(deleteExpired.status === 400 && (await deleteExpired.json()).code === "INVALID_PHOTO_ID", "Worker: deleting a photo still checks only that the key exists (an expired key gets past it)");
  const expiryOf = async (key, method = "GET") => {
    resetFailures();
    const response = await worker.fetch(new Request("https://shop.example.com/api/expiry", { method, headers: key === null ? {} : { authorization: "Bearer " + key } }), {}, {});
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const wOk = await expiryOf("activekey");
  R.ck(wOk.status === 200 && wOk.body.expiry === shift(30), "Worker: GET /api/expiry with a running key: 200 { expiry: YYYY-MM-DD }", JSON.stringify(wOk.body));
  const wBad = await Promise.all(["nosuchkey", "unregisteredkey", "expiredkey", "bad key!"].map((k) => expiryOf(k)));
  R.ck(wBad.every((r) => r.status === 401 && r.body.code === "UNAUTHORIZED") && new Set(wBad.map((r) => JSON.stringify(r.body))).size === 1, "Worker: GET /api/expiry: unknown, never registered, expired or malformed key: the same 401 UNAUTHORIZED");
  R.ck((await expiryOf("activekey", "POST")).status === 405, "Worker: POST /api/expiry is 405");
  resetFailures();
  const bigBody = await workerCall("goodkey", null, { rawBody: JSON.stringify({ name: "x".repeat(20000) }) });
  R.ck(bigBody.status === 413, "Worker: a body over 16 KB is refused (413)");
  countingFailures = true;
  resetFailures();
  let last;
  for (let i = 0; i < 12; i++) last = await workerCall("wrongkey" + i, GOOD);
  R.ck(last.status === 429 && last.body.code === "TOO_MANY_ATTEMPTS", "Worker: too many wrong keys from one address: 429 TOO_MANY_ATTEMPTS");
  const sharedAddress = await viaWorker("/api/table/customers?action=bogus", "activekey");
  R.ck(sharedAddress.status === 400 && sharedAddress.body.code === "INVALID_ACTION", "Worker: and a valid key from that same blocked address is not slowed down (shops can share one connection)");
  R.ck((await viaWorker("/api/table/customers?action=bogus", "wrongkeyagain")).status === 429, "Worker: while another wrong key from it still is");
  countingFailures = false;

  // 8. the website of a shop whose licence has ended shows nothing
  const read = async (host, pathname) => {
    resetFailures();
    const response = await worker.fetch(new Request(`https://${host}${pathname}`), {}, {});
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  R.section("Cloudflare Worker: the website of an expired shop");
  for (const pathname of ["/api/infos", "/api/catalog", "/api/frames?brandId=1&categoryId=1", "/api/frames/abc-123", "/api/accessories", "/api/accessories/abc-123"]) {
    const r = await read("expired.example.com", pathname);
    R.ck(r.status === 403 && r.body.code === "LICENSE_EXPIRED", `an expired shop: GET ${pathname.split("?")[0]} -> 403 LICENSE_EXPIRED`, JSON.stringify(r.body));
  }
  const live = await read("active.example.com", "/api/infos");
  R.ck(live.status === 200 && live.body.name === "Active shop", "a shop whose licence is running: its site is served");
  R.ck((await read("today.example.com", "/api/infos")).status === 200, "a shop whose last day is today: still served");
  R.ck((await read("never.example.com", "/api/infos")).status === 200, "a shop with no expiry set yet (not registered): still served, its site does not go dark");
  R.ck((await read("nobody.example.com", "/api/infos")).status === 404, "a host no shop uses: the usual 404");

  // ---- the Express backend
  const express = require(path.join(ROOT, "backend", "node_modules", "express"));
  const { createRegisterRouter } = await import(url("backend", "src", "lib", "registerApi.js"));
  const backendDb = makeDatabase();
  const app = express();
  app.set("trust proxy", true); // (each call below comes from its own made-up address: the backend slows an address down after ten wrong keys)
  app.use("/api/register", createRegisterRouter({ findRegistrableTenant: async (key) => (await backendDb.query("SELECT key FROM tenants WHERE key = $1 AND (expiry IS NULL OR expiry::date >= (now() AT TIME ZONE 'UTC')::date)", [key]))[0] ?? null, query: backendDb.query }));
  const { createExpiryRouter } = await import(url("backend", "src", "lib", "expiryApi.js"));
  app.use("/api/expiry", createExpiryRouter({ findActiveTenant: async (key) => (await backendDb.query("SELECT key, expiry FROM tenants WHERE key = $1 AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE 'UTC')::date", [key]))[0] ?? null }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  let nextAddress = 1;
  let fixedAddress = null;
  const backendCall = async (key, body, { method = "POST", rawBody } = {}) => {
    const headers = { "content-type": "application/json", "x-forwarded-for": fixedAddress ?? `10.0.${Math.floor(nextAddress / 250)}.${(nextAddress++ % 250) + 1}` };
    if (key !== null) headers.authorization = `Bearer ${key}`;
    const response = await fetch(`http://127.0.0.1:${port}/api/register`, { method, headers, body: method === "GET" ? undefined : (rawBody ?? JSON.stringify(body)) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  await scenarios("Express backend", backendCall, backendDb);
  R.ck((await backendCall("goodkey", null, { method: "GET" })).status === 405, "Backend: GET /api/register is 405");
  R.ck((await backendCall("goodkey", null, { rawBody: JSON.stringify({ name: "x".repeat(20000) }) })).status === 413, "Backend: a body over 16 KB is refused (413)");
  const expiryOfBackend = async (key, method = "GET") => {
    const response = await fetch(`http://127.0.0.1:${port}/api/expiry`, { method, headers: { "x-forwarded-for": `10.8.${nextAddress >> 8}.${nextAddress++ & 255}`, ...(key === null ? {} : { authorization: "Bearer " + key }) } });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const bOk = await expiryOfBackend("activekey");
  R.ck(bOk.status === 200 && bOk.body.expiry === shift(30), "Backend: GET /api/expiry with a running key: 200 { expiry: YYYY-MM-DD }", JSON.stringify(bOk.body));
  const bBad = await Promise.all(["nosuchkey", "unregisteredkey", "expiredkey", "bad key!"].map((k) => expiryOfBackend(k)));
  R.ck(bBad.every((r) => r.status === 401 && r.body.code === "UNAUTHORIZED"), "Backend: GET /api/expiry: unknown, never registered, expired or malformed key: 401 UNAUTHORIZED");
  R.ck((await expiryOfBackend("activekey", "POST")).status === 405, "Backend: POST /api/expiry is 405");
  // the table API of the backend applies the same key check
  const { createTableApiRouter } = await import(url("backend", "src", "lib", "tableApi.js"));
  const tableApp = express();
  tableApp.use("/api/table", createTableApiRouter({ findActiveTenant: async (key) => (await backendDb.query("SELECT key, expiry FROM tenants WHERE key = $1 AND expiry IS NOT NULL AND expiry::date >= (now() AT TIME ZONE 'UTC')::date", [key]))[0] ?? null, runQuery: async () => [], removeFiles: async () => [] }));
  const tableServer = http.createServer(tableApp);
  await new Promise((resolve) => tableServer.listen(0, "127.0.0.1", resolve));
  const viaBackend = async (key) => {
    const response = await fetch("http://127.0.0.1:" + tableServer.address().port + "/api/table/customers?action=bogus", { method: "POST", headers: { authorization: "Bearer " + key }, body: "{}" });
    return { status: response.status, code: (await response.json().catch(() => ({}))).code };
  };
  R.section("Express backend: table API");
  const bExpired = await viaBackend("expiredkey");
  const bGood = await viaBackend("activekey");
  const bUnregistered = await viaBackend("unregisteredkey");
  R.ck(bUnregistered.status === 401 && bUnregistered.code === "UNAUTHORIZED", "Backend: the table API refuses a key that never registered (its expiry is empty): 401 UNAUTHORIZED");
  R.ck(bExpired.status === 401 && bExpired.code === "UNAUTHORIZED", "Backend: the table API refuses an expired key: 401 UNAUTHORIZED");
  R.ck(bGood.status === 400 && bGood.code === "INVALID_ACTION", "Backend: a valid key gets past the key check of the table API");
  tableServer.close();
  fixedAddress = "10.9.9.9";
  let lastBackend;
  for (let i = 0; i < 12; i++) lastBackend = await backendCall("wrongkey" + i, GOOD);
  R.ck(lastBackend.status === 429 && lastBackend.body.code === "TOO_MANY_ATTEMPTS", "Backend: too many wrong keys from one address: 429 TOO_MANY_ATTEMPTS");
  const backendShared = await backendCall("unregisteredkey", { name: "Valid from a blocked address" });
  R.ck(backendShared.status === 200, "Backend: and a valid key from that same blocked address is not slowed down");
  R.ck((await backendCall("wrongkeyagain", GOOD)).status === 429, "Backend: while another wrong key from it still is");

  // 8. the gate in front of the website's reads
  R.section("Express backend: the website of an expired shop");
  const { createLicenseGate } = await import(url("backend", "src", "lib", "licenseGate.js"));
  const gate = createLicenseGate({ isHostExpired: async (host) => (await backendDb.query("SELECT 1 AS expired FROM tenants WHERE host = $1 AND expiry IS NOT NULL AND expiry::date < (now() AT TIME ZONE 'UTC')::date", [host])).length > 0 });
  const through = async (hostname) => {
    const result = { next: false, status: null, body: null };
    await gate({ hostname }, { status(s) { result.status = s; return this; }, json(b) { result.body = b; } }, () => { result.next = true; });
    return result;
  };
  const gExpired = await through("expired.example.com");
  R.ck(gExpired.next === false && gExpired.status === 403 && gExpired.body.code === "LICENSE_EXPIRED", "an expired shop: 403 LICENSE_EXPIRED, the read is not made");
  R.ck((await through("active.example.com")).next === true && (await through("today.example.com")).next === true, "a running licence, or a last day of today: the read goes on");
  R.ck((await through("never.example.com")).next === true && (await through("nobody.example.com")).next === true, "a shop with no expiry set yet, or an unknown host: the read goes on (the site does not go dark)");
  fixedAddress = null;
  server.close();
  process.exit(R.done());
})().catch((error) => {
  console.log("ERR", error.stack);
  process.exit(1);
});
