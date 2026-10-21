// Run before packaging: stops the build with a clear message when something the installed app needs is missing.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const problems = [];

// (No settings are built into the installer: a new installation starts on the setup page.)
for (const needed of ["dist/main.js", "dist/preload.js", "dist/generated/sqlite-init.sql", "dist/generated/sqlite-client", "renderer/index.html", "renderer/setup.html"]) {
  if (!fs.existsSync(path.join(root, needed))) problems.push(`${needed} is missing: run "npm run build" first.`);
}

if (problems.length > 0) {
  console.error("Cannot package the app:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("check-package: everything the installed app needs is there.");
