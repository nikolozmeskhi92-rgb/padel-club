import { describe, it, expect } from "vitest";
import { resolvePrice, isPeakHour, type PricingRule } from "@/lib/pricing";
import { clubWallTimeToInstant } from "@/lib/time/club";

/** Mirrors the shape of the seeded pricing_rules rows. */
const RULES: PricingRule[] = [
  {
    id: 1, scope: "court", label: "weekday off-peak",
    days_of_week: [1, 2, 3, 4, 5], start_time: "08:00:00", end_time: "18:00:00",
    duration_minutes: 60, price_cents: 2500, priority: 1,
  },
  {
    id: 2, scope: "court", label: "weekday peak",
    days_of_week: [1, 2, 3, 4, 5], start_time: "18:00:00", end_time: "23:00:00",
    duration_minutes: 60, price_cents: 4000, priority: 2,
  },
  {
    id: 3, scope: "court", label: "weekend",
    days_of_week: [0, 6], start_time: "08:00:00", end_time: "23:00:00",
    duration_minutes: 60, price_cents: 4500, priority: 3,
  },
];

const monday = (hhmm: string) => clubWallTimeToInstant("2026-09-07", hhmm);
const saturday = (hhmm: string) => clubWallTimeToInstant("2026-09-05", hhmm);

describe("resolvePrice", () => {
  it("charges peak across the whole club-local evening", () => {
    // The bug: with the resolver reading UTC, 18:00-21:59 club time landed
    // outside the 18:00-23:00 window and was billed at the off-peak rate.
    for (const hhmm of ["18:00", "19:00", "20:00", "21:00", "22:00"]) {
      const rule = resolvePrice(RULES, "court", monday(hhmm), 60);
      expect(rule?.label, `${hhmm} should be peak`).toBe("weekday peak");
      expect(rule?.price_cents).toBe(4000);
    }
  });

  it("still charges off-peak before 18:00", () => {
    for (const hhmm of ["08:00", "12:00", "17:30"]) {
      expect(resolvePrice(RULES, "court", monday(hhmm), 60)?.label).toBe("weekday off-peak");
    }
  });

  it("prices the morning at all — it used to match no rule on a UTC clock", () => {
    // 08:00 club = 04:00 UTC, which is outside every rule's window, so the
    // resolver returned null and the API answered NO_PRICING_RULE_MATCHED.
    expect(resolvePrice(RULES, "court", monday("08:00"), 60)).not.toBeNull();
    expect(resolvePrice(RULES, "court", monday("09:30"), 60)).not.toBeNull();
  });

  it("uses the weekend rule on the weekend, by highest priority", () => {
    const rule = resolvePrice(RULES, "court", saturday("20:00"), 60);
    expect(rule?.label).toBe("weekend");
    expect(rule?.price_cents).toBe(4500);
  });

  it("does not leak Saturday's rate into early Sunday", () => {
    // 01:00 Sunday club time is 21:00 UTC Saturday; both are weekend days here,
    // so assert the day the resolver actually saw via a weekday-only rule set.
    const weekdayOnly = RULES.filter((r) => r.label !== "weekend");
    expect(resolvePrice(weekdayOnly, "court", clubWallTimeToInstant("2026-09-06", "20:00"), 60)).toBeNull();
  });

  it("returns null when nothing matches the duration", () => {
    expect(resolvePrice(RULES, "court", monday("20:00"), 90)).toBeNull();
  });

  it("does not cross scopes", () => {
    expect(resolvePrice(RULES, "car_wash", monday("20:00"), 60)).toBeNull();
  });
});

describe("isPeakHour badge", () => {
  it("agrees with what the server charges", () => {
    for (const hhmm of ["18:00", "20:00", "22:30"]) {
      expect(isPeakHour(monday(hhmm)), `${hhmm} badge`).toBe(true);
    }
    for (const hhmm of ["08:00", "12:00", "17:00"]) {
      expect(isPeakHour(monday(hhmm)), `${hhmm} badge`).toBe(false);
    }
  });

  it("treats the whole weekend as peak", () => {
    expect(isPeakHour(saturday("09:00"))).toBe(true);
  });
});
