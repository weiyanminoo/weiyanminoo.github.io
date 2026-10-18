/** Clamps x to [lo, hi]. NaN clamps to lo, so a degenerate input (a page
 *  with no scroll height, say) lands on the first frame instead of
 *  poisoning every value downstream. */
export function clamp(x: number, lo: number, hi: number): number {
  if (Number.isNaN(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/** Hermite smoothstep between two edges, clamped. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Written as a·(1−t) + b·t rather than a + (b−a)·t so both endpoints come
 *  back exactly — table lookups are compared for equality in tests. */
export function lerp(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}
