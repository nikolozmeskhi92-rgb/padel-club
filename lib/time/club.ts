import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

/**
 * One definition of the club's wall clock, mirroring `club_timezone()` in
 * supabase/migrations/0002. Migration 0002 fixed exactly this class of bug for
 * the nightly report — `::date` was being evaluated in the server's timezone
 * (UTC on Vercel) rather than the club's — but the TypeScript side never got
 * the same treatment, so the booking API and the pricing resolver were still
 * reading hours off a UTC clock.
 *
 * Three different clocks used to be in play for one booking:
 *   - the browser's, in the slot grid (`setHours` on a local Date)
 *   - UTC, in the API's opening-hours guard (`getUTCHours`)
 *   - UTC again, in the pricing resolver (`getHours` on a Vercel server)
 *
 * None of them was the club's. Everything below works in the club's zone, so a
 * customer in Berlin and a customer in Tbilisi book the same real hour and are
 * charged the same rate for it.
 *
 * Keep this value in step with `club_timezone()` in SQL if the club ever moves.
 */
export const CLUB_TIMEZONE = process.env.NEXT_PUBLIC_CLUB_TIMEZONE || "Asia/Tbilisi";

/** The club's opening hours, in club-local time. The one source for both flows. */
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 23;

/** Minutes of staff turnover between two cars in the same wash bay. */
export const CHANGEOVER_MINUTES = 10;

/** "YYYY-MM-DD" for the club-local calendar day an instant falls on. */
export function clubDateKey(instant: Date): string {
  return formatInTimeZone(instant, CLUB_TIMEZONE, "yyyy-MM-dd");
}

/** "HH:MM" on the club's wall clock. */
export function clubHHMM(instant: Date): string {
  return formatInTimeZone(instant, CLUB_TIMEZONE, "HH:mm");
}

/** Hour (0-23) on the club's wall clock. */
export function clubHour(instant: Date): number {
  return Number(formatInTimeZone(instant, CLUB_TIMEZONE, "H"));
}

/** Day of week on the club's wall clock, 0=Sunday..6=Saturday — matches Postgres `dow`. */
export function clubDayOfWeek(instant: Date): number {
  return Number(formatInTimeZone(instant, CLUB_TIMEZONE, "i")) % 7; // date-fns `i` is 1=Mon..7=Sun
}

/**
 * The UTC instant for a wall-clock time at the club.
 * `clubWallTimeToInstant("2026-09-07", "08:00")` is 04:00Z while Tbilisi is UTC+4.
 */
export function clubWallTimeToInstant(dateKey: string, hhmm: string): Date {
  return fromZonedTime(`${dateKey} ${hhmm}`, CLUB_TIMEZONE);
}

/** Half-open [start, end) UTC bounds of one club-local calendar day. */
export function clubDayBounds(dateKey: string): { start: Date; end: Date } {
  const start = clubWallTimeToInstant(dateKey, "00:00");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Whether an instant falls inside the club's opening hours, on the club's clock. */
export function isWithinOpeningHours(instant: Date, durationMinutes = 0): boolean {
  const startHour = clubHour(instant);
  if (startHour < OPEN_HOUR) return false;
  // The slot has to *finish* by closing time, not merely start before it.
  const endsAt = new Date(instant.getTime() + durationMinutes * 60_000);
  const startKey = clubDateKey(instant);
  const endKey = clubDateKey(endsAt);
  const endMinutes =
    endKey === startKey
      ? hhmmToMinutes(clubHHMM(endsAt))
      : 24 * 60 + hhmmToMinutes(clubHHMM(endsAt)); // ran past local midnight
  return endMinutes <= CLOSE_HOUR * 60;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** The club-local "HH:MM" slot labels between opening and closing, every `stepMinutes`. */
export function buildSlotLabels(stepMinutes = 30): string[] {
  const out: string[] = [];
  for (let m = OPEN_HOUR * 60; m < CLOSE_HOUR * 60; m += stepMinutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return out;
}

/**
 * The cancellation window quoted in marketing copy, in hours.
 *
 * The authoritative value lives in the one-row `cancellation_policy` table and
 * is what the cancel flow actually enforces; this constant exists only so the
 * static pages quote the same number. They previously disagreed: the home page
 * promised free cancellation up to 24 hours ahead while /directions said
 * anything within 4 hours was non-refundable. Keep this in step with the row,
 * or read the row server-side if the club starts changing it often.
 */
export const FREE_CANCELLATION_HOURS = 24;
