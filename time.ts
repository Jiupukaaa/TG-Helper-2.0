import { DateTime } from "luxon";

// All reminder timestamps are stored in the DB as UTC. Conversion to/from
// the user's local timezone happens ONLY at these two boundaries:
//   1. parsing what the user typed  -> UTC (before writing to DB)
//   2. formatting for display/send  -> local (after reading from DB)
// The cron comparison itself (`dueAt <= now()`) never needs timezone logic
// because both sides are already UTC.

export const DEFAULT_TIMEZONE = "UTC";

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/**
 * Parses a "DD.MM.YYYY HH:mm" string as if it were written in `timezone`,
 * and returns the equivalent instant as a JS Date (UTC under the hood).
 * Returns null if the string doesn't match the expected format or the
 * resulting date/time is invalid (e.g. 31.02.2026).
 */
export function parseLocalDateTime(input: string, timezone: string): Date | null {
  const trimmed = input.trim();
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const [, dd, mm, yyyy, hh, min] = match;
  const dt = DateTime.fromObject(
    {
      day: Number(dd),
      month: Number(mm),
      year: Number(yyyy),
      hour: Number(hh),
      minute: Number(min),
    },
    { zone: timezone }
  );

  if (!dt.isValid) return null;
  return dt.toJSDate();
}

/** Formats a UTC instant back into the user's local timezone for display. */
export function formatLocalDateTime(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: "utc" })
    .setZone(timezone)
    .toFormat("dd.MM.yyyy HH:mm");
}

/** True if the given instant is in the past relative to now. */
export function isInPast(date: Date): boolean {
  return date.getTime() <= Date.now();
}
