#!/usr/bin/env node
// Checks the built footage against spec §8 and the plan's budgets. Exits
// non-zero on any failure.
//
//   no audio track in any video          (sound comes from audio.ts)
//   duration = clip duration − 1 ± 0.1 s (the loop crossfade)
//   a keyframe at least every second     (fast seeks in review mode)
//   720 files ≤ 4 MB total, 540 ≤ 2 MB   (desktop / mobile budgets)
//   poster mid-band hue 190–220°         (graded into the reference blue)
//
// ffprobe/ffmpeg from $FFPROBE / $FFMPEG, else on PATH.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIPS, RENDITIONS } from './clips.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(__dirname, '../../public/dive/footage');
const FFPROBE = process.env.FFPROBE ?? 'ffprobe';
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const BUDGET = { 720: 4 * 1024 * 1024, 540: 2 * 1024 * 1024 };
const HUE = [190, 220];

let failed = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${msg}`);
  if (!ok) failed++;
};

const run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`);
  return r.stdout;
};

function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

const totals = { 720: 0, 540: 0 };
for (const clip of CLIPS) {
  for (const r of RENDITIONS) {
    const file = path.join(dir, `${clip.id}-${r.name}.mp4`);
    const info = JSON.parse(run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]).toString());
    const name = path.basename(file);
    check(!info.streams.some((s) => s.codec_type === 'audio'), `${name}: no audio track`);
    const duration = Number(info.format.duration);
    check(Math.abs(duration - (clip.duration - 1)) <= 0.1, `${name}: ${duration.toFixed(2)} s (expect ${clip.duration - 1})`);
    const keys = run(FFPROBE, ['-v', 'error', '-select_streams', 'v', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file])
      .toString()
      .trim()
      .split(/\s+/)
      // ffprobe's csv can carry a trailing comma on a line.
      .map((line) => parseFloat(line));
    const gap = Math.max(...keys.slice(1).map((t, i) => t - keys[i]), duration - keys[keys.length - 1]);
    check(gap <= 1.01, `${name}: longest keyframe gap ${gap.toFixed(2)} s`);
    totals[r.name] += fs.statSync(file).size;
  }
  const poster = path.join(dir, `${clip.id}-poster.jpg`);
  // Mean colour of the middle fifth of the frame, via a 1×1 scale.
  const rgb = [...run(FFMPEG, ['-v', 'error', '-i', poster, '-vf', 'crop=iw:ih*0.2:0:ih*0.4,scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
  const hue = hueOf(rgb);
  check(hue >= HUE[0] && hue <= HUE[1], `${clip.id}-poster.jpg: mid-band rgb(${rgb.join(',')}) hue ${hue.toFixed(0)}° (want ${HUE[0]}–${HUE[1]}°)`);
}
for (const [name, bytes] of Object.entries(totals)) {
  check(bytes <= BUDGET[name], `${name} total ${(bytes / 1024 / 1024).toFixed(2)} MB (budget ${BUDGET[name] / 1024 / 1024} MB)`);
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll footage checks passed.');
process.exitCode = failed ? 1 : 0;
