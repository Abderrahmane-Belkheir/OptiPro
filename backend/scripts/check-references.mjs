// Fails if a foreign key into another tenant-owned table is missing from TENANT_OWNED_REFERENCES
// (src/services/tableService.js) — Postgres skips row-level security when checking foreign keys, so
// each one needs the explicit "is this row yours?" check. Run after editing prisma/schema.prisma:
//   npm run check:references
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TENANT_OWNED_REFERENCES } from '../src/services/tableService.js';

const schema = fs.readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');
const models = new Map();
for (const match of schema.matchAll(/^model (\w+) \{\n([\s\S]*?)\n\}/gm)) {
  models.set(match[1], match[2].split('\n').map((line) => line.trim()));
}
const tenantOwned = new Set([...models].filter(([, lines]) => lines.some((l) => /^tenantKey\s/.test(l))).map(([name]) => name));

const expected = [];
for (const [name, lines] of models) {
  if (!tenantOwned.has(name)) continue;
  for (const line of lines) {
    const rel = line.match(/^\w+\s+(\w+)\??\s+@relation\((?:"\w+",\s*)?fields:\s*\[(\w+)\]/);
    if (rel && rel[1] !== 'Tenant' && tenantOwned.has(rel[1])) expected.push({ model: name, field: rel[2], target: rel[1] });
  }
}

const actual = Object.entries(TENANT_OWNED_REFERENCES).flatMap(([model, refs]) => refs.map((r) => ({ model, field: r.field, target: r.model })));
const key = (r) => `${r.model}.${r.field} -> ${r.target}`;
const missing = expected.filter((e) => !actual.some((a) => key(a) === key(e)));
const extra = actual.filter((a) => !expected.some((e) => key(a) === key(e)));

console.log(`${expected.length} foreign keys between tenant-owned tables in the schema, ${actual.length} checked.`);
missing.forEach((r) => console.error(`MISSING  ${key(r)}`));
extra.forEach((r) => console.error(`UNKNOWN  ${key(r)} (not a foreign key in the schema)`));
process.exit(missing.length || extra.length ? 1 : 0);
