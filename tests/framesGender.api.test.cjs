// What the website's frames request gets from the Worker: the frames of a category and a brand only (the website narrows them by gender itself), each with its gender.
// The database is a small in-memory stand-in that answers the statements the Worker makes.
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { recorder } = require("./helpers/app.cjs");

const R = recorder();
const ROOT = path.resolve(__dirname, "..");
const FRAMES = [
  { code: "aaa-111", name: "Aviator Women", gender: "female" },
  { code: "bbb-222", name: "Wayfarer Men", gender: "male" },
  { code: "ccc-333", name: "Clubmaster Unisex", gender: "unisex" },
  { code: "ddd-444", name: "No gender yet", gender: null },
].map((f) => ({ ...f, price: 18500, currency: "DZD", images: [], shape: null, colors: [], stock: 2, brand: "Ray-Ban", category: "Optical Frames", imageIds: [] }));

function makeSql() {
  const state = { selects: [] };
  const exec = async (text, params = []) => {
    if (/^SELECT set_config\('app\.tenant_key'/.test(text)) return [{ set_config: "t1" }];
    if (/^SELECT 1 AS expired FROM tenants/.test(text)) return [];
    if (/SELECT count\(\*\)::int AS total FROM frames/.test(text)) return [{ total: FRAMES.length }];
    if (/FROM frames p/.test(text)) { state.selects.push({ text: text.replace(/\s+/g, " "), params }); return FRAMES; }
    throw new Error("unexpected statement: " + text.slice(0, 80));
  };
  const statement = (text, params) => ({ run: () => exec(text, params), then: (res, rej) => exec(text, params).then(res, rej) });
  return { state, sql: { query: statement, transaction: async (list) => { const out = []; for (const s of list) out.push(await s.run()); return out; } } };
}

(async () => {
  const { framesRoute } = await import(pathToFileURL(path.join(ROOT, "cloudflare", "src", "reads.js")).href);
  const url = new URL("https://shop.example.com/api/frames?brandId=b1&categoryId=1");
  const db = makeSql();
  const response = await framesRoute(new Request(url), {}, { waitUntil() {} }, db.sql, "shop.example.com", url);
  const body = await response.json();
  R.section("the Worker");
  R.ck(response.status === 200 && body.length === 4, "a category and a brand give every frame of them");
  R.ck(/p\.brand_id = \$1 AND p\.category_id = \$2/.test(db.state.selects[0].text) && !/gender/.test(db.state.selects[0].text.split("WHERE")[1] ?? ""), "the database is asked for that category and that brand only (nothing about the gender)", db.state.selects[0].text.slice(-120));
  R.ck(body.every((f) => "gender" in f) && body[0].gender === "female" && body[3].gender === null, "every frame goes out with its gender (null when it has none), for the website to filter");
  process.exit(R.done());
})().catch((e) => { console.log("ERR", e.stack); process.exit(1); });
