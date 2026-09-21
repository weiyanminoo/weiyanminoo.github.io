import { describe, it, expect } from 'vitest';
import { ramp, depthAtY } from '../../src/scripts/water/effects/gate';
import type { WaterFrame } from '../../src/scripts/water/effects/types';
import { snowAlphaAt } from '../../src/scripts/water/effects/snow';
import { shoalAlphaAt } from '../../src/scripts/water/effects/shoal';
import { bubbleAlphaAt } from '../../src/scripts/water/effects/bubbles';
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

  it('bubbles is 0 outside (5, 17) and non-zero inside', () => {
    expect(bubbleAlphaAt(0)).toBe(0);
    expect(bubbleAlphaAt(5)).toBe(0);
    expect(bubbleAlphaAt(17)).toBe(0);
    expect(bubbleAlphaAt(18)).toBe(0);
    expect(bubbleAlphaAt(6)).toBeGreaterThan(0);
    expect(bubbleAlphaAt(10)).toBeGreaterThan(0);
    expect(bubbleAlphaAt(16)).toBeGreaterThan(0);
  });

  it('gives every one of the four page bands at least one non-zero particle effect somewhere within it', () => {
    const bands = ['/', '/work', '/projects', '/outside'].map(bandForPath);
    for (const band of bands) {
      let covered = false;
      for (let m = band.top; m <= band.bottom; m += 0.1) {
        if (snowAlphaAt(m) > 0 || shoalAlphaAt(m) > 0 || bubbleAlphaAt(m) > 0) {
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
// over (water + effects). Round 2 replaces that panel with per-element
// glass cards (base.css's comment, and the mockup, finding 1) that cover
// only SOME of the page's text — a role entry, a project, a topic block —
// while section headings, the hero and the thermocline label sit directly
// on the water by design (finding 4). That is now two grounds, not one,
// checked separately below:
//   - "on a card": water + effects, composited with the WORST (most
//     transparent, i.e. least protective) card opacity actually shipped in
//     that zone — CARD_OPACITY from intensity.ts. Bounding against the
//     worst rather than each component's own number means every actual
//     card (which is that number or higher) is only ever MORE protected
//     than what this proves.
//   - "not on a card": bare water + effects, no compositing at all — the
//     same pre-scrim ground and the same 4.5:1 bound this file checked
//     before fix round 1 existed. INTENSITY's raised effect values are
//     bound by THIS check, not the on-card one, since a heading or the
//     hero gets no card to hide behind.
describe('stacked particle contrast bound', () => {
  const SNOW_RGB: Rgb = [255, 255, 255];
  const DARK_PARTICLE_RGB: Rgb = [40, 72, 88];

  // The card tint per zone — must match tokens.css's --card-tint default
  // and BaseLayout.astro's html.depth-deep / :global(.zone-deep) override
  // by hand (see CARD_OPACITY's own comment in intensity.ts for why there
  // is no automated bridge). --foam is the light-zone default (0-19m
  // here); --deep is the deep-zone override (24-32m here) — the same
  // two-token split --rail-scrim-tint already uses for the rail.
  const FOAM_RGB: Rgb = [246, 249, 249]; // --foam
  const DEEP_RGB: Rgb = [27, 74, 92]; // --deep

  // The worst (most transparent) card opacity actually shipped in each
  // zone — see CARD_OPACITY in intensity.ts for what each component uses.
  // Light zone: entries, projects and the header all render here.
  // Deep zone: the header and the deep-card equivalent both render here.
  const CARD_OPACITY_LIGHT_WORST = Math.min(CARD_OPACITY.entry, CARD_OPACITY.project, CARD_OPACITY.header);
  const CARD_OPACITY_DEEP_WORST = Math.min(CARD_OPACITY.header, CARD_OPACITY.deep);

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
    const bubbleA = bubbleAlphaAt(d);
    if (bubbleA > 0) {
      colour = compositeOver(colour, DARK_PARTICLE_RGB, bubbleA);
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

  it('on a card: clears 4.5:1 against every --ink token from 0m to 19m', () => {
    const { worst, worstDepth, worstToken } = sweepWorst(0, 19, INK_TOKENS, TOKEN_NAMES_INK, (d) =>
      cardColourAt(d, FOAM_RGB, CARD_OPACITY_LIGHT_WORST)
    );
    expect(
      worst,
      `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against ${worstToken} (card opacity ${CARD_OPACITY_LIGHT_WORST})`
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('on a card: clears 4.5:1 against every --on-deep token from 24m to 32m', () => {
    const { worst, worstDepth, worstToken } = sweepWorst(24, 32, ON_DEEP_TOKENS, TOKEN_NAMES_ON_DEEP, (d) =>
      cardColourAt(d, DEEP_RGB, CARD_OPACITY_DEEP_WORST)
    );
    expect(
      worst,
      `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against ${worstToken} (card opacity ${CARD_OPACITY_DEEP_WORST})`
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Not-on-card text is a closed, checked list, not "any text anywhere":
  // Home's <h1>/hero, every page's own <h1>, Home's own <h2> section
  // headings, and the thermocline label. Every one of those renders in the
  // PRIMARY ink/on-deep token — base.css's `h1`/`h2` rules set no colour of
  // their own (they inherit the zone's --ink/--on-deep), and the
  // thermocline label sets `color: var(--ink)` explicitly
  // (src/pages/index.astro) — never the softer --ink-2/--ink-3 tokens, which
  // only appear on text that (per finding 1) now always sits on a card. The
  // one exception is the hero's own .lede/.meta lines (index.astro), which
  // DO use --ink-2/--ink-3 and are NOT on a card — but they render within
  // the first ~4m of Home (the hero is the first thing on the page), well
  // above where shoal/bubbles ever gate on (8m/5m), so they are checked
  // separately below rather than folded into the full-column sweep.
  it('not on a card: clears 4.5:1 against the primary --ink token from 0m to 19m', () => {
    const { worst, worstDepth } = sweepWorst(0, 19, [INK_TOKENS[0]], ['--ink'], waterPlusEffectsAt);
    expect(worst, `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against --ink`).toBeGreaterThanOrEqual(4.5);
  });

  it('not on a card: clears 4.5:1 against the primary --on-deep token from 24m to 32m', () => {
    const { worst, worstDepth } = sweepWorst(24, 32, [ON_DEEP_TOKENS[0]], ['--on-deep'], waterPlusEffectsAt);
    expect(worst, `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against --on-deep`).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it('not on a card: the hero (.lede/.meta, --ink-2/--ink-3, 0-4m) clears 4.5:1', () => {
    const { worst, worstDepth, worstToken } = sweepWorst(
      0,
      4,
      [INK_TOKENS[1], INK_TOKENS[2]],
      ['--ink-2', '--ink-3'],
      waterPlusEffectsAt
    );
    expect(
      worst,
      `worst ratio ${worst.toFixed(3)} at ${worstDepth}m against ${worstToken}`
    ).toBeGreaterThanOrEqual(4.5);
  });
});
