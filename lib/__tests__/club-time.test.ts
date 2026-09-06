import { describe, it, expect } from "vitest";
import {
  CLOSE_HOUR,
  OPEN_HOUR,
  buildSlotLabels,
  clubDateKey,
  clubDayOfWeek,
  clubHHMM,
  clubHour,
  clubWallTimeToInstant,
  clubDayBounds,
  isWithinOpeningHours,
} from "@/lib/time/club";

/**
 * These cover the bugs that shipped because nothing on the TypeScript side ever
 * asserted which clock a time was read on. The club is at UTC+4 and the server
 * runs UTC, so every case below would have failed before the fix.
 */
describe("club wall clock", () => {
  it("maps a club-local label to the right UTC instant", () => {
    expect(clubWallTimeToInstant("2026-09-07", "08:00").toISOString()).toBe(
      "2026-09-07T04:00:00.000Z"
    );
    expect(clubWallTimeToInstant("2026-09-07", "20:00").toISOString()).toBe(
      "2026-09-07T16:00:00.000Z"
    );
  });

  it("round-trips an instant back to the club's hour", () => {
    const i = clubWallTimeToInstant("2026-09-07", "08:00");
    expect(clubHour(i)).toBe(8);
    expect(clubHHMM(i)).toBe("08:00");
    expect(clubDateKey(i)).toBe("2026-09-07");
  });

  it("reads the club's calendar day, not the UTC one, either side of midnight", () => {
    // 01:00 club time on the 7th is still 21:00 UTC on the 6th.
    const justAfterMidnight = clubWallTimeToInstant("2026-09-07", "01:00");
    expect(justAfterMidnight.toISOString()).toBe("2026-09-06T21:00:00.000Z");
    expect(clubDateKey(justAfterMidnight)).toBe("2026-09-07");
  });

  it("reports day-of-week Sunday=0, on the club's clock", () => {
    expect(clubDayOfWeek(clubWallTimeToInstant("2026-09-06", "12:00"))).toBe(0); // Sunday
    expect(clubDayOfWeek(clubWallTimeToInstant("2026-09-07", "12:00"))).toBe(1); // Monday
    expect(clubDayOfWeek(clubWallTimeToInstant("2026-09-05", "12:00"))).toBe(6); // Saturday
  });

  it("keeps Saturday night on Saturday", () => {
    // 23:00 Saturday club time is 19:00 UTC Saturday — but 01:00 Sunday club
    // time is 21:00 UTC Saturday, which the old getDay() read as Saturday.
    const sundayEarly = clubWallTimeToInstant("2026-09-06", "01:00");
    expect(sundayEarly.toISOString()).toBe("2026-09-05T21:00:00.000Z");
    expect(clubDayOfWeek(sundayEarly)).toBe(0); // Sunday, not Saturday
  });
});

describe("opening hours", () => {
  it("accepts the whole trading day, including the first hour", () => {
    // The old guard compared getUTCHours() to a fixed pair and rejected the
    // start of the day outright with OUTSIDE_OPENING_HOURS. Derived from
    // OPEN_HOUR so it follows the club rather than needing an edit every time
    // the hours move — which is exactly how this file went stale.
    for (const h of [OPEN_HOUR, OPEN_HOUR + 1, OPEN_HOUR + 2]) {
      const label = `${String(h).padStart(2, "0")}:00`;
      const i = clubWallTimeToInstant("2026-09-07", label);
      expect(isWithinOpeningHours(i, 60), `${label} should be bookable`).toBe(true);
    }
  });

  it("rejects times before opening", () => {
    const before = `${String(OPEN_HOUR - 1).padStart(2, "0")}:30`;
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", before), 60)).toBe(false);
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "03:00"), 60)).toBe(false);
  });

  it("requires the slot to finish by closing, not merely start before it", () => {
    const lastHour = `${String(CLOSE_HOUR - 1).padStart(2, "0")}:00`;
    const halfPastLast = `${String(CLOSE_HOUR - 1).padStart(2, "0")}:30`;
    const ninetyLatest = `${String(CLOSE_HOUR - 2).padStart(2, "0")}:30`;
    // The last hour ends exactly at closing — fine.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", lastHour), 60)).toBe(true);
    // Half an hour later would run past it.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", halfPastLast), 60)).toBe(false);
    // A 90-minute booking has to start an hour and a half before closing.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", ninetyLatest), 90)).toBe(true);
    // Any later and the 90 minutes cross closing — and, at 24:00, midnight,
    // which is the case the end-of-day arithmetic gets wrong if it compares
    // wall-clock strings instead of minutes.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", lastHour), 90)).toBe(false);
  });
});

describe("club day bounds", () => {
  it("spans the club's day, not the UTC one", () => {
    const { start, end } = clubDayBounds("2026-09-07");
    expect(start.toISOString()).toBe("2026-09-06T20:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-07T20:00:00.000Z");
  });

  it("contains every bookable slot of that day", () => {
    const { start, end } = clubDayBounds("2026-09-07");
    for (const label of buildSlotLabels(30)) {
      const i = clubWallTimeToInstant("2026-09-07", label);
      expect(i >= start && i < end, `${label} inside day bounds`).toBe(true);
    }
  });
});

describe("slot labels", () => {
  it("runs from opening to closing and nowhere else", () => {
    const slots = buildSlotLabels(30);
    expect(slots[0]).toBe(`${String(OPEN_HOUR).padStart(2, "0")}:00`);
    expect(slots.at(-1)).toBe(`${String(CLOSE_HOUR - 1).padStart(2, "0")}:30`);
    expect(slots).toHaveLength((CLOSE_HOUR - OPEN_HOUR) * 2);
  });
});
