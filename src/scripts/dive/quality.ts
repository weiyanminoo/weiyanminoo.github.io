// Quality tiers. One dive, three budgets: the scene reads its particle
// counts, pixel ratio and post pass from TierSettings, so a slower device
// gets the same film with less in it rather than a different design
// (spec §1, §11).

export type Tier = 'high' | 'medium' | 'low';

export interface TierInput {
  deviceMemoryGB?: number;
  dpr: number;
  isMobile: boolean;
  medianFrameMs?: number;
}

export interface TierSettings {
  tier: Tier;
  maxDpr: number;
  snowCount: number;
  schoolScale: number;
  post: boolean;
}

// Above this median frame time the tier steps down once.
const SLOW_FRAME_MS = 19;

export function downgrade(tier: Tier): Tier {
  return tier === 'high' ? 'medium' : 'low';
}

export function pickTier(input: TierInput): Tier {
  let tier: Tier = input.isMobile ? 'medium' : 'high';
  if (input.deviceMemoryGB !== undefined && input.deviceMemoryGB <= 4) tier = 'low';
  if (input.medianFrameMs !== undefined && input.medianFrameMs > SLOW_FRAME_MS) tier = downgrade(tier);
  return tier;
}

const SETTINGS: Record<Tier, TierSettings> = {
  // Pixel ratio capped below a high-density display's own: under the film's
  // grain and haze the difference is invisible, and it is most of the cost.
  high: { tier: 'high', maxDpr: 1.25, snowCount: 2500, schoolScale: 1, post: true },
  medium: { tier: 'medium', maxDpr: 1, snowCount: 1500, schoolScale: 0.6, post: true },
  low: { tier: 'low', maxDpr: 1, snowCount: 700, schoolScale: 0.35, post: false },
};

export function settingsFor(tier: Tier): TierSettings {
  return { ...SETTINGS[tier] };
}
