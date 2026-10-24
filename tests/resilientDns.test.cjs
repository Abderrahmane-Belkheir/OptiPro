// Reaching the server when some of the addresses of its name do not answer (src/lib/resilientDns.ts): the addresses the system gives are completed with others, and a
// connection that is not made goes on to the next address. A fake name stands for the server: the "system" gives an address that never answers, the extra resolver
// gives the real one (a local server).
const http = require("node:http");
const dns = require("node:dns");
const path = require("node:path");
const { recorder } = require("./helpers/app.cjs");

const R = recorder();
const ROOT = path.resolve(__dirname, "..");

// the "system" DNS of the test: a name whose only address never answers, a name that does not exist, and the normal behaviour for the rest
const BLACKHOLE = "10.255.255.1";
const realLookup = dns.lookup;
dns.lookup = function (hostname, a, b) {
  const cb = typeof a === "function" ? a : b;
  const opts = typeof a === "function" ? {} : a;
  if (hostname === "stuck.test") return setImmediate(() => (opts.all ? cb(null, [{ address: BLACKHOLE, family: 4 }]) : cb(null, BLACKHOLE, 4)));
  if (hostname === "gone.test" || hostname === "nowhere.test") return setImmediate(() => cb(Object.assign(new Error("getaddrinfo ENOTFOUND " + hostname), { code: "ENOTFOUND" })));
  return realLookup.call(dns, hostname, a, b);
};

const R2 = require(path.join(ROOT, "dist", "lib", "resilientDns.js"));
let asked = 0;
R2.installResilientLookup({ extra: async (hostname) => { asked++; return hostname === "nowhere.test" ? [] : ["127.0.0.1"]; } });

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end("ok"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const get = async (host) => {
    const t = Date.now();
    try {
      const r = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(15000) });
      return { status: r.status, ms: Date.now() - t };
    } catch (e) {
      return { error: e.cause?.code ?? e.name, ms: Date.now() - t };
    }
  };

  R.section("the addresses");
  const m = R2.mergeAddresses([{ address: "1.1.1.1", family: 4 }, { address: "2.2.2.2", family: 4 }], [{ address: "2.2.2.2", family: 4 }, { address: "3.3.3.3", family: 4 }]);
  R.ck(m.map((a) => a.address).join() === "1.1.1.1,2.2.2.2,3.3.3.3", "the system's addresses first, then the others, none twice");

  R.section("a name whose address never answers");
  const stuck = await get("stuck.test");
  R.ck(stuck.status === 200 && stuck.ms < 9000, "the connection goes on to the other address after the short attempt time, and gets through", JSON.stringify(stuck));
  const before = asked;
  const again = await get("stuck.test");
  R.ck(again.status === 200 && asked === before, "the extra addresses are kept for a while (not asked for again at once)", JSON.stringify([again, asked - before]));

  R.section("a name the system cannot resolve");
  const gone = await get("gone.test");
  R.ck(gone.status === 200, "the system's DNS fails altogether: the other addresses are used", JSON.stringify(gone));
  const nowhere = await get("nowhere.test");
  R.ck(nowhere.error !== undefined && nowhere.status === undefined, "when nobody can resolve it the call fails as it did (not a hang)", JSON.stringify(nowhere));

  R.section("what is left alone");
  const before2 = asked;
  const ip = await get("127.0.0.1");
  const local = await get("localhost");
  R.ck(ip.status === 200 && asked === before2, "an address given as an address is not resolved again", JSON.stringify(ip));
  R.ck(local.status === 200 && asked === before2, "localhost is the system's own", JSON.stringify(local));

  const code = R.done();
  server.closeAllConnections?.();
  server.close();
  setTimeout(() => process.exit(code), 300); // (after the sockets are closed: leaving at once can trip an assertion of the runtime on Windows)
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
