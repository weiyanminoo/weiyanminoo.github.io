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
  // Mockup's effective value is 0.5*dark ≈ 0.5. The "not on a card" bound
  // (tests/water/effects.test.ts) is the actual ceiling here, not the
  // mockup: snow is the only particle effect visible in the deep zone
  // (24-32m), which is exactly where the Outside/Home <h1> and section
  // headings render with no card. Measured max before that bound breaks is
  // ~0.330; this keeps a margin under it rather than shipping right at the
  // edge of an analytical (not rendered-pixel) model. See phase-7-report.md.
  snow: 0.31,
  shoal: 0.35,
  // Mockup's effective value is 0.5*bub ≈ 0.5. Same ceiling reasoning as
  // snow: bubbles (5-17m) overlaps the shoal's own gate in the light zone,
  // where Work/Projects' uncarded <h1> render — measured max ~0.269 with
  // shoal held at 0.35. See phase-7-report.md.
  bubbles: 0.26,
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
  deep: 0.62, // deep-zone card equivalent (LogSlate's section wrapper, Home's zone-deep section) — no mockup precedent below the thermocline at all (finding 1); tuned to clear the deep bound
} as const;
