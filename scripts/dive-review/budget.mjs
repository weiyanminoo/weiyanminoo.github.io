#!/usr/bin/env node
// JS budget for the landing (spec §11: Three.js + loaders + Lenis + the
// dive ≤ 300 KB gzip). Reads every module script and modulepreload the
// built dist/index.html references, gzips each, and fails over budget.
// Assumes `npm run build` has produced dist/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../../dist');
const BUDGET_KB = 300;

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const refs = new Set();
for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) refs.add(m[1]);
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) refs.add(m[1]);

let total = 0;
for (const ref of refs) {
  const file = path.join(dist, ref.replace(/^\//, ''));
  const kb = gzipSync(fs.readFileSync(file)).length / 1024;
  total += kb;
  console.log(`  ${kb.toFixed(1).padStart(7)} KB gz  ${ref}`);
}
const ok = total <= BUDGET_KB;
console.log(`${ok ? 'ok  ' : 'FAIL'}  total ${total.toFixed(1)} KB gz across ${refs.size} file(s) (budget ${BUDGET_KB} KB)`);
process.exitCode = ok && refs.size > 0 ? 0 : 1;
