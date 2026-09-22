// One tuning dial per effect, in one place — plan Phase 5 task 8. The
// contrast sweep (tests/water/effects.test.ts) is the only thing allowed to
// turn these values.
//
// Phase 7 fix round 1: every effect used to paint straight onto the water
// behind text, so the contrast budget bounded all of them at a pathological
// worst case (a particle dead-centre behind a glyph) — below the threshold
// of perception. Round 1 fixed that with one flat `.content-scrim` panel;
// its straight edges showed as seams (see phase-7-fix-package.md, finding
// 1), so this round replaces it with per-element frosted-glass cards —
// CARD_OPACITY below — following the mockup's own card treatment
// (mockups/dive-log.html). Text NOT on a card (section headings, the hero,
// the thermocline label) is still bound by the old, tighter, pre-scrim
// limit — see tests/water/effects.test.ts for both bounds, and
// phase-7-report.md for the measurements behind every number below.
export const INTENSITY = {
  dither: 0.05, // overlay alpha of the noise tile — unchanged, already doing its job
  // Multiplier on the trough depth, and the mockup's own value: its
  // caustics layer is `255 - m*58/26/15` drawn at `globalAlpha = 0.55*lit`
  // (mockups/dive-log.html), while ours draws at alpha 1 and folds that
  // 0.55 into the trough instead — same arithmetic, since TROUGH_DEPTH
  // (caustics.ts) is 55/25/15. Phase 8 lowered this from 2.4, which was
  // ~4.4x the mockup's strength and was the single reason the water at
  // scroll 0 on Home read rgb(130,195,217) rather than foam: at 2.4 the
  // multiply took the 0m stop rgb(246,249,249) down by ~120 on red.
  caustics: 0.55,
  // 'screen'-composited white over near-white surface water was flattening
  // the caustics ripples beneath it (measured ~27/255 scanline variation at
  // the old 0.5, most of it the shafts' own beam shape, not the ripple).
  // The mockup's own peak alpha is 0.5 x its 0.24 first gradient stop, i.e.
  // ~0.12; this is the same dial (see shafts.ts's MID_STOP_FRACTION, which
  // expresses the rest of its gradient as fractions of this).
  shafts: 0.15,
  // The binding element is the faintest on-deep token (--on-deep-3) on a
  // deep card in the deepest water: LogSlate's <dt>/<dd class="unfilled">
  // inside /outside's .topic cards, and the footer's .contacts/.sub, all
  // at 31-32m. Snow and CARD_OPACITY.deep trade directly against each
  // other there, so this number cannot be read without that one.
  //
  // Phase 9 lowered this from 0.37 to buy the translucency the user asked
  // for: at deep 0.72 the analytical worst case was already 4.61, barely
  // over the floor, so making the deep cards more transparent required
  // giving snow back. Measured pairs (analytical worst vs --on-deep-3):
  // deep 0.72/snow 0.37 -> 4.61, deep 0.60/snow 0.37 -> ~4.35 (FAILS),
  // deep 0.60/snow 0.26 -> 4.82. This is the visible cost of the more
  // translucent deep cards, and it is a deliberate trade, not a drift.
  // Phase 9 final: 0.24, sharing the deep zone's headroom with the bright
  // bubbles that now reach the floor of the column. Measured at deep card
  // 0.72: snow 0.24 + deep bubbles 0.15 -> 4.66 worst vs --on-deep-3.
  snow: 0.24,
  shoal: 0.35,
  // Phase 9 lowered this from 0.5 (the mockup's own effective value) for
  // two reasons at once. It buys the light-zone card translucency below —
  // at entry 0.62 the analytical worst goes 4.89 (bubbles 0.5) -> 5.19
  // (bubbles 0.35) — and it is not what made the bubbles read as fake.
  // That was their shape and colour, fixed in bubbles.ts: a dark rim with
  // a dark interior dot reads as a drawn ring, not a bubble. A lighter,
  // smaller bubble with a real specular glint reads better at LESS alpha,
  // so this reduction costs nothing visually.
  bubbles: 0.35,
  // The dark-water treatment, gated below the thermocline. Far lower than
  // `bubbles` above and still far more visible: a bright ring on deep water
  // has vastly more contrast to work with than a dark rim on near-white
  // water, which is why the mockup's bubbles read and ours did not — ours
  // stopped at 17m and never reached the water where a bubble looks like a
  // bubble. Measured ceiling at deep card 0.72 with snow at 0.24 is ~0.20;
  // 0.15 keeps margin under an analytical (not rendered-pixel) bound.
  bubblesDeep: 0.15,
} as const;

// Frosted-glass card opacities — one named constant per component, each
// matching the mockup's own value where it gives one (entry/project), and
// measured against the contrast sweep where it doesn't (header, deep). See
// src/styles/tokens.css's --card-tint/--card-border/--card-shadow for the
// zone-driven colour half of the same mechanism, and each component's own
// `color-mix(in srgb, var(--card-tint) <N>%, transparent)` — which must
// match these numbers by hand, there is no build-time bridge from this TS
// object to that CSS percentage, so each references the other in a
// comment. tests/water/effects.test.ts imports this object directly
// (rather than a second, independently-typed copy) so the analytical
// contrast guarantee and the shipped CSS cannot silently drift apart.
// Phase 9: every value here dropped, because the user judged the cards too
// opaque against the mockup. These are no longer the mockup's numbers — they
// are deliberately BELOW them, and the analytical worst case each one lands
// at (vs the binding token, floor 4.5) is recorded beside it. Lowering any
// of these further without re-running that sweep will breach the floor;
// entry at 0.54 already measures 4.38.
export const CARD_OPACITY = {
  entry: 0.62, // RoleEntry.astro .role — mockup's .entry is 0.72; worst 5.19 @13m vs --ink-2
  project: 0.58, // ProjectCard.astro .project, SiteFooter, Home's hero note + "more" links — mockup's .proj is 0.66; worst 4.95 @13m
  header: 0.5, // SiteHeader.astro — the mockup's own header value, reached now the light-zone bound has room
  deep: 0.72, // deep-zone equivalent (LogSlate's .topic, Home's .interest) — no mockup precedent below the thermocline. Phase 9 tried 0.60 for translucency and put it BACK: the deep zone cannot afford both a translucent card and bright bubbles, and the user chose the bubbles. At 0.60 even 0.10 of deep bubbles measured 4.39, under the floor. Worst here is 4.66 @~31m vs --on-deep-3 with snow 0.24 + deep bubbles 0.15
} as const;
