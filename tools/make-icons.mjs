#!/usr/bin/env node
// Draws the app icons as PNG files with no dependencies (Node's zlib only):
// a forest-sage tile with three rising cream bars and an amber coin.
//   node tools/make-icons.mjs        writes icons/*.png

import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SAGE = [45, 106, 79];
const CREAM = [244, 238, 227];
const AMBER = [224, 168, 79];

// ---------- shapes (coordinates are 0..1 across the icon) ----------

function roundedRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r && u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

const circle = (u, v, cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 <= r * r;

/** The glyph, drawn inside a box (scale around the centre). */
function glyph(u, v, scale) {
  const x = (u - 0.5) / scale + 0.5;
  const y = (v - 0.5) / scale + 0.5;
  const bars = [
    [0.2, 0.56],
    [0.415, 0.42],
    [0.63, 0.27],
  ];
  for (const [left, top] of bars) {
    if (roundedRect(x, y, left, top, left + 0.17, 0.8, 0.045)) return CREAM;
  }
  if (circle(x, y, 0.285, 0.36, 0.085)) return AMBER;
  return null;
}

/** RGBA of one sample. variant: 'any' (rounded, transparent corners), 'maskable' (full bleed), 'opaque'. */
function sample(u, v, variant) {
  const full = variant !== 'any';
  const inTile = full || roundedRect(u, v, 0, 0, 1, 1, 0.22);
  if (!inTile) return [0, 0, 0, 0];
  const g = glyph(u, v, variant === 'maskable' ? 0.72 : 0.92);
  return [...(g ?? SAGE), 255];
}

function render(size, variant) {
  const SS = 4; // 4x4 supersampling for smooth edges
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const s = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, variant);
          acc[0] += s[0] * s[3];
          acc[1] += s[1] * s[3];
          acc[2] += s[2] * s[3];
          acc[3] += s[3];
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const a = acc[3];
      rows[o] = a ? Math.round(acc[0] / a) : 0;
      rows[o + 1] = a ? Math.round(acc[1] / a) : 0;
      rows[o + 2] = a ? Math.round(acc[2] / a) : 0;
      rows[o + 3] = Math.round(a / (SS * SS));
    }
  }
  return png(size, size, rows);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(w, h, rows) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
const outputs = [
  ['icons/icon-192.png', 192, 'any'],
  ['icons/icon-512.png', 512, 'any'],
  ['icons/maskable-512.png', 512, 'maskable'],
  ['icons/apple-touch-icon-180.png', 180, 'opaque'],
];
for (const [file, size, variant] of outputs) {
  writeFileSync(file, render(size, variant));
  console.log(`wrote ${file}`);
}
