#!/usr/bin/env node
// Builds the dive's footage from Wei Yan's raw clips (spec §8): trim,
// stabilise, baseline grade, seamless loop, encode per rendition, poster
// still, and the ambience bed. Local only — CI never runs this; the outputs
// in public/dive/ are committed.
//
// Usage: node scripts/footage/build.mjs --src <absolute path to dive_videos>
// ffmpeg from $FFMPEG, else `ffmpeg` on PATH.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BED, CLIPS, DENOISE, FPS, GRADE, RENDITIONS } from './clips.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const srcIndex = process.argv.indexOf('--src');
if (srcIndex < 0 || !process.argv[srcIndex + 1]) {
  console.error('usage: node scripts/footage/build.mjs --src <absolute path to dive_videos>');
  process.exit(2);
}
const src = path.resolve(process.argv[srcIndex + 1]);
const work = path.join(repoRoot, '.scratch', 'footage-build');
const outVideo = path.join(repoRoot, 'public', 'dive', 'footage');
const outAudio = path.join(repoRoot, 'public', 'dive', 'audio');
for (const dir of [work, outVideo, outAudio]) fs.mkdirSync(dir, { recursive: true });

// Runs ffmpeg in `cwd`. Filter arguments use bare file names relative to
// it: a Windows drive letter's colon breaks ffmpeg's filter-graph parser.
function ffmpeg(args, cwd = work) {
  console.log(`  ffmpeg ${args.join(' ')}`);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status})`);
}

// The last second crossfades into the first, so the clip loops without a
// jump while a section is held on: output length is duration − 1 and its
// final frame is the frame its first frame follows on from.
const loopFilter = (d) =>
  `split[m][h];[m]trim=start=1:end=${d},setpts=PTS-STARTPTS[main];` +
  `[h]trim=start=0:end=1,setpts=PTS-STARTPTS[head];` +
  `[main][head]xfade=transition=fade:duration=1:offset=${d - 2}`;

for (const clip of CLIPS) {
  console.log(`\n${clip.id}`);
  const trim = `${clip.id}-trim.mp4`;
  ffmpeg(['-ss', String(clip.start), '-t', String(clip.duration), '-i', path.join(src, clip.file), '-an', '-vf', `fps=${FPS}`, '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', trim]);

  let base = trim;
  if (clip.stabilise) {
    ffmpeg(['-i', trim, '-vf', `vidstabdetect=shakiness=6:accuracy=12:result=${clip.id}.trf`, '-f', 'null', '-']);
    base = `${clip.id}-stab.mp4`;
    ffmpeg(['-i', trim, '-vf', `vidstabtransform=input=${clip.id}.trf:smoothing=30:zoom=8,unsharp=5:5:0.5`, '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', base]);
  }

  const graded = `${clip.id}-graded.mp4`;
  ffmpeg(['-i', base, '-filter_complex', `[0:v]${DENOISE},${GRADE},${loopFilter(clip.duration)}`, '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', graded]);

  for (const r of RENDITIONS) {
    ffmpeg([
      '-i', graded,
      '-vf', `scale=-2:${r.height}`,
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', String(r.crf),
      '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
      path.join(outVideo, `${clip.id}-${r.name}.mp4`),
    ]);
  }
  ffmpeg(['-ss', String((clip.duration - 1) / 2), '-i', graded, '-frames:v', '1', '-vf', 'scale=-2:720', '-q:v', '3', path.join(outVideo, `${clip.id}-poster.jpg`)]);
}

console.log('\nbed');
ffmpeg([
  '-ss', String(BED.start), '-t', String(BED.duration), '-i', path.join(src, BED.file), '-vn',
  '-filter_complex',
  `[0:a]lowpass=f=800,asplit[m][h];[m]atrim=start=1,asetpts=PTS-STARTPTS[main];` +
    `[h]atrim=start=0:end=1,asetpts=PTS-STARTPTS[head];[main][head]acrossfade=d=1`,
  '-c:a', 'aac', '-b:a', '64k', '-ac', '2',
  path.join(outAudio, 'bed.m4a'),
]);
console.log('\ndone');
