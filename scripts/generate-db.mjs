// Regenerates everything derived from prisma/sqlite/schema.prisma, so the schema is the only file
// to edit and nothing has to be remembered or run by hand:
//   1. the Prisma client      -> src/generated/sqlite-client   (git-ignored)
//   2. the CREATE TABLE SQL   -> prisma/sqlite/init.sql        (git-ignored; the app runs it on start)
// Runs automatically before every `npm run build`; run it alone with `npm run db:generate`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const schema = "prisma/sqlite/schema.prisma";
const config = "prisma/sqlite/prisma.config.ts";
const initSql = path.join(root, "prisma", "sqlite", "init.sql");

// Run the Prisma CLI with the current Node instead of through npx/.cmd shims: same on every OS.
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const prisma = (args, options = {}) =>
  execFileSync(process.execPath, [prismaCli, ...args], { cwd: root, encoding: "utf8", ...options });

function fail(message) {
  console.error(`\ngenerate-db: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(root, schema))) fail(`${schema} not found.`);

console.log("generate-db: validating the schema and generating the Prisma client…");
try {
  prisma(["generate", "--schema", schema], { stdio: ["ignore", "inherit", "inherit"] });
} catch {
  fail("prisma generate failed (see the output above).");
}

console.log("generate-db: generating prisma/sqlite/init.sql…");
let sql;
try {
  sql = prisma(["migrate", "diff", "--from-empty", "--to-schema", schema, "--config", config, "--script"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  fail(`prisma migrate diff failed:\n${err.stderr || err.message}`);
}

// Never leave a wrong file behind: the SQL must create exactly one table per model in the schema.
const models = [...fs.readFileSync(path.join(root, schema), "utf8").matchAll(/^model \w+ \{/gm)].length;
const tables = [...sql.matchAll(/^CREATE TABLE "/gm)].length;
if (!models || tables !== models) fail(`expected ${models} CREATE TABLE statements, the generated SQL has ${tables}. init.sql was not written.`);

fs.writeFileSync(`${initSql}.tmp`, sql);
fs.renameSync(`${initSql}.tmp`, initSql);
console.log(`generate-db: wrote prisma/sqlite/init.sql (${tables} tables).`);
