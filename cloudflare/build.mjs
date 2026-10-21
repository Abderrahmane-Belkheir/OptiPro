// Builds dist/: the folder that is uploaded to Cloudflare Pages.
//
//   dist/                      the website's static files (copied from ../website/dist; run `npm run build:site` to rebuild it first)
//   dist/_worker.js            the API (src/index.js and everything it imports, with the Neon driver, in ONE file)
//   dist/_routes.json          only /api/* runs the Worker; the static files are served by Pages without running any code
//   dist/_headers              how long browsers keep the static files
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const siteDir = path.resolve(here, process.env.SITE_DIR ?? '../website/dist');
const extraStatic = [path.resolve(here, '../backend/public')]; // older sample photos (/images/frames/..., /images/accessories/...), added when the website does not have the file

if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
  console.error(`The website is not built: ${siteDir}/index.html is missing.\nRun "npm run build:site" (it builds ../website first), or set SITE_DIR to a folder that holds the built site.`);
  process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// 1. static files (the website first; the extra folders never overwrite a file the website has)
fs.cpSync(siteDir, dist, { recursive: true });
for (const dir of extraStatic) {
  if (fs.existsSync(dir)) fs.cpSync(dir, dist, { recursive: true, force: false, errorOnExist: false });
}

// 2. the Worker
const result = await build({
  entryPoints: [path.join(here, 'src/index.js')],
  outfile: path.join(dist, '_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});

// 3. Pages' own files
fs.writeFileSync(path.join(dist, '_routes.json'), JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2) + '\n');
fs.writeFileSync(
  path.join(dist, '_headers'),
  ['/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '', '/images/*', '  Cache-Control: public, max-age=86400', ''].join('\n'),
);

const size = (file) => `${(fs.statSync(file).size / 1024).toFixed(0)} KB`;
const count = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
console.log(`dist/ is ready: ${count(dist)} files; _worker.js ${size(path.join(dist, '_worker.js'))} (${Object.keys(result.metafile.inputs).length} modules bundled).`);
console.log('Upload it with:  npx wrangler pages deploy dist   (or drag the dist folder into the Pages dashboard).');
