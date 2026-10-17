// tsc only compiles .ts, so the two generated, non-TypeScript pieces the app needs at runtime are
// copied next to the compiled code (dist/generated/) after every build:
//   src/generated/sqlite-client  -> dist/generated/sqlite-client   (the Prisma client, plain JS)
//   prisma/sqlite/init.sql       -> dist/generated/sqlite-init.sql (read by src/lib/sqliteClient.ts)
// Both are produced by scripts/generate-db.mjs, which `npm run build` runs first.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist", "generated");

const copies = [
  { from: path.join(root, "src", "generated", "sqlite-client"), to: path.join(target, "sqlite-client"), label: "SQLite Prisma client" },
  { from: path.join(root, "prisma", "sqlite", "init.sql"), to: path.join(target, "sqlite-init.sql"), label: "SQLite init script" },
];

for (const { from, to, label } of copies) {
  if (!fs.existsSync(from)) {
    console.error(`copy-prisma-client: ${path.relative(root, from)} is missing. Run "npm run db:generate" first.`);
    process.exit(1);
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`Copied ${label} to ${path.relative(root, to)}`);
}
