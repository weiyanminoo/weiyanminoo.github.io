#!/usr/bin/env node
// Throwaway solver: replicates tests/water/effects.test.ts's analytical
// model (palette stops + the three gate shapes, both copied from source)
// and sweeps candidate INTENSITY values for snow and bubbles against both
// bounds, so the shipped numbers are chosen rather than guessed.

const STOPS = [
  [0, [246, 249, 249]],
  [6, [234, 242, 243]],
  [14, [207, 225, 228]],
  [19, [176, 207, 213]],
  [21, [150, 186, 196]],
  [23, [38, 88, 105]],
  [28, [20, 64, 83]],
  [32, [11, 42, 58]],
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (t) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

function colourAtDepth(metres) {
  const m = clamp(metres, STOPS[0][0], STOPS[STOPS.length - 1][0]);
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [am, argb] = STOPS[i];
    const [bm, brgb] = STOPS[i + 1];
    if (m >= am && m <= bm) {
      const span = bm - am;
      const t = smoothstep(span === 0 ? 0 : (m - am) / span);
      return [
        Math.round(argb[0] + (brgb[0] - argb[0]) * t),
        Math.round(argb[1] + (brgb[1] - argb[1]) * t),
        Math.round(argb[2] + (brgb[2] - argb[2]) * t),
      ];
    }
  }
  return STOPS[STOPS.length - 1][1].slice();
}

function ramp(value, from, to) {
  if (from === to) return value >= from ? 1 : 0;
  return clamp((value - from) / (to - from), 0, 1);
}

const snowGate = (d) => ramp(d, 21, 31);
const shoalGate = (d) => ramp(d, 8, 11) * ramp(d, 19, 14);
const bubbleGate = (d) => ramp(d, 5, 7) * ramp(d, 17, 13);

function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(a, b) {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const SNOW_RGB = [255, 255, 255];
const DARK_PARTICLE_RGB = [40, 72, 88];
const FOAM_RGB = [246, 249, 249];
const DEEP_RGB = [27, 74, 92];

const INK = [
  [11, 42, 58],
  [49, 83, 94],
  [39, 69, 79],
];
const ON_DEEP = [
  [234, 244, 246],
  [184, 214, 220],
  [174, 205, 212],
];

const over = (base, colour, a) => [
  base[0] * (1 - a) + colour[0] * a,
  base[1] * (1 - a) + colour[1] * a,
  base[2] * (1 - a) + colour[2] * a,
];

function waterPlusEffects(d, I) {
  let c = colourAtDepth(d);
  const s = I.snow * snowGate(d);
  if (s > 0) c = over(c, SNOW_RGB, s);
  const f = I.shoal * shoalGate(d);
  if (f > 0) c = over(c, DARK_PARTICLE_RGB, f);
  const b = I.bubbles * bubbleGate(d);
  if (b > 0) c = over(c, DARK_PARTICLE_RGB, b);
  return c;
}

function sweep(from, to, tokens, colourAt) {
  let worst = Infinity;
  let at = -1;
  let tok = -1;
  for (let i = 0; i <= (to - from) / 0.25; i++) {
    const d = from + i * 0.25;
    const colour = colourAt(d);
    tokens.forEach((t, ti) => {
      const r = contrastRatio(colour, t);
      if (r < worst) {
        worst = r;
        at = d;
        tok = ti;
      }
    });
  }
  return { worst, at, tok };
}

function bounds(I, cardLight, cardDeep) {
  return {
    cardLight: sweep(0, 19, INK, (d) => over(waterPlusEffects(d, I), FOAM_RGB, cardLight)),
    cardDeep: sweep(24, 32, ON_DEEP, (d) => over(waterPlusEffects(d, I), DEEP_RGB, cardDeep)),
    bareLight: sweep(0, 19, [INK[0]], (d) => waterPlusEffects(d, I)),
    bareDeep: sweep(24, 32, [ON_DEEP[0]], (d) => waterPlusEffects(d, I)),
  };
}

const CARD_L = 0.62;
const CARD_D = 0.62;

function report(label, I) {
  const b = bounds(I, CARD_L, CARD_D);
  console.log(
    `${label} snow=${I.snow} shoal=${I.shoal} bubbles=${I.bubbles}\n` +
      `   on-card light  ${b.cardLight.worst.toFixed(3)} @${b.cardLight.at}m tok${b.cardLight.tok} (need 4.5)\n` +
      `   on-card deep   ${b.cardDeep.worst.toFixed(3)} @${b.cardDeep.at}m tok${b.cardDeep.tok} (need 4.5)\n` +
      `   bare light     ${b.bareLight.worst.toFixed(3)} @${b.bareLight.at}m (large: need 3.0)\n` +
      `   bare deep      ${b.bareDeep.worst.toFixed(3)} @${b.bareDeep.at}m (large: need 3.0)`
  );
}

// Current shipped values
report('CURRENT ', { snow: 0.31, shoal: 0.35, bubbles: 0.26 });

// Ceiling search: largest snow / bubbles (0.005 steps) that keeps every
// bound at or above its own threshold, shoal held at 0.35.
function ok(I, bareNeed) {
  const b = bounds(I, CARD_L, CARD_D);
  return (
    b.cardLight.worst >= 4.5 &&
    b.cardDeep.worst >= 4.5 &&
    b.bareLight.worst >= bareNeed &&
    b.bareDeep.worst >= bareNeed
  );
}

for (const bareNeed of [4.5, 3.0]) {
  let maxSnow = 0;
  for (let s = 0.005; s <= 1.0001; s += 0.005) {
    if (ok({ snow: s, shoal: 0.35, bubbles: 0.26 }, bareNeed)) maxSnow = s;
    else break;
  }
  let maxBub = 0;
  for (let bb = 0.005; bb <= 1.0001; bb += 0.005) {
    if (ok({ snow: 0.31, shoal: 0.35, bubbles: bb }, bareNeed)) maxBub = bb;
    else break;
  }
  console.log(`\nbare bound ${bareNeed}:1 -> max snow ${maxSnow.toFixed(3)}, max bubbles ${maxBub.toFixed(3)}`);
}

console.log('');
for (const cand of [
  { snow: 0.4, shoal: 0.35, bubbles: 0.5 },
  { snow: 0.38, shoal: 0.35, bubbles: 0.5 },
  { snow: 0.36, shoal: 0.35, bubbles: 0.46 },
  { snow: 0.34, shoal: 0.35, bubbles: 0.42 },
]) {
  report('CAND    ', cand);
}

// --- joint search: deep-card opacity vs snow, light-card opacity vs bubbles
console.log('\n=== deep card opacity vs max snow (shoal .35, bubbles .5) ===');
for (const cd of [0.62, 0.66, 0.7, 0.72, 0.76, 0.8, 0.84, 0.88]) {
  let maxSnow = 0;
  for (let s = 0.005; s <= 1.0001; s += 0.005) {
    const b = bounds({ snow: s, shoal: 0.35, bubbles: 0.5 }, CARD_L, cd);
    if (b.cardDeep.worst >= 4.5 && b.bareDeep.worst >= 3.0) maxSnow = s;
    else break;
  }
  const b = bounds({ snow: maxSnow, shoal: 0.35, bubbles: 0.5 }, CARD_L, cd);
  console.log(
    `  deep card ${cd}: max snow ${maxSnow.toFixed(3)}  (on-card deep ${b.cardDeep.worst.toFixed(3)} @${b.cardDeep.at}m tok${b.cardDeep.tok}, bare deep ${b.bareDeep.worst.toFixed(3)} @${b.bareDeep.at}m)`
  );
}

console.log('\n=== light card opacity vs max bubbles (snow .4, shoal .35) ===');
for (const cl of [0.58, 0.62, 0.66, 0.72]) {
  let maxB = 0;
  for (let bb = 0.005; bb <= 1.0001; bb += 0.005) {
    const b = bounds({ snow: 0.4, shoal: 0.35, bubbles: bb }, cl, 0.72);
    if (b.cardLight.worst >= 4.5 && b.bareLight.worst >= 3.0) maxB = bb;
    else break;
  }
  const b = bounds({ snow: 0.4, shoal: 0.35, bubbles: maxB }, cl, 0.72);
  console.log(
    `  light card ${cl}: max bubbles ${maxB.toFixed(3)}  (on-card light ${b.cardLight.worst.toFixed(3)} @${b.cardLight.at}m tok${b.cardLight.tok}, bare light ${b.bareLight.worst.toFixed(3)} @${b.bareLight.at}m)`
  );
}
