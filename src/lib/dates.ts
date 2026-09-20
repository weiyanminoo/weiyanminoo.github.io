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

/** "Feb 2025 — ongoing" for an ongoing project, "Feb 2025" otherwise. */
export function formatProjectPeriod(start: Date, ongoing: boolean): string {
  return ongoing ? `${monthYear(start)} — ongoing` : monthYear(start);
}
