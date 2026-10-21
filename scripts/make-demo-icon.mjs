// Draws the DEMO icon (a pair of glasses on a dark rounded square) into build/icon.png and build/icon.ico.
// It is only a placeholder. To use your own icon, just replace those two files (see build/README.md) and run `npm run dist`;
// you do not need this script then, and can delete it.
//
//   node scripts/make-demo-icon.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build");

const BACKGROUND = [0x15, 0x13, 0x0f]; // --color-ink
const FRAME = [0xd9, 0xc0, 0x9a]; // --color-brass-soft
const SAMPLES = 4; // 4 x 4 samples per pixel, for smooth edges

/** Fraction (0..1) of the point (x, y) of the unit square [0,1]² that is inside the glasses' strokes. */
function inGlasses(x, y) {
  const r = 0.155; // lens radius
  const t = 0.05; // stroke thickness
  const cy = 0.5;
  const lens = [0.31, 0.69];
  for (const cx of lens) if (Math.abs(Math.hypot(x - cx, y - cy) - r) <= t / 2) return true;
  // the bridge between the lenses: a short arc
  const a = lens[0] + r, b = lens[1] - r;
  if (x >= a - t / 2 && x <= b + t / 2) {
    const u = (x - (a + b) / 2) / ((b - a) / 2);
    if (Math.abs(y - (cy - 0.035 * (1 - u * u))) <= t / 2) return true;
  }
  // the temples: short arms leaving the outer side of each lens
  for (const [x0, dir] of [[lens[0] - r, -1], [lens[1] + r, 1]]) {
    const x1 = x0 + dir * 0.09;
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    if (x >= lo && x <= hi && Math.abs(y - (cy - 0.01)) <= t / 2) return true;
  }
  return false;
}

/** True when the point is inside a square with rounded corners filling the unit square. */
function inBackground(x, y) {
  const radius = 0.22;
  const dx = Math.max(radius - x, 0, x - (1 - radius));
  const dy = Math.max(radius - y, 0, y - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

/** RGBA pixels of the icon at `size` x `size`. */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (inBackground(x, y)) {
            bg++;
            if (inGlasses(x, y)) fg++;
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      const alpha = bg / total;
      const mix = bg ? fg / bg : 0;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) pixels[o + c] = Math.round(BACKGROUND[c] * (1 - mix) + FRAME[c] * mix);
      pixels[o + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A PNG file (8-bit RGBA) of the icon at `size`. */
function png(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const pixels = render(size);
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); // filter byte 0 at the start of each row
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** A Windows .ico holding one PNG image per size. */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, data: png(size) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 means 256
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([head, ...entries, ...images.map((i) => i.data)]);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon.png"), png(512));
fs.writeFileSync(path.join(out, "icon.ico"), ico([16, 24, 32, 48, 64, 128, 256]));
console.log("Wrote build/icon.png (512x512) and build/icon.ico (16, 24, 32, 48, 64, 128, 256).");
