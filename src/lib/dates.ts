// Shared date-formatting helpers for roles and projects.
// Dates from content collections are coerced from date-only ISO strings
// (e.g. "2026-08-01"), which parse to UTC midnight — so every read here
// uses the UTC getters to avoid shifting a day/month in local timezones.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function monthYear(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function monthOnly(date: Date): string {
  return MONTHS[date.getUTCMonth()];
}

/**
 * "Aug 2026 — present" for a current role.
 * "Jun — Aug 2026" for a past role within one calendar year.
 * "May 2025 — Dec 2025" for a past role spanning years.
 */
export function formatRolePeriod(start: Date, end: Date | null, current: boolean): string {
  if (current || end === null) {
    return `${monthYear(start)} — present`;
  }

  if (start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${monthOnly(start)} — ${monthYear(end)}`;
  }

  return `${monthYear(start)} — ${monthYear(end)}`;
}

/** As a role's: "Oct 2025 — present", "Feb — Apr 2025", "Nov 2025 — Jan
 *  2026"; a finished project with no end month written, its start alone. */
export function formatProjectPeriod(start: Date, end: Date | null, ongoing: boolean): string {
  if (!ongoing && end === null) return monthYear(start);
  return formatRolePeriod(start, end, ongoing);
}

/** Newest first by start; projects started the same month, the one that
 *  ran later first (an ongoing one runs to now). */
export function byProjectRecency(
  a: { start: Date; end: Date | null; ongoing: boolean },
  b: { start: Date; end: Date | null; ongoing: boolean },
): number {
  const last = (p: typeof a) => (p.ongoing || p.end === null ? Date.now() : p.end.getTime());
  return b.start.getTime() - a.start.getTime() || last(b) - last(a);
}
