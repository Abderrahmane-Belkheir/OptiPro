// Inserts (or, with --drop, removes) sample brands, frames, accessories and customers through the
// running API, as the tenant whose key is given — the same /api/tables/:table routes a real client
// uses, so it needs the server up and nothing else: it never connects to the database itself.
//
//   npm run seed                      insert, as key "maison-clair" against http://localhost:4000
//   npm run seed:drop                 delete exactly the rows the seed inserts
//   npm run seed -- some-other-key    a different tenant's key (also: npm run seed:drop -- <key>)
//   API_URL=https://example.com npm run seed
//
// Safe to run again: rows already there are skipped (or, when dropping, ones already gone are).
// Brands are matched by name — their id is a database serial the client can't choose — and
// everything else by a fixed id. Frames need a brand and a category: brands are looked up after
// they're inserted, and categories must already exist (the API can't create them).

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const args = process.argv.slice(2);
const DROP = args.includes('--drop');
const TENANT_KEY = args.find((arg) => !arg.startsWith('--')) ?? process.env.TENANT_KEY ?? 'maison-clair';

const photo = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

const brands = ['Ray-Ban', 'Oakley', 'Gucci', 'Prada'];

// `brand` and `category` are names; they're swapped for ids when inserting. Colors and shapes use
// the names the website knows (src/i18n/colorSwatches.ts, types/frame.ts); the two with a local
// /images path are served by this backend from public/images/frames/.
const frames = [
  { id: 'frm-rb-opt-1', name: 'Round Crystal Acetate', brand: 'Ray-Ban', category: 'Optical Frames', price: 169, shape: 'round', colors: ['Crystal', 'Black'], images: [photo('1511499767150-a48a237f0083')], stock: 12 },
  { id: 'frm-rb-opt-2', name: 'Browline Heritage', brand: 'Ray-Ban', category: 'Optical Frames', price: 179, shape: 'browline', colors: ['Havana'], images: [photo('1600850056064-a8b380df8395')], stock: 8 },
  { id: 'frm-rb-sun-1', name: 'Classic Aviator', brand: 'Ray-Ban', category: 'Sunglasses', price: 189, shape: 'aviator', colors: ['Gold', 'Green G-15'], images: [photo('1574258495973-f010dfbb5371')], stock: 20 },
  { id: 'frm-rb-sun-2', name: 'Original Wayfarer', brand: 'Ray-Ban', category: 'Sunglasses', price: 209, shape: 'wayfarer', colors: ['Black', 'Tortoise'], images: ['/images/frames/wayfarer.svg'], stock: 15 },
  { id: 'frm-rb-kid-1', name: 'Junior Round', brand: 'Ray-Ban', category: 'Kids', price: 89, shape: 'round', colors: ['Sky Blue'], images: [photo('1600091166971-7f9faad6c1e2')], stock: 15 },
  { id: 'frm-rb-kid-2', name: 'Junior Round Bold', brand: 'Ray-Ban', category: 'Kids', price: 92, shape: 'round', colors: ['Amber'], images: ['/images/frames/kids-round.svg'], stock: 0 },
  { id: 'frm-oak-opt-1', name: 'Rectangle Sport Frame', brand: 'Oakley', category: 'Optical Frames', price: 199, shape: 'rectangle', colors: ['Black', 'Grey'], images: [photo('1556306535-0f09a537f0a3')], stock: 10 },
  { id: 'frm-oak-sun-1', name: 'Sport Wrap', brand: 'Oakley', category: 'Sunglasses', price: 219, shape: 'wayfarer', colors: ['Matte Black', 'Teal'], images: [photo('1508296695146-257a814070b4')], stock: 18 },
  { id: 'frm-gu-opt-1', name: 'Round Tortoise', brand: 'Gucci', category: 'Optical Frames', price: 349, shape: 'round', colors: ['Tortoise'], images: [photo('1577803645773-f96470509666')], stock: 6 },
  { id: 'frm-gu-sun-1', name: 'Cat-Eye Statement', brand: 'Gucci', category: 'Sunglasses', price: 379, shape: 'cat-eye', colors: ['Black', 'Gold'], images: [photo('1609902726285-00668009f004')], stock: 9 },
  { id: 'frm-pr-opt-1', name: 'Square Acetate', brand: 'Prada', category: 'Optical Frames', price: 329, shape: 'square', colors: ['Black'], images: [photo('1591076482161-42ce6da69f67')], stock: 11 },
  { id: 'frm-pr-sun-1', name: 'Oversized Statement', brand: 'Prada', category: 'Sunglasses', price: 399, shape: 'oversized', colors: ['Satin Black'], images: [photo('1572635196237-14b3f281503f')], stock: 7 },
].map((frame) => ({ currency: 'USD', ...frame }));

// Ids match the French labels in website/src/i18n/accessoryLabels.ts; images are served by the
// backend itself from public/images/accessories/.
const accessories = [
  { id: 'acc-case-1', name: 'Acetate Hard Case', description: 'Molded protection lined in microfiber, sized for most frames.', price: 45, currency: 'USD', images: ['/images/accessories/case.svg'], stock: 14 },
  { id: 'acc-case-2', name: 'Slim Travel Case', description: 'A flatter profile that slips into a jacket pocket or bag.', price: 32, currency: 'USD', images: ['/images/accessories/case.svg'], stock: 9 },
  { id: 'acc-cloth-1', name: 'Microfiber Cloth', description: 'Lint-free cloth, safe on coated and polarized lenses.', price: 12, currency: 'USD', images: ['/images/accessories/cloth.svg'], stock: 60 },
  { id: 'acc-cloth-2', name: 'Three-Cloth Set', description: 'Three cloths in a linen pouch, one each for home, work and travel.', price: 24, currency: 'USD', images: ['/images/accessories/cloth.svg'], stock: 22 },
  { id: 'acc-chain-1', name: 'Beaded Chain', description: 'Hand-strung brass beads to keep your sunglasses within reach.', price: 38, currency: 'USD', images: ['/images/accessories/chain.svg'], stock: 6 },
  { id: 'acc-chain-2', name: 'Leather Cord', description: 'A slim leather cord for all-day frames.', price: 28, currency: 'USD', images: ['/images/accessories/chain.svg'], stock: 11 },
  { id: 'acc-kit-1', name: 'Repair Kit', description: 'Spare screws, a precision screwdriver and nose pads in a tin case.', price: 18, currency: 'USD', images: ['/images/accessories/repair-kit.svg'], stock: 0 },
];

// Made-up people: fake numbers and example.com addresses.
const customers = [
  { id: 'seed-customer-1', name: 'Camille Laurent', phone: '+33 6 00 00 00 01', email: 'camille.laurent@example.com', address: 'Paris 75011', notes: 'Prefers lightweight acetate frames.' },
  { id: 'seed-customer-2', name: 'Mehdi Benali', phone: '+33 6 00 00 00 02', email: 'mehdi.benali@example.com', address: 'Paris 75003', notes: 'Varifocal lenses; annual check-up each spring.' },
  { id: 'seed-customer-3', name: 'Sofia Marchetti', phone: '+33 6 00 00 00 03', email: 'sofia.marchetti@example.com', address: 'Lyon 69002', notes: null },
  { id: 'seed-customer-4', name: 'Julien Moreau', phone: '+33 6 00 00 00 04', email: null, address: null, notes: 'Walk-in. Contact lenses and sunglasses.' },
  { id: 'seed-customer-5', name: 'Inès Haddad', phone: null, email: 'ines.haddad@example.com', address: 'Marseille 13006', notes: 'Kids frames for two children.' },
];

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: TENANT_KEY, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Cannot reach ${API_URL} (${err.cause?.code ?? err.message}). Is the backend running? The API also rejects requests addressed to a bare IP — use a hostname such as localhost.`);
  }
  const payload = await res.json().catch(() => null); // a 204 has no body
  if (!res.ok) {
    throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${payload?.error ?? res.statusText}`), { status: res.status });
  }
  return payload;
}

const list = (table) => api('GET', `/api/tables/${table}`);
const idsByName = (rows) => new Map(rows.map((row) => [row.name, row.id]));
const report = (table, done, skipped, verb) =>
  console.log(`${table.padEnd(12)} ${verb} ${done}, already ${verb === 'inserted' ? 'there' : 'gone'} ${skipped}`);

// Rows with a fixed id (frames, accessories, customers).
async function seedById(table, rows) {
  const existing = new Set((await list(table)).map((row) => row.id));
  const missing = rows.filter((row) => !existing.has(row.id));
  if (missing.length) await api('POST', `/api/tables/${table}`, missing);
  report(table, missing.length, rows.length - missing.length, 'inserted');
}

async function dropById(table, rows) {
  const existing = new Set((await list(table)).map((row) => row.id));
  const present = rows.filter((row) => existing.has(row.id));
  for (const row of present) await api('DELETE', `/api/tables/${table}/${encodeURIComponent(row.id)}`);
  report(table, present.length, rows.length - present.length, 'deleted');
}

// brands.id is a serial the client can't set, so brands go in by name and are matched by name.
async function seedBrands() {
  const existing = new Set((await list('brands')).map((brand) => brand.name));
  const missing = brands.filter((name) => !existing.has(name));
  if (missing.length) await api('POST', '/api/tables/brands', missing.map((name) => ({ name })));
  report('brands', missing.length, brands.length - missing.length, 'inserted');
}

async function dropBrands() {
  const existing = idsByName(await list('brands'));
  let deleted = 0;
  const stillUsed = [];
  for (const name of brands.filter((brand) => existing.has(brand))) {
    try {
      await api('DELETE', `/api/tables/brands/${existing.get(name)}`);
      deleted++;
    } catch (err) {
      if (err.status !== 409) throw err;
      stillUsed.push(name); // frames this script didn't insert still point at it
    }
  }
  report('brands', deleted, brands.length - deleted - stillUsed.length, 'deleted');
  if (stillUsed.length) console.log(`             kept ${stillUsed.join(', ')}: still used by frames this script didn't insert`);
}

async function seedFrames() {
  const brandIds = idsByName(await list('brands'));
  const categoryIds = idsByName(await list('categories'));
  const lookup = (map, name, what) => {
    if (!map.has(name)) throw new Error(`No ${what} named "${name}" for this tenant.${what === 'category' ? " Categories can't be created through the API — add it in the database." : ''}`);
    return map.get(name);
  };

  const existing = new Set((await list('frames')).map((frame) => frame.id));
  const missing = frames.filter((frame) => !existing.has(frame.id));
  const rows = missing.map(({ brand, category, ...frame }) => ({
    ...frame,
    brandId: lookup(brandIds, brand, 'brand'),
    categoryId: lookup(categoryIds, category, 'category'),
  }));
  if (rows.length) await api('POST', '/api/tables/frames', rows);
  report('frames', rows.length, frames.length - rows.length, 'inserted');
}

console.log(`${DROP ? 'Dropping the seed rows from' : 'Seeding'} ${API_URL} as tenant key "${TENANT_KEY}"`);
try {
  if (DROP) {
    // Reverse of insertion order: a brand can't go while a frame still points at it.
    await dropById('customers', customers);
    await dropById('accessories', accessories);
    await dropById('frames', frames);
    await dropBrands();
  } else {
    await seedBrands();
    await seedFrames();
    await seedById('accessories', accessories);
    await seedById('customers', customers);
  }
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
