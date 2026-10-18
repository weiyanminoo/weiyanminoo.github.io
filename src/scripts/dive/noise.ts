// Seeded, deterministic noise. The render contract forbids Math.random: any
// frame must come out identical given the same (progress, time), so every
// "random" choice in the dive is a hash of an index and a seed.

/** Integer hash of floor(n) and a seed, in [0, 1). */
export function hash1(n: number, seed = 0): number {
  let h = Math.imul(Math.floor(n) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]: hash1 at the integer lattice,
 *  smoothstep-interpolated between neighbours. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i, seed);
  const b = hash1(i + 1, seed);
  return (a * (1 - u) + b * u) * 2 - 1;
}
