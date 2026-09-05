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
  it("accepts the whole trading day, including the morning", () => {
    // The old guard compared getUTCHours() to 8..23 and rejected every one of
    // these with OUTSIDE_OPENING_HOURS.
    for (const label of ["08:00", "09:00", "10:00", "11:00", "11:30"]) {
      const i = clubWallTimeToInstant("2026-09-07", label);
      expect(isWithinOpeningHours(i, 60), `${label} should be bookable`).toBe(true);
    }
  });

  it("rejects times before opening", () => {
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "07:30"), 60)).toBe(false);
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "03:00"), 60)).toBe(false);
  });

  it("requires the slot to finish by closing, not merely start before it", () => {
    // 22:00 + 60 ends exactly at 23:00 — fine.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "22:00"), 60)).toBe(true);
    // 22:30 + 60 would run to 23:30.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "22:30"), 60)).toBe(false);
    // A 90-minute booking needs to start by 21:30.
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "21:30"), 90)).toBe(true);
    expect(isWithinOpeningHours(clubWallTimeToInstant("2026-09-07", "22:00"), 90)).toBe(false);
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
