import { describe, expect, it } from "vitest";
import { recommendWashForCourtSlot, type WashService } from "@/lib/carwash/suggest";
import { CLOSE_HOUR, OPEN_HOUR, clubWallTimeToInstant } from "@/lib/time/club";

/**
 * The wash cross-sell went silently dead when the club's closing time moved to
 * 24:00: the search window was built from the string "24:00", which is not a
 * wall-clock time, and the parser read it as 00:00 of the same day. Closing
 * landed before opening, no candidate was ever generated, and every customer
 * was told the bays were full.
 *
 * These tests are about that class of bug — a window that quietly collapses —
 * so they assert against OPEN_HOUR and CLOSE_HOUR rather than hard-coded times,
 * and will fail again if the hours move somewhere the arithmetic cannot follow.
 */

const SERVICES: WashService[] = [
  { id: "quick_wash", label: "Quick Wash", durationMinutes: 30, priceCents: 800 },
  { id: "full_detail", label: "Full Detail", durationMinutes: 60, priceCents: 1500 },
  { id: "express_rinse", label: "Express Rinse", durationMinutes: 20, priceCents: 1200 },
];

const at = (hhmm: string) => clubWallTimeToInstant("2026-09-07", hhmm);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

describe("wash recommendations", () => {
  it("offers a wash for a mid-day match when every bay is empty", () => {
    const r = recommendWashForCourtSlot({
      courtStart: at("11:00"),
      courtEnd: at("12:00"),
      services: SERVICES,
      existingBayBookings: [],
    });

    expect(r.tier).not.toBe("no_wash_today");
    expect(r.best).not.toBeNull();
    // The club sells three washes; the customer should be offered three.
    expect(r.perService).toHaveLength(SERVICES.length);
  });

  it("covers the whole trading day, opening hour to closing hour", () => {
    const first = recommendWashForCourtSlot({
      courtStart: at(hh(OPEN_HOUR)),
      courtEnd: at(hh(OPEN_HOUR + 1)),
      services: SERVICES,
      existingBayBookings: [],
    });
    expect(first.tier).not.toBe("no_wash_today");

    // The last hour of the day has to be bookable too — it was the hour most
    // easily lost to an off-by-one in the window.
    const last = recommendWashForCourtSlot({
      courtStart: at(hh(CLOSE_HOUR - 1)),
      courtEnd: at(hh(CLOSE_HOUR)),
      services: SERVICES,
      existingBayBookings: [],
    });
    expect(last.tier).not.toBe("no_wash_today");
  });

  it("never suggests a wash outside opening hours", () => {
    const r = recommendWashForCourtSlot({
      courtStart: at("11:00"),
      courtEnd: at("12:00"),
      services: SERVICES,
      existingBayBookings: [],
    });
    const dayOpen = at(hh(OPEN_HOUR)).getTime();
    const dayClose = clubWallTimeToInstant("2026-09-07", "00:00").getTime() + CLOSE_HOUR * 3600_000;

    for (const s of [r.best!, ...r.alternatives, ...r.perService]) {
      expect(s.start.getTime()).toBeGreaterThanOrEqual(dayOpen);
      expect(s.end.getTime()).toBeLessThanOrEqual(dayClose);
    }
  });

  it("says no_wash_today only when the bays really are full all day", () => {
    const midnight = clubWallTimeToInstant("2026-09-07", "00:00").getTime();
    const blockAll = [1, 2, 3, 4].map((bayId) => ({
      bayId,
      start: new Date(midnight),
      end: new Date(midnight + 24 * 3600_000),
    }));

    const r = recommendWashForCourtSlot({
      courtStart: at("11:00"),
      courtEnd: at("12:00"),
      services: SERVICES,
      existingBayBookings: blockAll,
    });
    expect(r.tier).toBe("no_wash_today");
    expect(r.best).toBeNull();
  });
});
