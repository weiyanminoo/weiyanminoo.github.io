// The diver's breathing, as a closed-form clock. The bubbles that rise past
// the lens and the regulator sound (spec §7) both read this, so what the
// visitor sees and hears exhale together.
//
// A steady 5 s cycle with a slow wobble, so breaths are not metronomic:
// u = t/5 + 0.08·sin(0.37t). Its derivative (0.2 ± 0.03) never reaches
// zero, so the phase only ever moves forward.

export const BREATH_PERIOD_S = 5;

// Inhale is the first 40% of each cycle, exhale the rest.
const EXHALE_FROM = 0.4;
const WOBBLE = 0.08;
const WOBBLE_RATE = 0.37;

export interface Breath {
  cycle: number;
  /** 0..1 through the current cycle. */
  phase: number;
  /** 0 during the inhale, rising 0→1 across the exhale. */
  exhale: number;
}

export function breathAt(timeS: number): Breath {
  const u = timeS / BREATH_PERIOD_S + WOBBLE * Math.sin(timeS * WOBBLE_RATE);
  const cycle = Math.floor(u);
  const phase = u - cycle;
  const exhale = phase < EXHALE_FROM ? 0 : (phase - EXHALE_FROM) / (1 - EXHALE_FROM);
  return { cycle, phase, exhale };
}
