// Keeps the table API's data and logic in step across the two servers.
//
//   backend/src/lib/tableColumns.js   GENERATED from prisma/sqlite/schema.prisma: for every shop table, its columns with their
//                                     types, which ones are required, and its parents (the tables it points at).
//   backend/src/lib/tableCore.js      the logic (validation, SQL building, running): written by hand, here.
//   cloudflare/src/tableColumns.js    COPIES of the two files above for the Worker, which is its own project
//   cloudflare/src/tableCore.js       (the Express backend is the source of truth).
//
//   node scripts/sync-table-api.mjs            writes everything
//   node scripts/sync-table-api.mjs --check    fails when any file is out of date (npm run check:table-api)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const schema = fs.readFileSync(path.join(root, "prisma", "sqlite", "schema.prisma"), "utf8");

// ---- read the models ------------------------------------------------------------------------------
const SCALARS = { String: "text", Int: "int", Float: "float", Boolean: "bool", DateTime: "datetime" };
const LOCAL_ONLY = new Set(["synced", "remoteId"]); // columns that exist only in the desktop app's database
const models = new Map(); // model name -> { table, fields: [...] }
for (const match of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
  const fields = [];
  let table = null;
  for (const raw of match[2].split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("/") || line.startsWith("*")) continue;
    const map = line.match(/^@@map\("(\w+)"\)/);
    if (map) table = map[1];
    if (line.startsWith("@@")) continue;
    const f = line.match(/^(\w+)\s+(\w+)(\?|\[\])?(?:\s+(.*))?$/);
    if (!f) continue;
    const attrs = f[4] ?? "";
    fields.push({
      name: f[1], type: f[2], optional: f[3] === "?", list: f[3] === "[]",
      id: /@id\b/.test(attrs), autoincrement: /autoincrement\(\)/.test(attrs), hasDefault: /@default\(/.test(attrs),
      updatedAt: /@updatedAt\b/.test(attrs), column: attrs.match(/@map\("(\w+)"\)/)?.[1] ?? f[1],
      relationFields: attrs.match(/@relation\([^)]*fields:\s*\[(\w+)\]/)?.[1] ?? null,
    });
  }
  models.set(match[1], { table, fields });
}
const byTable = new Map([...models.values()].map((m) => [m.table, m]));

// Tables the app writes to: every model with a tenantKey (the shop's own rows). Not tenants, categories, or the app's local outbox.
const writable = [...models.values()].filter((m) => m.fields.some((f) => f.name === "tenantKey") && m.table !== "pending_deletions");

const MAX_TEXT = { description: 5000, notes: 5000, address: 500, customerAddress: 500 };

function describe(model) {
  const columns = {};
  const parents = {};
  const hasTenant = (table) => byTable.get(table)?.fields.some((f) => f.name === "tenantKey");
  const parentField = new Map(); // fk field -> parent model
  for (const f of model.fields) if (f.relationFields && models.has(f.type) && f.type !== "Tenant") parentField.set(f.relationFields, models.get(f.type));

  for (const f of model.fields) {
    if (LOCAL_ONLY.has(f.name) || f.name === "tenantKey" || f.updatedAt) continue;
    if (!(f.type in SCALARS) || f.list) continue; // relations
    let type = SCALARS[f.type];
    // The app stores a list of texts as JSON in a String; on the server it is a text[] column.
    if (f.type === "String" && /^(images|colors)$/.test(f.name)) type = "textArray";
    const spec = { column: f.column, type };
    if (f.id && f.autoincrement) {
      spec.readOnly = true; // the database picks it
    } else if (f.id) {
      spec.kind = "id";
      spec.required = true;
    } else {
      if (!f.optional && !f.hasDefault) spec.required = true;
      if (parentField.has(f.name)) spec.kind = "id";
      else if (type === "text") spec.max = MAX_TEXT[f.name] ?? 1000;
    }
    if (f.name === "createdAt") spec.immutable = true;
    if (f.id) spec.immutable = true;
    columns[f.name] = spec;
  }
  for (const [field, parent] of parentField) {
    const pk = parent.fields.find((x) => x.id);
    parents[field] = { table: parent.table, idType: SCALARS[pk.type], tenantScoped: hasTenant(parent.table) };
  }
  return {
    table: model.table,
    serialId: model.fields.some((f) => f.id && f.autoincrement),
    updatedAt: model.fields.some((f) => f.updatedAt),
    columns,
    parents,
  };
}

const tables = {};
for (const model of writable) tables[model.table] = describe(model);

// product_images is not like the app's local table: on the server it also belongs to a shop, its id is a UUID, and a photo's row
// is created by the photo upload (the table API only edits or removes it).
tables.product_images = {
  table: "product_images",
  serialId: false,
  updatedAt: false,
  columns: {
    id: { column: "id", type: "uuid", kind: "uuid", required: true, immutable: true },
    frameId: { column: "frame_id", type: "text", kind: "id" },
    accessoryId: { column: "accessory_id", type: "text", kind: "id" },
  },
  parents: {
    frameId: { table: "frames", idType: "text", tenantScoped: true },
    accessoryId: { table: "accessories", idType: "text", tenantScoped: true },
  },
};

const header = `// GENERATED by scripts/sync-table-api.mjs from prisma/sqlite/schema.prisma: do not edit by hand (run: node scripts/sync-table-api.mjs).
//
// For each table the table API writes to: its columns (field name used by the app -> database column, type, required, ...),
// its parents (the tables a foreign key points at) and whether the database fills an updated_at column.
// Types: text, int, float, bool, datetime, uuid, textArray. kind "id": a plain id (letters, digits, . _ -). Not listed on purpose:
// tenant_key (the server sets it from the key that was sent), updated_at (the server sets it), and the app-only synced / remoteId.
`;
const columnsFile = `${header}\nexport const TABLE_COLUMNS = ${JSON.stringify(tables, null, 2)};\n`;

// ---- write (or check) -------------------------------------------------------------------------------
const coreSource = path.join(root, "backend", "src", "lib", "tableCore.js");
if (!fs.existsSync(coreSource)) {
  console.error("sync-table-api: backend/src/lib/tableCore.js is missing.");
  process.exit(1);
}
const copyNote = (name) => `// COPY of backend/src/lib/${name} for the Worker: do not edit here (run: node scripts/sync-table-api.mjs).\n`;
const core = fs.readFileSync(coreSource, "utf8");
const wanted = new Map([
  [path.join(root, "backend", "src", "lib", "tableColumns.js"), columnsFile],
  [path.join(root, "cloudflare", "src", "tableColumns.js"), copyNote("tableColumns.js") + columnsFile],
  [path.join(root, "cloudflare", "src", "tableCore.js"), copyNote("tableCore.js") + core],
  [path.join(root, "cloudflare", "src", "registerCore.js"), copyNote("registerCore.js") + fs.readFileSync(path.join(root, "backend", "src", "lib", "registerCore.js"), "utf8")],
]);

let stale = 0;
for (const [file, text] of wanted) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === text) continue;
  if (check) {
    stale += 1;
    console.error(`sync-table-api: ${path.relative(root, file)} is out of date.`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, "utf8");
    console.log(`wrote ${path.relative(root, file)}`);
  }
}
if (check) {
  if (stale) {
    console.error('Run "node scripts/sync-table-api.mjs" to update them.');
    process.exit(1);
  }
  console.log(`sync-table-api: the table API files are up to date (${Object.keys(tables).length} tables).`);
}
