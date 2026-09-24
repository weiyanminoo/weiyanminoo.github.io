import { describe, it, expect } from 'vitest';
import { ramp, depthAtY } from '../../src/scripts/water/effects/gate';
import type { WaterFrame } from '../../src/scripts/water/effects/types';
import { snowAlphaAt } from '../../src/scripts/water/effects/snow';
import { shoalAlphaAt } from '../../src/scripts/water/effects/shoal';
import {
  bubbleAlphaAt,
  bubbleLightAlphaAt,
  bubbleDeepAlphaAt,
} from '../../src/scripts/water/effects/bubbles';
import {
  faunaAlphaAt,
  faunaLightAlphaAt,
  faunaDeepAlphaAt,
  orient,
  MAX_PITCH,
  unitMatrix,
} from '../../src/scripts/water/effects/fauna';
import { FAUNA_ART } from '../../src/scripts/water/effects/faunaArt';
import { CARD_OPACITY } from '../../src/scripts/water/effects/intensity';
import { colourAtDepth, type Rgb } from '../../src/scripts/water/palette';
import { bandForPath } from '../../src/scripts/water/depth';

// Copied verbatim from tests/water/palette.test.ts, which already has one
// correct implementation of these — do not invent a second.
function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return [r, g, b];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linearise = (channel: number) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [r, g, b].map(linearise);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('ramp', () => {
  it('is 0 below the range', () => {
    expect(ramp(0, 10, 20)).toBe(0);
    expect(ramp(9.999, 10, 20)).toBe(0);
  });

  it('is 1 at/above the range', () => {
    expect(ramp(20, 10, 20)).toBe(1);
    expect(ramp(25, 10, 20)).toBe(1);
  });

  it('is linear at the midpoint', () => {
    expect(ramp(15, 10, 20)).toBeCloseTo(0.5);
  });

  it('handles a reversed range (from > to), ramping down as value rises', () => {
    expect(ramp(14, 19, 14)).toBe(1); // at/below `to`
    expect(ramp(19, 19, 14)).toBe(0); // at/above `from`
    expect(ramp(16.5, 19, 14)).toBeCloseTo(0.5); // midpoint
    expect(ramp(10, 19, 14)).toBe(1); // beyond `to`, clamped
    expect(ramp(25, 19, 14)).toBe(0); // beyond `from`, clamped
  });

  it('handles from === to without dividing by zero', () => {
    expect(ramp(5, 10, 10)).toBe(0); // below
    expect(ramp(10, 10, 10)).toBe(1); // at
    expect(ramp(15, 10, 10)).toBe(1); // above
  });
});

describe('depthAtY', () => {
  function frame(overrides: Partial<WaterFrame> = {}): WaterFrame {
    return {
      ctx: null as unknown as CanvasRenderingContext2D,
      width: 800,
      height: 1000,
      time: 0,
      depthTop: 5,
      depthBottom: 15,
      ...overrides,
    };
  }

  it('returns depthTop at the top of the viewport', () => {
    expect(depthAtY(frame(), 0)).toBe(5);
  });

  it('returns depthBottom at the bottom of the viewport', () => {
    expect(depthAtY(frame(), 1000)).toBe(15);
  });

  it('returns the midpoint at the vertical midpoint', () => {
    expect(depthAtY(frame(), 500)).toBe(10);
  });

  it('returns a constant depth when depthTop === depthBottom', () => {
    const f = frame({ depthTop: 12, depthBottom: 12 });
    expect(depthAtY(f, 0)).toBe(12);
    expect(depthAtY(f, 500)).toBe(12);
    expect(depthAtY(f, 1000)).toBe(12);
  });

  it('returns depthTop rather than NaN when height is 0 — a real state this preview harness has produced', () => {
    const f = frame({ height: 0, depthTop: 7 });
    expect(depthAtY(f, 0)).toBe(7);
    expect(depthAtY(f, 500)).toBe(7);
  });
});

// Plan task 7, made checkable: every particle effect's alpha is a pure
// function of depth, zero outside its gated range, non-zero inside it, and
// every page band gets at least one particle effect somewhere within it.
describe('particle gate coverage', () => {
  it('snow is 0 outside [21, 31] and non-zero inside', () => {
    // Phase 7: gate now starts at THERMOCLINE (21m), not 24m — see snow.ts.
    expect(snowAlphaAt(0)).toBe(0);
    expect(snowAlphaAt(20.99)).toBe(0);
    expect(snowAlphaAt(21)).toBe(0); // ramp starts at 0 right at its `from`
    expect(snowAlphaAt(27)).toBeGreaterThan(0);
    expect(snowAlphaAt(31)).toBeGreaterThan(0);
    expect(snowAlphaAt(32)).toBeGreaterThan(0);
  });

  it('shoal is 0 outside (8, 19) and non-zero inside', () => {
    expect(shoalAlphaAt(0)).toBe(0);
    expect(shoalAlphaAt(8)).toBe(0);
    expect(shoalAlphaAt(19)).toBe(0);
    expect(shoalAlphaAt(20)).toBe(0);
    expect(shoalAlphaAt(9)).toBeGreaterThan(0);
    expect(shoalAlphaAt(12)).toBeGreaterThan(0);
    expect(shoalAlphaAt(18)).toBeGreaterThan(0);
  });

  it('bubbles fade in from 5m and then run to the floor of the column', () => {
    expect(bubbleAlphaAt(0)).toBe(0);
    expect(bubbleAlphaAt(5)).toBe(0);
    expect(bubbleAlphaAt(6)).toBeGreaterThan(0);
    expect(bubbleAlphaAt(10)).toBeGreaterThan(0);
    // Phase 9: they used to stop at 17m, which is why they never looked
    // real — a bubble only reads as one against DARK water, and they never
    // reached any.
    expect(bubbleAlphaAt(24)).toBeGreaterThan(0);
    expect(bubbleAlphaAt(32)).toBeGreaterThan(0);
  });

  it('hands bubbles from the dark-rim to the bright treatment inside the textless 19-24m passage', () => {
    // The two treatments composite OPPOSITE directions (toward rgb(40,72,88)
    // and toward near-white), so they must never both be behind the same
    // glyph. They overlap only across 19-24m, which no page renders text in
    // — see depth.ts's band table.
    expect(bubbleDeepAlphaAt(19)).toBe(0);
    expect(bubbleLightAlphaAt(24)).toBe(0);
    expect(bubbleLightAlphaAt(14)).toBeGreaterThan(0);
    expect(bubbleDeepAlphaAt(28)).toBeGreaterThan(0);
  });

  it('gives every one of the four page bands at least one non-zero particle effect somewhere within it', () => {
    const bands = ['/', '/work', '/projects', '/outside'].map(bandForPath);
    for (const band of bands) {
      let covered = false;
      for (let m = band.top; m <= band.bottom; m += 0.1) {
        if (
          snowAlphaAt(m) > 0 ||
          shoalAlphaAt(m) > 0 ||
          bubbleAlphaAt(m) > 0 ||
          faunaAlphaAt(m) > 0
        ) {
          covered = true;
          break;
        }
      }
      expect(covered).toBe(true);
    }
  });
});

// The important one: the stacked contrast bound. Composites every particle
// effect that is non-zero at a given depth over the bare water colour at
// that depth, in EFFECTS order (snow, then shoal, then bubbles), each at
// its own gated peak alpha over its own colour — sequential compositing is
// exactly the 1 - (1-a)(1-b) stacking semantics the brief calls for.
//
// This models each of snow/shoal/bubbles compositing over the water AT MOST
// ONCE per frame (n = 1 per effect). That is not an assumption to take on
// faith: shoal.ts and bubbles.ts each accumulate every one of their
// particles into a single canvas path and issue exactly one fill()/stroke()
// per frame, at one alpha (see the comment above each module's draw
// function) — so no matter how many fish or bubbles overlap on screen,
// canvas composites that whole cluster as one shape, once. If a future edit
// reintroduces a per-particle fill()/stroke() in either module, overlapping
// particles would again composite as 1 - (1-a)^n and this test would no
// longer bound what actually renders — this comment is the tripwire for a
// reader, since the maths below has no way to detect that on its own.
//
// Phase 7 fix round 1 introduced one flat `.content-scrim` panel behind
// every text-bearing block, so there used to be exactly one ground: scrim
// over (water + effects). Round 2 replaced that panel with per-element
// glass cards (base.css's comment, and the mockup, finding 1) that cover
// only SOME of the page's text, and round 3 finished the job: every piece
// of NORMAL-size body text on the site is now on a card, and the only
// things left on bare water are LARGE text — each page's <h1>, Home's own
// <h2> section heads, and the thermocline label. Three grounds, checked
// separately below:
//   - "content card": water + effects composited with the worst (most
//     transparent, least protective) CONTENT card opacity shipped in that
//     zone — CARD_OPACITY.entry/.project in the light zone, .deep below
//     the thermocline. Every actual card is that number or higher, so it
//     is only ever MORE protected than this proves. Checked against all
//     three ink tokens at 4.5:1, since content cards carry body copy in
//     the softer --ink-2/--ink-3 (and --on-deep-2/--on-deep-3) tokens.
//   - "header": the same ground at CARD_OPACITY.header, which is lower
//     than either content card and is the one card that renders at every
//     depth on Home's full column. Checked against the PRIMARY token only,
//     and that is a claim about the markup, not an assumption:
//     SiteHeader.astro's .wordmark sets no colour and its `nav a` sets
//     `color: inherit`, so both inherit the zone's --ink/--on-deep. If a
//     softer token is ever introduced into the header, this test must move
//     to the full token list (and the header opacity will have to rise).
//   - "not on a card": bare water + effects, no compositing at all, at the
//     3:1 LARGE-text threshold rather than 4.5:1 — because after round 3
//     every uncarded element genuinely is large text. That is also a claim
//     about the markup: base.css gives h1 clamp(40px, 8vw, 80px)/800 and
//     h2 700 (index.astro floors its own h2s at 22px), and index.astro's
//     .thermocline-label is 20px/700; 20px at weight 700 clears WCAG's
//     >=18.66px-and-bold rule at every viewport, and the audit
//     (scripts/audit/checks/contrast.mjs) independently classifies each
//     element and applies the same two thresholds against real pixels. Put
//     a normal-size element on bare water and BOTH this bound and the
//     audit become wrong together — card it instead (see index.astro's
//     .hero-note and .more).
describe('stacked particle contrast bound', () => {
  const SNOW_RGB: Rgb = [255, 255, 255];
  const DARK_PARTICLE_RGB: Rgb = [40, 72, 88];
  // bubbles.ts's GLINT_COLOUR — the dark-water bubble treatment.
  const BUBBLE_GLINT_RGB: Rgb = [242, 251, 253];
  // fauna.ts's DEEP_SILHOUETTE — palette.ts's own 32m stop.
  const FAUNA_DEEP_RGB: Rgb = [11, 42, 58];

  // The card tint per zone — must match tokens.css's --card-tint default
  // and BaseLayout.astro's html.depth-deep / :global(.zone-deep) override
  // by hand (see CARD_OPACITY's own comment in intensity.ts for why there
  // is no automated bridge). --foam is the light-zone default (0-19m
  // here); --deep is the deep-zone override (24-32m here) — the same
  // two-token split --rail-scrim-tint already uses for the rail.
  const FOAM_RGB: Rgb = [246, 249, 249]; // --foam
  const DEEP_RGB: Rgb = [27, 74, 92]; // --deep

  // The worst (most transparent) CONTENT card opacity actually shipped in
  // each zone — see CARD_OPACITY in intensity.ts for what each component
  // uses. Light zone: role entries and projects (plus Home's condensed
  // rows, its .hero-note and its .more links, all at .project). Deep zone:
  // /outside's topics and Home's interests, both at .deep.
  const CONTENT_CARD_LIGHT_WORST = Math.min(CARD_OPACITY.entry, CARD_OPACITY.project);
  const CONTENT_CARD_DEEP_WORST = CARD_OPACITY.deep;

  const INK_TOKENS: readonly Rgb[] = [
    hexToRgb('#0B2A3A'), // --ink
    hexToRgb('#31535E'), // --ink-2
    hexToRgb('#27454F'), // --ink-3
  ];
  const ON_DEEP_TOKENS: readonly Rgb[] = [
    hexToRgb('#EAF4F6'), // --on-deep
    hexToRgb('#B8D6DC'), // --on-deep-2
    hexToRgb('#AECDD4'), // --on-deep-3
  ];

  function compositeOver(base: Rgb, colour: Rgb, alpha: number): Rgb {
    return [
      base[0] * (1 - alpha) + colour[0] * alpha,
      base[1] * (1 - alpha) + colour[1] * alpha,
      base[2] * (1 - alpha) + colour[2] * alpha,
    ];
  }

  // Water + effects: the ground shared by both checks below, and (for the
  // "not on a card" check) the ground itself, unchanged.
  function waterPlusEffectsAt(d: number): Rgb {
    let colour = colourAtDepth(d);
    const snowA = snowAlphaAt(d);
    if (snowA > 0) {
      colour = compositeOver(colour, SNOW_RGB, snowA);
    }
    const shoalA = shoalAlphaAt(d);
    if (shoalA > 0) {
      colour = compositeOver(colour, DARK_PARTICLE_RGB, shoalA);
    }
    // Bubbles composite in OPPOSITE directions by zone — a dark rim on
    // bright water, a bright ring on dark water — so each treatment is
    // modelled against its own colour. Using one colour for both (as this
    // did before Phase 9) would have understated the deep-zone cost
    // entirely, since a near-white ring on deep water is exactly what eats
    // the on-deep tokens' headroom.
    const rimA = bubbleLightAlphaAt(d);
    if (rimA > 0) {
      colour = compositeOver(colour, DARK_PARTICLE_RGB, rimA);
    }
    const ringA = bubbleDeepAlphaAt(d);
    if (ringA > 0) {
      colour = compositeOver(colour, BUBBLE_GLINT_RGB, ringA);
    }
    // Marine life. The light-water treatment darkens near-white water and
    // so genuinely spends headroom; the dark-water one darkens water that
    // is already dark, which RAISES contrast for the on-deep tokens. The
    // second is modelled anyway rather than skipped as "free" — an effect
    // left out of the model because it currently helps is an effect nobody
    // re-checks when its colour changes.
    const faunaLightA = faunaLightAlphaAt(d);
    if (faunaLightA > 0) {
      colour = compositeOver(colour, DARK_PARTICLE_RGB, faunaLightA);
    }
    const faunaDeepA = faunaDeepAlphaAt(d);
    if (faunaDeepA > 0) {
      colour = compositeOver(colour, FAUNA_DEEP_RGB, faunaDeepA);
    }
    return colour;
  }

  // The ground text on a card actually sits on: the card, composited over
  // (water + effects) at that card's opacity.
  function cardColourAt(d: number, cardTint: Rgb, opacity: number): Rgb {
    return compositeOver(waterPlusEffectsAt(d), cardTint, opacity);
  }

  // The domain is two ranges, not the full 0-32m column: 19-24m is the
  // unclaimed thermocline passage that no page ever renders text in
  // (Projects bottoms out at 19m, Outside starts at 24m, and Home's 19-24m
  // span is that same passage) — see the band-table comment in
  // src/scripts/water/depth.ts, and tests/water/palette.test.ts's stop-table
  // contrast tests, which test exactly these two edges (19m against ink,
  // 24m against on-deep) for the same reason. Bare water already fails
  // contrast inside the passage, with no particle drawn at all, so it is
  // excluded rather than asserted.
  const TOKEN_NAMES_INK = ['--ink', '--ink-2', '--ink-3'] as const;
  const TOKEN_NAMES_ON_DEEP = ['--on-deep', '--on-deep-2', '--on-deep-3'] as const;

  function sweepWorst(
    from: number,
    to: number,
    tokens: readonly Rgb[],
    tokenNames: readonly string[],
    colourAt: (d: number) => Rgb
  ): { worst: number; worstDepth: number; worstToken: string } {
    let worst = Infinity;
    let worstDepth = -1;
    let worstToken = '';
    for (let i = 0; i <= (to - from) / 0.25; i++) {
      const d = from + i * 0.25;
      const colour = colourAt(d);
      tokens.forEach((token, tokenIndex) => {
        const ratio = contrastRatio(colour, token);
        if (ratio < worst) {
          worst = ratio;
          worstDepth = d;
          worstToken = tokenNames[tokenIndex];
        }
      });
    }
    return { worst, worstDepth, worstToken };
  }

  it('on a content card: clears 4.5:1 against every --ink token from 0m to 19m', () => {
    const { worst, worstDepth, worstToken } = sweepWorst(0, 19, INK_TOKENS, TOKEN_NAMES_INK, (d) =>
      cardColourAt(d, FOAM_RGB, CONTENT_CARD_LIGHT_WORST)
    );
    expect(
      worst,
      `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against ${worstToken} (card opacity ${CONTENT_CARD_LIGHT_WORST})`
    ).toBeGreaterThanOrEqual(4.5);
  });

  // This is the bound that caps INTENSITY.snow — not the uncarded one. The
  // real element behind it is the faintest on-deep token on a deep card in
  // the deepest water: LogSlate's <dt>/<dd class="unfilled"> inside
  // /outside's .topic cards, and SiteFooter's .contacts/.sub.
  it('on a content card: clears 4.5:1 against every --on-deep token from 24m to 32m', () => {
    const { worst, worstDepth, worstToken } = sweepWorst(24, 32, ON_DEEP_TOKENS, TOKEN_NAMES_ON_DEEP, (d) =>
      cardColourAt(d, DEEP_RGB, CONTENT_CARD_DEEP_WORST)
    );
    expect(
      worst,
      `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against ${worstToken} (card opacity ${CONTENT_CARD_DEEP_WORST})`
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('on the header card: clears 4.5:1 against the primary token in both zones', () => {
    const light = sweepWorst(0, 19, [INK_TOKENS[0]], ['--ink'], (d) =>
      cardColourAt(d, FOAM_RGB, CARD_OPACITY.header)
    );
    expect(
      light.worst,
      `light zone: worst ratio ${light.worst.toFixed(3)} at ${light.worstDepth}m (header opacity ${CARD_OPACITY.header})`
    ).toBeGreaterThanOrEqual(4.5);

    const deep = sweepWorst(24, 32, [ON_DEEP_TOKENS[0]], ['--on-deep'], (d) =>
      cardColourAt(d, DEEP_RGB, CARD_OPACITY.header)
    );
    expect(
      deep.worst,
      `deep zone: worst ratio ${deep.worst.toFixed(3)} at ${deep.worstDepth}m (header opacity ${CARD_OPACITY.header})`
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Not-on-card text is a closed, checked list, not "any text anywhere":
  // every page's own <h1>, Home's own <h2> section headings, and the
  // thermocline label. Every one of those renders in the PRIMARY
  // ink/on-deep token — base.css's `h1`/`h2` rules set no colour of their
  // own (they inherit the zone's --ink/--on-deep), and the thermocline
  // label sets `color: var(--ink)` explicitly (src/pages/index.astro) —
  // never the softer --ink-2/--ink-3 tokens, which only appear on text that
  // always sits on a card. The list used to have one more entry: the hero's
  // own .lede/.meta lines, which DO use --ink-2/--ink-3. Fix round 3 carded
  // them (index.astro's .hero-note) along with Home's three .more links,
  // which is what let LARGE_TEXT_RATIO below replace 4.5:1 here — and that
  // in turn is what let INTENSITY.bubbles reach the mockup's own 0.5.
  //
  // One normal-size element is still outside every card: base.css's
  // .skip-link. It is not an exception to the rule above, because it never
  // sits on water — it is parked off-screen at top: -48px and, when
  // focused, paints its own opaque `background: var(--ink)` under
  // `color: var(--foam)`. No effect can reach it, so no bound here applies.
  const LARGE_TEXT_RATIO = 3;

  it('not on a card: clears 3:1 (large text) against the primary --ink token from 0m to 19m', () => {
    const { worst, worstDepth } = sweepWorst(0, 19, [INK_TOKENS[0]], ['--ink'], waterPlusEffectsAt);
    expect(worst, `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against --ink`).toBeGreaterThanOrEqual(
      LARGE_TEXT_RATIO
    );
  });

  it('not on a card: clears 3:1 (large text) against the primary --on-deep token from 24m to 32m', () => {
    const { worst, worstDepth } = sweepWorst(24, 32, [ON_DEEP_TOKENS[0]], ['--on-deep'], waterPlusEffectsAt);
    expect(worst, `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against --on-deep`).toBeGreaterThanOrEqual(
      LARGE_TEXT_RATIO
    );
  });
});

describe('fauna orientation', () => {
  // The rendering matrix is translate(x,y) . rotate(angle) . scale(L*scaleX, L),
  // applied to a unit path whose nose is at +x and whose back is at -y (up,
  // since canvas y grows downward). These helpers apply exactly that to the
  // two directions that matter, so the assertions below are about what is
  // actually drawn rather than about the intermediate numbers.
  const nose = (dx: number, dy: number, peak: number) => {
    const { angle, scaleX } = orient(dx, dy, peak);
    return [scaleX * Math.cos(angle), scaleX * Math.sin(angle)];
  };
  const back = (dx: number, dy: number, peak: number) => {
    const { angle } = orient(dx, dy, peak);
    // scale does not affect (0,-1) in x, so only the rotation applies.
    return [Math.sin(angle), -Math.cos(angle)];
  };

  // A spread of velocities including straight up, straight down, hard left,
  // hard right and every diagonal, at speeds from a crawl to full peak.
  const peak = 30;
  const velocities: [number, number][] = [];
  for (let deg = 0; deg < 360; deg += 7) {
    const r = (deg * Math.PI) / 180;
    for (const speed of [0.05, 0.4, 1]) {
      velocities.push([peak * speed * Math.cos(r), peak * speed * Math.sin(r)]);
    }
  }

  it('never draws a creature upside down, at any velocity', () => {
    // This is the bug this function exists to prevent: rotating a profile
    // silhouette by atan2(dy, dx) puts it on its back the moment it swims
    // leftward. The creature's back must point up (negative y) always.
    for (const [dx, dy] of velocities) {
      const [, backY] = back(dx, dy, peak);
      expect(backY).toBeLessThan(0);
    }
  });

  it('never draws a creature swimming backwards', () => {
    // The nose must agree with the direction of travel on both axes. A
    // creature mid-turn has zero width, so only test where it has some.
    for (const [dx, dy] of velocities) {
      const { scaleX } = orient(dx, dy, peak);
      if (Math.abs(scaleX) < 1e-6) {
        continue;
      }
      const [noseX, noseY] = nose(dx, dy, peak);
      expect(Math.sign(noseX)).toBe(Math.sign(dx));
      if (Math.abs(dy) > 1e-6) {
        expect(Math.sign(noseY)).toBe(Math.sign(dy));
      }
    }
  });

  it('never pitches a creature past MAX_PITCH', () => {
    for (const [dx, dy] of velocities) {
      expect(Math.abs(orient(dx, dy, peak).angle)).toBeLessThanOrEqual(MAX_PITCH + 1e-9);
    }
  });

  it('keeps MAX_PITCH inside a quarter turn, which is what forbids the flip', () => {
    expect(MAX_PITCH).toBeLessThan(Math.PI / 2);
  });

  it('turns through zero width rather than snapping between facings', () => {
    // A hard sign flip is what reads as the creature being mirrored in
    // place. Sweeping dx through zero must pass through |scaleX| = 0 and
    // change by only a little between neighbouring samples.
    let previous = orient(-peak, 0, peak).scaleX;
    let sawZero = false;
    for (let dx = -peak; dx <= peak; dx += peak / 200) {
      const { scaleX } = orient(dx, 0, peak);
      expect(Math.abs(scaleX - previous)).toBeLessThan(0.05);
      if (Math.abs(scaleX) < 0.02) {
        sawZero = true;
      }
      previous = scaleX;
    }
    expect(sawZero).toBe(true);
  });

  it('holds a creature at full width while it is not turning', () => {
    // A traverse never reverses, so it must never be foreshortened.
    expect(orient(peak, 0, peak).scaleX).toBe(1);
    expect(orient(peak, 5, peak).scaleX).toBe(1);
  });

  it('does not divide by zero when a creature has no horizontal travel at all', () => {
    const { angle, scaleX } = orient(0, 0, 0);
    expect(Number.isFinite(angle)).toBe(true);
    expect(Number.isFinite(scaleX)).toBe(true);
  });
});

describe('fauna unit-path transform', () => {
  const species = Object.keys(FAUNA_ART) as (keyof typeof FAUNA_ART)[];

  it('covers every species in the art table', () => {
    expect(species.length).toBeGreaterThan(0);
  });

  // THE REGRESSION THIS FILE EXISTS FOR. fauna.ts mirrors each creature at
  // draw time (see `orient`) so it faces the way it is swimming. If the
  // unit-path transform ALSO mirrors, the two cancel and every creature
  // swims tail-first in every direction — which shipped twice, because a
  // still frame looks fine unless you already know which end of a turtle is
  // its head. A reflection is exactly a negative determinant, so this is
  // checkable without rendering anything.
  it('is never a reflection — the determinant is strictly positive', () => {
    for (const key of species) {
      const [a, b, c, d] = unitMatrix(FAUNA_ART[key]);
      expect(a * d - b * c).toBeGreaterThan(0);
    }
  });

  it('is a rotation and a uniform scale, with no shear or squash', () => {
    for (const key of species) {
      const [a, b, c, d] = unitMatrix(FAUNA_ART[key]);
      expect(a).toBeCloseTo(d, 12);
      expect(b).toBeCloseTo(-c, 12);
    }
  });

  it('scales each artwork to exactly unit length', () => {
    // The ink spans `extent` viewBox units, so a uniform 1/extent scale puts
    // it at 1. det is that scale squared.
    for (const key of species) {
      const art = FAUNA_ART[key];
      const [a, b, c, d] = unitMatrix(art);
      expect(Math.sqrt(a * d - b * c)).toBeCloseTo(1 / art.extent, 12);
    }
  });

  it('puts the artwork the same way up for every species', () => {
    // Each is authored nose-right or turned nose-right by `rotation` alone,
    // so the transform's rotation must be a multiple of the declared one and
    // nothing may be flipped relative to any other. Checked as: applying the
    // transform to the artwork's own +x axis agrees in sign with cos of the
    // declared rotation, for all of them.
    for (const key of species) {
      const art = FAUNA_ART[key];
      const [a, b] = unitMatrix(art);
      const theta = (art.rotation * Math.PI) / 180;
      expect(Math.sign(a) || 1).toBe(Math.sign(Math.cos(theta)) || 1);
      expect(Math.sign(b) || 1).toBe(Math.sign(Math.sin(theta)) || 1);
    }
  });
});
