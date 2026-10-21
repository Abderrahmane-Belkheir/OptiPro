// Activation on a flaky connection: the request is tried up to three times, but only when it certainly never reached the server.
const path = require("node:path");
const { recorder, ROOT } = require("./helpers/app.cjs");
const { activate, REGISTER_ATTEMPTS, REGISTER_RETRY_WAITS_MS } = require(path.join(ROOT, "dist", "setup.js"));

const R = recorder();
const FORM = { tenantKey: "goodkey", serverUrl: "https://shop.example.com/", name: "Maison Clair" };
const ok = () => new Response(JSON.stringify({ registered: true, tenant: {}, expiry: "2030-01-01" }), { status: 200 });
const reply = (status, body = {}) => () => new Response(JSON.stringify(body), { status });
const connectTimeout = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new AggregateError([Object.assign(new Error("connect ECONNREFUSED ::1:443"), { code: "ECONNREFUSED" }), Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" })]), { code: "ECONNREFUSED" }) });
const inFlight = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); // sent, no answer in time
const dropped = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
const refusedBy = (status, body) => () => new Response(JSON.stringify(body), { status });
const throws = (make) => () => { throw make(); };

/** A fake fetch: each call takes the next step (a function that returns a Response or throws); counts the calls. */
function fake(...steps) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    return step();
  };
  fn.calls = calls;
  return fn;
}
const NO_WAIT = [0, 0];

(async () => {
  R.section("tries again");
  R.ck(REGISTER_ATTEMPTS === 3 && REGISTER_RETRY_WAITS_MS.join() === "1000,2000", "three tries in all, waiting 1 s then 2 s between them");
  let f = fake(throws(connectTimeout), throws(connectTimeout), ok);
  let r = await activate(FORM, f, 1000, NO_WAIT);
  R.ck(r.kind === "activated" && f.calls.length === 3, "a connection that times out twice and then works: activated on the third try", `${r.kind}, ${f.calls.length} calls`);
  f = fake(throws(refused), ok);
  r = await activate(FORM, f, 1000, NO_WAIT);
  R.ck(r.kind === "activated" && f.calls.length === 2, "a refused connection (even nested inside an AggregateError) is tried again", `${r.kind}, ${f.calls.length} calls`);
  f = fake(reply(503), reply(502), ok);
  r = await activate(FORM, f, 1000, NO_WAIT);
  R.ck(r.kind === "activated" && f.calls.length === 3, "a 503 or 502 (the front door briefly closed) is tried again", `${r.kind}, ${f.calls.length} calls`);
  f = fake(throws(connectTimeout));
  r = await activate(FORM, f, 1000, NO_WAIT);
  R.ck(r.kind === "invalid" && /can't be reached/.test(r.message) && r.field === "serverUrl" && f.calls.length === 3, "when all three tries fail the form says the server can't be reached (and marks the address)", `${r.kind}, ${f.calls.length} calls`);
  f = fake(reply(503));
  r = await activate(FORM, f, 1000, NO_WAIT);
  R.ck(r.kind === "invalid" && f.calls.length === 3, "three 503s in a row: it gives up with a message", `${r.kind}, ${f.calls.length} calls`);
  const first = f.calls[0], last = f.calls[2];
  R.ck(first.url === "https://shop.example.com/api/register" && first.init.body === last.init.body && first.init.headers.Authorization === "Bearer goodkey", "every try sends the same request");

  R.section("does not try again");
  for (const [label, step, kind] of [
    ["an answer that never came (it may have reached the server)", throws(inFlight), "invalid"],
    ["a connection dropped in the middle of the answer", throws(dropped), "invalid"],
    ["401 (the key is not accepted)", reply(401, { code: "UNAUTHORIZED" }), "invalid"],
    ["400 (the details are wrong)", reply(400, { error: "bad", code: "INVALID_FIELD", field: "email" }), "invalid"],
    ["429 (too many attempts)", reply(429, { code: "TOO_MANY_ATTEMPTS" }), "invalid"],
    ["500 (a fault on the server)", reply(500, { code: "SERVER_ERROR" }), "invalid"],
    ["404", reply(404, {}), "invalid"],
    ["200 (activated)", ok, "activated"],
  ]) {
    f = fake(step, ok);
    r = await activate(FORM, f, 1000, NO_WAIT);
    R.ck(r.kind === kind && f.calls.length === 1, `${label}: one try only`, `${r.kind}, ${f.calls.length} calls`);
  }
  f = fake(reply(401, { code: "UNAUTHORIZED" }));
  r = await activate({ ...FORM, tenantKey: "bad key!" }, f, 1000, NO_WAIT);
  R.ck(r.kind === "invalid" && f.calls.length === 0, "a form that is wrong is refused before any request is made");

  R.section("the pause between tries");
  f = fake(throws(connectTimeout), throws(connectTimeout), ok);
  const started = Date.now();
  await activate(FORM, f, 1000, [120, 120]);
  const took = Date.now() - started;
  R.ck(took >= 200 && took < 1500, "it waits between tries (the given pauses are used)", `${took} ms`);
  process.exit(R.done());
})();
