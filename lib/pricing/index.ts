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
};

/**
 * Resolves the price for a requested slot against the pricing_rules table.
 * Matches on: scope, day-of-week, duration, and whether the slot start time
 * falls inside the rule's time window. Highest `priority` wins on overlap
 * (e.g. a Saturday during "peak hours" should use the weekend rule, priority 3).
 */
export function resolvePrice(
  rules: PricingRule[],
  scope: "court" | "car_wash",
  startDate: Date,
  durationMinutes: number
): PricingRule | null {
  const day = startDate.getDay(); // 0=Sun..6=Sat
  const hhmm = toHHMM(startDate);

  const candidates = rules.filter(
    (r) =>
      r.scope === scope &&
      r.duration_minutes === durationMinutes &&
      r.days_of_week.includes(day) &&
      isWithinWindow(hhmm, r.start_time, r.end_time)
  );

  if (candidates.length === 0) return null;

  // Highest priority wins; if tied, cheapest wins (shouldn't normally happen).
  return candidates.sort(
    (a, b) => b.priority - a.priority || a.price_cents - b.price_cents
  )[0];
}

function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

function isWithinWindow(hhmm: string, start: string, end: string): boolean {
  // start/end come from Postgres as "HH:MM:SS"
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  return hhmm >= s && hhmm < e;
}

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/** Whether a given start time falls in the club's general "peak" window — used for UI badges only. */
export function isPeakHour(d: Date): boolean {
  const day = d.getDay();
  const hour = d.getHours();
  const isWeekend = day === 0 || day === 6;
  return isWeekend || (hour >= 18 && hour < 23);
}
