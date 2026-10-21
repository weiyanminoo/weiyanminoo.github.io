// Re-encodes the reef's rock photographs (Poly Haven, CC0) into
// public/dive/textures, small enough to ship, and prints each colour map's
// mean linear colour for reef.ts (the shader divides by it).
//
// Download the 1K JPGs of mossy_rock and coral_ground_02 (the diff and
// nor_gl maps) from https://polyhaven.com into a folder, then:
//
//   node scripts/dive-textures.mjs <that folder>
//
// Needs ffmpeg on the PATH. Colour goes to WebP; the normal maps to JPEG at
// half size with full-resolution chroma, since WebP halves the chroma and
// the normal's x and y ride in it.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [src] = process.argv.slice(2);
if (!src) {
  console.error('usage: node scripts/dive-textures.mjs <folder of Poly Haven 1K JPGs>');
  process.exit(1);
}
const OUT = 'public/dive/textures';
const SETS = [
  ['mossy_rock', 'crust'],
  ['coral_ground_02', 'rubble'],
];

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

fs.mkdirSync(OUT, { recursive: true });
for (const [id, name] of SETS) {
  const colour = path.join(src, `${id}_diff_1k.jpg`);
  const normal = path.join(src, `${id}_nor_gl_1k.jpg`);
  ffmpeg('-i', colour, '-c:v', 'libwebp', '-quality', '78', path.join(OUT, `${name}.webp`));
  ffmpeg('-i', normal, '-vf', 'scale=512:512', '-pix_fmt', 'yuvj444p', '-q:v', '3', path.join(OUT, `${name}-normal.jpg`));
  const raw = ffmpeg('-i', colour, '-vf', 'scale=256:256', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-');
  const sum = [0, 0, 0];
  for (let i = 0; i < raw.length; i += 3) for (let k = 0; k < 3; k++) sum[k] += linear(raw[i + k] / 255);
  const mean = sum.map((s) => (s / (raw.length / 3)).toFixed(3));
  console.log(`${name}: mean [${mean.join(', ')}]`);
}
