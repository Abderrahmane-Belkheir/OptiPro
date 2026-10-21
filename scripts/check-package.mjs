// Run before packaging: stops the build with a clear message when something the installed app needs is missing.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const problems = [];

// The settings built into the app (resources/default-config.properties) go into the installer, so it must hold a tenant.key.
const defaults = path.join(root, "resources", "default-config.properties");
if (!fs.existsSync(defaults)) {
  problems.push("resources/default-config.properties is missing. Copy resources/default-config.example.properties to it and fill it in:\n  without it, an installed app that finds no config.properties cannot start.");
} else {
  const text = fs.readFileSync(defaults, "utf8");
  if (!/^\s*tenant\.key\s*=\s*\S+/m.test(text)) problems.push("resources/default-config.properties has no tenant.key.");
  if (!/^\s*server\.url\s*=\s*\S+/m.test(text)) console.warn("note: resources/default-config.properties has an empty server.url (photo uploads will need it).");
}

for (const needed of ["dist/main.js", "dist/preload.js", "dist/generated/sqlite-init.sql", "dist/generated/sqlite-client", "renderer/index.html"]) {
  if (!fs.existsSync(path.join(root, needed))) problems.push(`${needed} is missing: run "npm run build" first.`);
}

if (problems.length > 0) {
  console.error("Cannot package the app:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("check-package: everything the installed app needs is there.");
