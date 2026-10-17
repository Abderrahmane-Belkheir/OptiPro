// Fails the build if a foreign key between synced tables isn't covered by the "parent must be
// synced before the child is pushed" rule. The rule's list is src/local/syncParents.ts; the truth
// is prisma/sqlite/schema.prisma. Runs after the build (needs dist/); run it alone with
//   npm run check:sync-parents
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const schema = fs.readFileSync(path.join(root, "prisma", "sqlite", "schema.prisma"), "utf8");
const listFile = path.join(root, "dist", "local", "syncParents.js");
if (!fs.existsSync(listFile)) {
  console.error("check-sync-parents: dist/local/syncParents.js is missing — run \"npm run build\" first.");
  process.exit(1);
}
const { SYNC_PARENTS, SYNCED_TABLES } = createRequire(import.meta.url)(listFile);

// model name -> { table, syncable, relations: [{ field, target }] }
const models = new Map();
for (const match of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
  const lines = match[2].split("\n").map((line) => line.trim());
  models.set(match[1], {
    table: lines.find((l) => l.startsWith("@@map"))?.match(/"(\w+)"/)?.[1],
    syncable: lines.some((l) => /^synced\s/.test(l)),
    relations: lines.flatMap((l) => {
      const rel = l.match(/^(\w+)\s+(\w+)(\?)?\s+@relation\((?:"\w+",\s*)?fields:\s*\[(\w+)\]/);
      return rel ? [{ name: rel[1], target: rel[2], optional: Boolean(rel[3]), field: rel[4] }] : [];
    }),
  });
}

// Every foreign key from a synced table to another synced table is a parent that must be synced.
const expected = [];
const details = new Map(); // "table.field -> parent" -> { name, optional }
for (const model of models.values()) {
  if (!model.syncable) continue;
  for (const { target, field, name, optional } of model.relations) {
    const parent = models.get(target);
    if (!parent?.syncable) continue;
    const key = `${model.table}.${field} -> ${parent.table}`;
    expected.push(key);
    details.set(key, { name, optional });
  }
}
const listed = Object.entries(SYNC_PARENTS).flatMap(([table, parents]) => parents.map((p) => `${table}.${p.field} -> ${p.parent}`));
const entries = new Map(Object.entries(SYNC_PARENTS).flatMap(([table, parents]) => parents.map((p) => [`${table}.${p.field} -> ${p.parent}`, p])));

// The SQL filter in syncPush.ts relies on the relation being named after the column and on knowing
// whether the column can be empty, so both must match the schema.
const wrong = [];
for (const [key, { name, optional }] of details) {
  const entry = entries.get(key);
  if (!entry) continue;
  if (name !== entry.field.replace(/Id$/, "")) wrong.push(`${key}: the relation is called "${name}", expected "${entry.field.replace(/Id$/, "")}".`);
  if (Boolean(entry.optional) !== optional) wrong.push(`${key}: the schema says ${optional ? "optional" : "required"}, SYNC_PARENTS says ${entry.optional ? "optional" : "required"}.`);
}

const missing = expected.filter((e) => !listed.includes(e));
const unknown = listed.filter((l) => !expected.includes(l));
const noDelegate = [...new Set(listed.map((l) => l.split(" -> ")[1]))].filter((t) => !SYNCED_TABLES[t]);

console.log(`${expected.length} foreign keys between synced tables in the schema, ${listed.length} in syncParents.ts.`);
missing.forEach((e) => console.error(`MISSING  ${e} — a child could be pushed before this parent. Add it to SYNC_PARENTS.`));
unknown.forEach((l) => console.error(`UNKNOWN  ${l} — not a foreign key between synced tables in the schema.`));
noDelegate.forEach((t) => console.error(`NO DELEGATE  ${t} is a parent but has no entry in SYNCED_TABLES.`));
wrong.forEach((w) => console.error(`MISMATCH  ${w}`));
process.exit(missing.length || unknown.length || noDelegate.length || wrong.length ? 1 : 0);
