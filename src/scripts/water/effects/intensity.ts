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
  caustics: 2.4, // multiplier on the trough depth — raised now shafts no longer flatten it (see `shafts` below)
  // 'screen'-composited white over near-white surface water was flattening
  // the caustics ripples beneath it (measured ~27/255 scanline variation at
  // the old 0.5, most of it the shafts' own beam shape, not the ripple) —
  // lowering this let the caustics multiplier above be raised instead, so
  // the ripples read as rippling light rather than being washed out.
  shafts: 0.15,
  // Mockup's effective value is 0.5*dark ≈ 0.5. Still short of it, and the
  // reason changed in fix round 3: the "not on a card" bound is no longer
  // what stops snow (every remaining uncarded element is LARGE text at
  // 3:1 — see tests/water/effects.test.ts), the deep CONTENT-CARD bound is.
  // The binding element is the faintest on-deep token (--on-deep-3) on a
  // deep card in the deepest water: LogSlate's <dt>/<dd class="unfilled">
  // inside /outside's .topic cards, and the footer's .contacts/.sub, all
  // at 31-32m. Measured ceiling with CARD_OPACITY.deep at 0.72 is ~0.395;
  // this keeps a margin under it rather than shipping right at the edge of
  // an analytical (not rendered-pixel) model. See phase-7-report.md.
  snow: 0.37,
  shoal: 0.35,
  // The mockup's own effective value (0.5*bub), reached in fix round 3:
  // carding the hero copy and Home's three "more" links left no uncarded
  // NORMAL-size text anywhere on the site, so the bound over bubbles'
  // 5-17m range is the 3:1 large-text one (Projects' uncarded <h1> at
  // ~13m, 80px/800) rather than 4.5:1. Measured ceiling ~0.560.
  bubbles: 0.5,
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
export const CARD_OPACITY = {
  entry: 0.72, // RoleEntry.astro .role — mockup's .entry
  project: 0.66, // ProjectCard.astro .project — mockup's .proj
  header: 0.62, // SiteHeader.astro — no mockup precedent for the header actually holding contrast across a full-column page (see that file's comment); tuned to clear both bounds
  deep: 0.72, // deep-zone card equivalent (LogSlate's section wrapper, Home's zone-deep section) — no mockup precedent below the thermocline at all (finding 1); raised 0.62 -> 0.72 in fix round 3 (the mockup's own densest card, .entry) because this, not the uncarded bound, is what caps `snow` above
} as const;
