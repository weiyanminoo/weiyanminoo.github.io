import { PNG } from 'pngjs';
import fs from 'node:fs';

const [, , inPath, outPath, x, y, w, h] = process.argv;
const src = PNG.sync.read(fs.readFileSync(inPath));
const X = parseInt(x, 10), Y = parseInt(y, 10), W = parseInt(w, 10), H = parseInt(h, 10);
const dst = new PNG({ width: W, height: H });
PNG.bitblt(src, dst, X, Y, W, H, 0, 0);
fs.writeFileSync(outPath, PNG.sync.write(dst));
console.log(`cropped ${inPath} [${X},${Y},${W},${H}] -> ${outPath}`);
