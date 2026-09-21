// Throwaway probe: recompute the "not on card" contrast bound for candidate
// INTENSITY values without repeatedly editing source files. Mirrors
// palette.ts / gate.ts / snow.ts / shoal.ts / bubbles.ts / effects.test.ts.

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function smoothstep(t) { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); }

const STOPS = [
  { metres: 0, rgb: [246, 249, 249] },
  { metres: 6, rgb: [234, 242, 243] },
  { metres: 14, rgb: [207, 225, 228] },
  { metres: 19, rgb: [176, 207, 213] },
  { metres: 21, rgb: [150, 186, 196] },
  { metres: 23, rgb: [38, 88, 105] },
  { metres: 28, rgb: [20, 64, 83] },
  { metres: 32, rgb: [11, 42, 58] },
];

function colourAtDepth(metres) {
  const m = clamp(metres, STOPS[0].metres, STOPS[STOPS.length - 1].metres);
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i], b = STOPS[i + 1];
    if (m >= a.metres && m <= b.metres) {
      const span = b.metres - a.metres;
      const t = smoothstep(span === 0 ? 0 : (m - a.metres) / span);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  const last = STOPS[STOPS.length - 1].rgb;
  return last;
}

function ramp(value, from, to) {
  if (from === to) return value >= from ? 1 : 0;
  const t = (value - from) / (to - from);
  return Math.min(1, Math.max(0, t));
}

function srgbToLinear(c) { const cs = c / 255; return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4); }
function relativeLuminance([r, g, b]) { return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b); }
function contrastRatio(a, b) {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
function compositeOver(base, colour, alpha) {
  return [
    base[0] * (1 - alpha) + colour[0] * alpha,
    base[1] * (1 - alpha) + colour[1] * alpha,
    base[2] * (1 - alpha) + colour[2] * alpha,
  ];
}

const SNOW_RGB = [255, 255, 255];
const DARK_PARTICLE_RGB = [40, 72, 88];

function snowAlphaAt(d, snowIntensity) {
  return snowIntensity * ramp(d, 21, 31);
}
function shoalAlphaAt(d, shoalIntensity) {
  return shoalIntensity * ramp(d, 8, 11) * ramp(d, 19, 14);
}
function bubbleAlphaAt(d, bubblesIntensity) {
  return bubblesIntensity * ramp(d, 5, 7) * ramp(d, 17, 13);
}

function waterPlusEffectsAt(d, I) {
  let colour = colourAtDepth(d);
  const snowA = snowAlphaAt(d, I.snow);
  if (snowA > 0) colour = compositeOver(colour, SNOW_RGB, snowA);
  const shoalA = shoalAlphaAt(d, I.shoal);
  if (shoalA > 0) colour = compositeOver(colour, DARK_PARTICLE_RGB, shoalA);
  const bubbleA = bubbleAlphaAt(d, I.bubbles);
  if (bubbleA > 0) colour = compositeOver(colour, DARK_PARTICLE_RGB, bubbleA);
  return colour;
}

const INK_TOKENS = [
  [0x0b, 0x2a, 0x3a],
  [0x31, 0x53, 0x5e],
  [0x27, 0x45, 0x4f],
];
const ON_DEEP_TOKENS = [
  [0xea, 0xf4, 0xf6],
  [0xb8, 0xd6, 0xdc],
  [0xae, 0xcd, 0xd4],
];

function sweep(from, to, tokens, I) {
  let worst = Infinity, worstDepth = -1, worstTokenIdx = -1;
  for (let i = 0; i <= (to - from) / 0.1; i++) {
    const d = from + i * 0.1;
    const colour = waterPlusEffectsAt(d, I);
    tokens.forEach((token, idx) => {
      const ratio = contrastRatio(colour, token);
      if (ratio < worst) { worst = ratio; worstDepth = d; worstTokenIdx = idx; }
    });
  }
  return { worst, worstDepth, worstTokenIdx };
}

function report(label, I) {
  const light = sweep(0, 19, INK_TOKENS, I);
  const deep = sweep(24, 32, ON_DEEP_TOKENS, I);
  console.log(`${label}: snow=${I.snow} shoal=${I.shoal} bubbles=${I.bubbles}`);
  console.log(`  light 0-19m worst: ${light.worst.toFixed(3)} at ${light.worstDepth.toFixed(1)}m (token idx ${light.worstTokenIdx})`);
  console.log(`  deep 24-32m worst: ${deep.worst.toFixed(3)} at ${deep.worstDepth.toFixed(1)}m (token idx ${deep.worstTokenIdx})`);
}

report('current-in-tree (pre my edits)', { snow: 0.3, shoal: 0.35, bubbles: 0.25 });
report('my raised candidate', { snow: 0.45, shoal: 0.35, bubbles: 0.4 });
report('zero particles (dither/shafts/caustics baseline only, not modelled here)', { snow: 0, shoal: 0, bubbles: 0 });

// Bisect: what is the max snow (with shoal/bubbles at their current-in-tree
// values) that still clears 4.5 on both domains?
function maxSafe(effectName, others) {
  let lo = 0, hi = 1;
  for (let iter = 0; iter < 30; iter++) {
    const mid = (lo + hi) / 2;
    const I = { snow: others.snow, shoal: others.shoal, bubbles: others.bubbles, [effectName]: mid };
    const light = sweep(0, 19, INK_TOKENS, I);
    const deep = sweep(24, 32, ON_DEEP_TOKENS, I);
    const ok = light.worst >= 4.5 && deep.worst >= 4.5;
    if (ok) lo = mid; else hi = mid;
  }
  return lo;
}

console.log('\nmax safe snow (others at current-in-tree):', maxSafe('snow', { snow: 0, shoal: 0.35, bubbles: 0.25 }).toFixed(4));
console.log('max safe bubbles (others at current-in-tree):', maxSafe('bubbles', { snow: 0.3, shoal: 0.35, bubbles: 0 }).toFixed(4));
console.log('max safe shoal (others at current-in-tree):', maxSafe('shoal', { snow: 0.3, shoal: 0, bubbles: 0.25 }).toFixed(4));

console.log('\n--- specific known heading depths (not a full sweep) ---');
function checkAt(label, d, tokens, I) {
  const colour = waterPlusEffectsAt(d, I);
  const ratios = tokens.map((t) => contrastRatio(colour, t));
  console.log(`${label} @ ${d}m: colour=${colour.map((c) => c.toFixed(1))} ratios=${ratios.map((r) => r.toFixed(2))}`);
}
const CURRENT = { snow: 0.3, shoal: 0.35, bubbles: 0.25 };
checkAt('Home hero', 0, INK_TOKENS, CURRENT);
checkAt('Work h1', 5, INK_TOKENS, CURRENT);
checkAt('Projects h1', 12, INK_TOKENS, CURRENT);
checkAt('Outside h1', 24, ON_DEEP_TOKENS, CURRENT);
checkAt('thermocline label (~21m)', 21, INK_TOKENS, CURRENT);

console.log('\n--- sweep against ONLY the primary ink/on-deep token (headings never render in -2/-3) ---');
function sweepSingleToken(from, to, token, I) {
  let worst = Infinity, worstDepth = -1;
  for (let i = 0; i <= (to - from) / 0.1; i++) {
    const d = from + i * 0.1;
    const colour = waterPlusEffectsAt(d, I);
    const ratio = contrastRatio(colour, token);
    if (ratio < worst) { worst = ratio; worstDepth = d; }
  }
  return { worst, worstDepth };
}
for (const cand of [
  { label: 'current-in-tree', I: { snow: 0.3, shoal: 0.35, bubbles: 0.25 } },
  { label: 'raised candidate', I: { snow: 0.45, shoal: 0.35, bubbles: 0.4 } },
]) {
  const light = sweepSingleToken(0, 19, INK_TOKENS[0], cand.I);
  const deep = sweepSingleToken(24, 32, ON_DEEP_TOKENS[0], cand.I);
  console.log(`${cand.label}: light(primary ink) worst=${light.worst.toFixed(3)} @ ${light.worstDepth.toFixed(1)}m; deep(primary on-deep) worst=${deep.worst.toFixed(3)} @ ${deep.worstDepth.toFixed(1)}m`);
}

// max shared scale factor k applied to (snow,shoal,bubbles) ratios of
// current-in-tree, such that primary-token-only sweep still clears 4.5
function maxScaleForPrimaryToken() {
  const base = { snow: 0.3, shoal: 0.35, bubbles: 0.25 };
  let lo = 0, hi = 3;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    const I = { snow: base.snow * mid, shoal: base.shoal * mid, bubbles: base.bubbles * mid };
    const light = sweepSingleToken(0, 19, INK_TOKENS[0], I);
    const deep = sweepSingleToken(24, 32, ON_DEEP_TOKENS[0], I);
    const ok = light.worst >= 4.5 && deep.worst >= 4.5;
    if (ok) lo = mid; else hi = mid;
  }
  return lo;
}
const k = maxScaleForPrimaryToken();
console.log(`\nmax shared scale factor on (0.3,0.35,0.25) for primary-token-only sweep: ${k.toFixed(3)} -> snow=${(0.3*k).toFixed(3)} shoal=${(0.35*k).toFixed(3)} bubbles=${(0.25*k).toFixed(3)}`);

console.log('\n--- independent tuning (shoal fixed at 0.35; snow only affects deep, bubbles+shoal only affect light) ---');
function maxSafeIndependent(effectName, fixed) {
  let lo = 0, hi = 1;
  const domain = effectName === 'snow' ? [24, 32, ON_DEEP_TOKENS[0]] : [0, 19, INK_TOKENS[0]];
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    const I = { ...fixed, [effectName]: mid };
    const { worst } = sweepSingleToken(domain[0], domain[1], domain[2], I);
    if (worst >= 4.5) lo = mid; else hi = mid;
  }
  return lo;
}
const maxSnow = maxSafeIndependent('snow', { snow: 0, shoal: 0.35, bubbles: 0.25 });
const maxBubbles = maxSafeIndependent('bubbles', { snow: 0.3, shoal: 0.35, bubbles: 0 });
console.log('max safe snow (deep, primary token):', maxSnow.toFixed(4));
console.log('max safe bubbles (light, primary token, shoal=0.35):', maxBubbles.toFixed(4));

// with a small safety margin (measured pixel sampling / real compositing may
// differ slightly from this flat-alpha analytical model), back off 5%
console.log('snow with 5% margin:', (maxSnow * 0.95).toFixed(3));
console.log('bubbles with 5% margin:', (maxBubbles * 0.95).toFixed(3));
