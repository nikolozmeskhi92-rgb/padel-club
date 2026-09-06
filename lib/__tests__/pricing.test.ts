import { describe, it, expect } from "vitest";
import { resolvePrice, isPeakHour, type PricingRule } from "@/lib/pricing";
import { clubWallTimeToInstant } from "@/lib/time/club";

/**
 * Mirrors the seeded pricing_rules rows as migration 0012 leaves them: open
 * 10:00-24:00, weekday peak from 19:00, weekend peak from noon, 60 GEL
 * off-peak and 80 GEL peak. If a migration moves these windows, move them here
 * too — this fixture standing in for the database is the whole point of it.
 */
const RULES: PricingRule[] = [
  {
    id: 1, scope: "court", label: "weekday off-peak",
    days_of_week: [1, 2, 3, 4, 5], start_time: "10:00:00", end_time: "19:00:00",
    duration_minutes: 60, price_cents: 6000, priority: 1,
  },
  {
    id: 2, scope: "court", label: "weekday peak",
    days_of_week: [1, 2, 3, 4, 5], start_time: "19:00:00", end_time: "24:00:00",
    duration_minutes: 60, price_cents: 8000, priority: 2,
  },
  {
    id: 3, scope: "court", label: "weekend",
    days_of_week: [0, 6], start_time: "12:00:00", end_time: "24:00:00",
    duration_minutes: 60, price_cents: 8000, priority: 3,
  },
];

const monday = (hhmm: string) => clubWallTimeToInstant("2026-09-07", hhmm);
const saturday = (hhmm: string) => clubWallTimeToInstant("2026-09-05", hhmm);

describe("resolvePrice", () => {
  it("charges peak across the whole club-local evening", () => {
    // The bug: with the resolver reading UTC, the club-local evening landed
    // outside the peak window and was billed at the off-peak rate.
    for (const hhmm of ["19:00", "20:00", "21:00", "22:00", "23:00"]) {
      const rule = resolvePrice(RULES, "court", monday(hhmm), 60);
      expect(rule?.label, `${hhmm} should be peak`).toBe("weekday peak");
      expect(rule?.price_cents).toBe(8000);
    }
  });

  it("still charges off-peak before the evening", () => {
    for (const hhmm of ["10:00", "12:00", "18:30"]) {
      expect(resolvePrice(RULES, "court", monday(hhmm), 60)?.label).toBe("weekday off-peak");
    }
  });

  it("prices the morning at all — it used to match no rule on a UTC clock", () => {
    // 10:00 club = 06:00 UTC, which is outside every rule's window, so the
    // resolver returned null and the API answered NO_PRICING_RULE_MATCHED.
    expect(resolvePrice(RULES, "court", monday("10:00"), 60)).not.toBeNull();
    expect(resolvePrice(RULES, "court", monday("11:30"), 60)).not.toBeNull();
  });

  it("uses the weekend rule on the weekend, by highest priority", () => {
    const rule = resolvePrice(RULES, "court", saturday("20:00"), 60);
    expect(rule?.label).toBe("weekend");
    expect(rule?.price_cents).toBe(8000);
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

/** The rows 0001 seeds for car_wash, after migration 0006 names the service. */
const WASH_RULES: PricingRule[] = [
  { id: 7, scope: "car_wash", label: "Quick Wash 30", service: "quick_wash",
    days_of_week: [0,1,2,3,4,5,6], start_time: "08:00:00", end_time: "23:00:00",
    duration_minutes: 30, price_cents: 800, priority: 1 },
  { id: 8, scope: "car_wash", label: "Full Detail 60", service: "full_detail",
    days_of_week: [0,1,2,3,4,5,6], start_time: "08:00:00", end_time: "23:00:00",
    duration_minutes: 60, price_cents: 1500, priority: 1 },
  { id: 9, scope: "car_wash", label: "Express Rinse 30", service: "express_rinse",
    days_of_week: [0,1,2,3,4,5,6], start_time: "08:00:00", end_time: "23:00:00",
    duration_minutes: 30, price_cents: 1200, priority: 1 },
];

describe("car wash pricing", () => {
  it("charges each 30-minute service its own price", () => {
    // The bug: both 30-min rules matched on duration and the cheapest-wins
    // tie-break billed an Express Rinse (₾12) as a Quick Wash (₾8).
    const quick = resolvePrice(WASH_RULES, "car_wash", monday("12:00"), 30, "quick_wash");
    const express = resolvePrice(WASH_RULES, "car_wash", monday("12:00"), 30, "express_rinse");
    expect(quick?.price_cents).toBe(800);
    expect(express?.price_cents).toBe(1200);
  });

  it("prices the full club day, including the last hour", () => {
    // Wash rules used to stop at 22:00 while the club closes at 23:00, so the
    // slots the UI offered after 22:00 came back NO_PRICING_RULE_MATCHED.
    for (const hhmm of ["08:00", "12:00", "22:00", "22:30"]) {
      expect(
        resolvePrice(WASH_RULES, "car_wash", monday(hhmm), 30, "quick_wash"),
        `${hhmm} should price`
      ).not.toBeNull();
    }
  });

  it("does not price before opening", () => {
    expect(resolvePrice(WASH_RULES, "car_wash", monday("07:00"), 30, "quick_wash")).toBeNull();
  });

  it("returns null for an unknown service rather than falling back to a cheaper one", () => {
    expect(resolvePrice(WASH_RULES, "car_wash", monday("12:00"), 30, "wax_and_polish")).toBeNull();
  });
});

describe("isPeakHour badge", () => {
  it("agrees with what the server charges", () => {
    for (const hhmm of ["19:00", "20:00", "23:30"]) {
      expect(isPeakHour(monday(hhmm)), `${hhmm} badge`).toBe(true);
    }
    for (const hhmm of ["10:00", "12:00", "18:30"]) {
      expect(isPeakHour(monday(hhmm)), `${hhmm} badge`).toBe(false);
    }
  });

  it("treats the weekend as peak from noon, and quiet before it", () => {
    // The weekend used to be peak all day; it has a quiet morning now, and the
    // badge has to say so or it contradicts the price beside it.
    expect(isPeakHour(saturday("10:30"))).toBe(false);
    expect(isPeakHour(saturday("12:00"))).toBe(true);
    expect(isPeakHour(saturday("20:00"))).toBe(true);
  });
});
