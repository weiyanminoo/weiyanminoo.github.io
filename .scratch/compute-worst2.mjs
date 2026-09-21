import { snowAlphaAt } from '../src/scripts/water/effects/snow.ts';
import { shoalAlphaAt } from '../src/scripts/water/effects/shoal.ts';
import { bubbleAlphaAt } from '../src/scripts/water/effects/bubbles.ts';
import { CONTENT_SCRIM_OPACITY, INTENSITY } from '../src/scripts/water/effects/intensity.ts';
import { colourAtDepth } from '../src/scripts/water/palette.ts';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return [r, g, b];
}
function relativeLuminance([r, g, b]) {
  const lin = (c) => { const s = c/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
  const [R,G,B] = [r,g,b].map(lin);
  return 0.2126*R + 0.7152*G + 0.0722*B;
}
function contrastRatio(a,b){
  const [l1,l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x,y)=>y-x);
  return (l1+0.05)/(l2+0.05);
}
function compositeOver(base, colour, alpha) {
  return [0,1,2].map(i => base[i]*(1-alpha) + colour[i]*alpha);
}
const SNOW_RGB=[255,255,255], DARK=[40,72,88];
function waterPlusEffectsAt(d){
  let colour = colourAtDepth(d);
  const s = snowAlphaAt(d); if (s>0) colour = compositeOver(colour, SNOW_RGB, s);
  const sh = shoalAlphaAt(d); if (sh>0) colour = compositeOver(colour, DARK, sh);
  const b = bubbleAlphaAt(d); if (b>0) colour = compositeOver(colour, DARK, b);
  return colour;
}
function stackedColourAt(d, tint){ return compositeOver(waterPlusEffectsAt(d), tint, CONTENT_SCRIM_OPACITY); }

const FOAM=[246,249,249], DEEP=[27,74,92];
const INK_TOKENS = [hexToRgb('#0B2A3A'), hexToRgb('#31535E'), hexToRgb('#27454F')];
const ON_DEEP_TOKENS = [hexToRgb('#EAF4F6'), hexToRgb('#B8D6DC'), hexToRgb('#AECDD4')];
const NAMES_INK = ['--ink','--ink-2','--ink-3'];
const NAMES_DEEP = ['--on-deep','--on-deep-2','--on-deep-3'];

console.log('INTENSITY =', INTENSITY);
console.log('CONTENT_SCRIM_OPACITY =', CONTENT_SCRIM_OPACITY);

let worst=Infinity, wd=-1, wt='';
for (let i=0;i<=19/0.25;i++){ const d=i*0.25; const c=stackedColourAt(d,FOAM);
  INK_TOKENS.forEach((tok,idx)=>{ const r=contrastRatio(c,tok); if(r<worst){worst=r;wd=d;wt=NAMES_INK[idx];} }); }
console.log(`INK zone (0-19m) worst: ${worst.toFixed(4)}:1 at ${wd}m against ${wt}`);

worst=Infinity; wd=-1; wt='';
for (let i=0;i<=(32-24)/0.25;i++){ const d=24+i*0.25; const c=stackedColourAt(d,DEEP);
  ON_DEEP_TOKENS.forEach((tok,idx)=>{ const r=contrastRatio(c,tok); if(r<worst){worst=r;wd=d;wt=NAMES_DEEP[idx];} }); }
console.log(`DEEP zone (24-32m) worst: ${worst.toFixed(4)}:1 at ${wd}m against ${wt}`);
