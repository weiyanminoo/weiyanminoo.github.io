import { readFileSync } from 'node:fs';
const src = readFileSync('.scratch/solve-intensity.mjs', 'utf8');
const head = src.split('// Current shipped values')[0];
const mod = await import('data:text/javascript;base64,' + Buffer.from(head + `
export { colourAtDepth, ramp, snowGate, shoalGate, bubbleGate, contrastRatio, waterPlusEffects, over, sweep, INK, ON_DEEP, FOAM_RGB, DEEP_RGB };
`).toString('base64'));
const { waterPlusEffects, over, sweep, INK, ON_DEEP, FOAM_RGB, DEEP_RGB } = mod;

const CONTENT_LIGHT = 0.66; // min(entry .72, project .66)
function model(I, deepCard, headerCard) {
  return {
    contentLight: sweep(0, 19, INK, (d) => over(waterPlusEffects(d, I), FOAM_RGB, CONTENT_LIGHT)),
    contentDeep: sweep(24, 32, ON_DEEP, (d) => over(waterPlusEffects(d, I), DEEP_RGB, deepCard)),
    headerLight: sweep(0, 19, [INK[0]], (d) => over(waterPlusEffects(d, I), FOAM_RGB, headerCard)),
    headerDeep: sweep(24, 32, [ON_DEEP[0]], (d) => over(waterPlusEffects(d, I), DEEP_RGB, headerCard)),
    bareLight: sweep(0, 19, [INK[0]], (d) => waterPlusEffects(d, I)),
    bareDeep: sweep(24, 32, [ON_DEEP[0]], (d) => waterPlusEffects(d, I)),
  };
}
function show(label, I, deepCard, headerCard) {
  const m = model(I, deepCard, headerCard);
  console.log(`\n${label}  snow=${I.snow} shoal=${I.shoal} bubbles=${I.bubbles} deepCard=${deepCard} headerCard=${headerCard}`);
  for (const [k, v] of Object.entries(m)) {
    const need = k.startsWith('bare') ? 3.0 : 4.5;
    const flag = v.worst >= need ? 'ok ' : 'FAIL';
    console.log(`   ${flag} ${k.padEnd(13)} ${v.worst.toFixed(3)} @${v.at}m tok${v.tok} (need ${need})`);
  }
}
show('CURRENT ', { snow: 0.31, shoal: 0.35, bubbles: 0.26 }, 0.62, 0.62);
for (const dc of [0.66, 0.70, 0.72, 0.76]) {
  let maxSnow = 0;
  for (let s = 0.005; s <= 1.0001; s += 0.005) {
    const m = model({ snow: s, shoal: 0.35, bubbles: 0.5 }, dc, 0.62);
    const good = Object.entries(m).every(([k, v]) => v.worst >= (k.startsWith('bare') ? 3.0 : 4.5));
    if (good) maxSnow = s; else break;
  }
  console.log(`\ndeepCard ${dc}: max snow ${maxSnow.toFixed(3)} (bubbles .5, header .62)`);
}
let maxB = 0;
for (let b = 0.005; b <= 1.0001; b += 0.005) {
  const m = model({ snow: 0.38, shoal: 0.35, bubbles: b }, 0.72, 0.62);
  const good = Object.entries(m).every(([k, v]) => v.worst >= (k.startsWith('bare') ? 3.0 : 4.5));
  if (good) maxB = b; else break;
}
console.log(`\nmax bubbles ${maxB.toFixed(3)} (snow .38, deepCard .72, header .62)`);
show('PICK    ', { snow: 0.38, shoal: 0.35, bubbles: 0.5 }, 0.72, 0.62);
show('PICK-B  ', { snow: 0.36, shoal: 0.35, bubbles: 0.48 }, 0.72, 0.62);
