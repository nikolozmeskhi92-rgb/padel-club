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
export const OPEN_HOUR = 10;
export const CLOSE_HOUR = 24;

/**
 * Staff turnover between cars, in minutes — **inside** the advertised duration,
 * not added to it.
 *
 * It used to be appended to the reserved range, so a "30 minute" wash held the
 * bay for 40. Wash slots are offered on the half hour, and 40 minutes spills
 * into the next one: a single 30-minute wash swallowed 10:00 and 10:30 and the
 * bay could not be sold again until 11:00. Across a 90-minute court booking
 * that is one wash where the club can physically do three.
 *
 * So a 30-minute slot means the car is in at 10:00 and gone by 10:30, turnaround
 * included — which is how the desk actually runs the bays. The constant stays
 * because the club's own planning still needs the number.
 */
export const CHANGEOVER_MINUTES = 10;

/** "YYYY-MM-DD" for the club-local calendar day an instant falls on. */
export function clubDateKey(instant: Date): string {
  return formatInTimeZone(instant, CLUB_TIMEZONE, "yyyy-MM-dd");
}

/** "HH:MM" on the club's wall clock. */
export function clubHHMM(instant: Date): string {
  return formatInTimeZone(instant, CLUB_TIMEZONE, "HH:mm");
}

/**
 * A date on the club's clock, e.g. "Tue, 8 Sep".
 *
 * Anything a customer or the desk reads has to be formatted in this timezone
 * explicitly. date-fns `format` uses the timezone of whatever machine is
 * running — which on Vercel is UTC — so a 10:00 booking went out in emails as
 * 06:00, and a staff alert that formatted its start in club time and its end
 * with date-fns read "10:00 – 07:30", an hour range that runs backwards.
 */
export function clubDateLabel(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CLUB_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(instant);
}

/** "Tue, 8 Sep, 10:00 – 11:30" on the club's clock, both ends of it. */
export function clubTimeRange(start: Date, durationMinutes: number): string {
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return `${clubHHMM(start)} – ${clubHHMM(end)}`;
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

/**
 * How far ahead the public may book, in days.
 *
 * A club that lets anyone reserve six months of Saturday evenings finds them
 * held by people who never turn up. Eight days is the window the desk can
 * actually manage, and eight rather than seven so the strip always reaches the
 * same weekday next week — someone looking on Monday for "next Monday" finds
 * it. Anything further is arranged by talking to someone, which is also when a
 * deposit or a standing slot gets agreed. Staff are not bound by it — see
 * STAFF_HORIZON_DAYS.
 *
 * Counted in calendar days INCLUDING today, so 8 means today plus the next
 * seven, and the last bookable moment is that eighth day's closing time.
 */
export const PUBLIC_HORIZON_DAYS = 8;

/** How far ahead the desk may book on a caller's behalf. */
export const STAFF_HORIZON_DAYS = 30;

/**
 * Whether an instant is inside the booking window for this kind of caller.
 *
 * Counted in whole club days, not in hours from now: "eight days" has to mean
 * the same thing at 09:00 and at 23:00, or the last day on the date strip would
 * quietly stop being bookable as the evening wore on. The window ends at the
 * close of the (horizonDays - 1)th day after today.
 */
export function isWithinBookingHorizon(instant: Date, horizonDays: number): boolean {
  const today = new Date();
  today.setDate(today.getDate() + horizonDays - 1);
  return instant.getTime() < clubDayBounds(clubDateKey(today)).end.getTime();
}
