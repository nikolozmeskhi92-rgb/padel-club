import { clubDayOfWeek, clubHHMM, clubHour, CLUB_TIMEZONE } from "@/lib/time/club";

export type PricingRule = {
  id: number;
  scope: "court" | "car_wash";
  label: string;
  days_of_week: number[];
  start_time: string; // "HH:MM:SS"
  end_time: string;
  duration_minutes: number;
  price_cents: number;
  priority: number;
  /** Wash rules name the service they price; court rules leave this null. */
  service?: string | null;
};

export type WashService = "quick_wash" | "full_detail" | "express_rinse";

/**
 * Resolves the price for a requested slot against the pricing_rules table.
 * Matches on: scope, day-of-week, duration, and whether the slot start time
 * falls inside the rule's time window. Highest `priority` wins on overlap
 * (e.g. a Saturday during "peak hours" should use the weekend rule, priority 3).
 *
 * Day and time are read on the CLUB's clock, not the server's. This used to use
 * `getDay()`/`getHours()`, which on Vercel is UTC: with the club at UTC+4 a
 * rule window of 18:00-23:00 was being matched against 18:00-23:00 UTC, i.e.
 * 22:00-03:00 club time. Every booking from 18:00 to 21:59 — the busiest part
 * of the evening — resolved to the off-peak rate and the club was undercharged.
 * The same shift moved Saturday-night bookings onto Friday's rules.
 *
 * `service` narrows a car wash lookup to the service the customer chose. Quick
 * Wash and Express Rinse are both 30 minutes, so matching on duration alone let
 * them both qualify and the cheapest-wins tie-break charged ₾8 for a ₾12
 * Express Rinse. Migration 0006 put `service` on the rules; pass it for wash
 * lookups and the ambiguity is gone.
 */
export function resolvePrice(
  rules: PricingRule[],
  scope: "court" | "car_wash",
  startDate: Date,
  durationMinutes: number,
  service?: string | null
): PricingRule | null {
  const day = clubDayOfWeek(startDate); // 0=Sun..6=Sat, on the club's clock
  const hhmm = clubHHMM(startDate);

  const candidates = rules.filter(
    (r) =>
      r.scope === scope &&
      r.duration_minutes === durationMinutes &&
      (service == null || r.service === service) &&
      r.days_of_week.includes(day) &&
      isWithinWindow(hhmm, r.start_time, r.end_time)
  );

  if (candidates.length === 0) return null;

  // Highest priority wins; if tied, cheapest wins (shouldn't normally happen).
  return candidates.sort(
    (a, b) => b.priority - a.priority || a.price_cents - b.price_cents
  )[0];
}

function isWithinWindow(hhmm: string, start: string, end: string): boolean {
  // start/end come from Postgres as "HH:MM:SS"
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  return hhmm >= s && hhmm < e;
}

// Money formatting lives in lib/currency.ts so the UI, the email and the
// Telegram report all read from one place. Re-exported here for the existing
// `import { formatMoney } from "@/lib/pricing"` call sites.
export { formatMoney, CURRENCY } from "@/lib/currency";

/**
 * Whether a start time falls in the club's general "peak" window — used for UI
 * badges only. Also on the club's clock: this runs in the browser, so it used
 * to read the *visitor's* hour. A customer in London saw no peak badge on a
 * slot the server charged as peak, which is the worst way to learn a price.
 */
export function isPeakHour(d: Date): boolean {
  const day = clubDayOfWeek(d);
  const hour = clubHour(d);
  const isWeekend = day === 0 || day === 6;
  return isWeekend || (hour >= 18 && hour < 23);
}

/** Re-exported so callers that price things also have the zone they priced in. */
export { CLUB_TIMEZONE };
