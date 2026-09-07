import { describe, expect, it } from "vitest";
import {
  clubDateLabel,
  clubTimeRange,
  clubHHMM,
  clubWallTimeToInstant,
} from "@/lib/time/club";

/**
 * Anything a customer or the desk reads must be formatted on the club's clock.
 *
 * The staff alert formatted its start in club time and its end with date-fns,
 * which uses the timezone of whatever machine is running it — UTC on Vercel. So
 * a 10:00 court booking for 90 minutes went out as "10:00 – 07:30 (club time)":
 * a range that runs four hours backwards. The customer's confirmation was worse
 * but quieter, being wrong at both ends and therefore self-consistent — 10:00
 * arrived as "06:00 – 07:30" and nobody could tell it was the same booking.
 *
 * These run with TZ unset, i.e. the container's UTC, which is exactly the
 * condition that produced the bug.
 */
describe("labels are on the club's clock, not the server's", () => {
  const tenAm = clubWallTimeToInstant("2026-09-08", "10:00");

  it("formats a time range forwards, both ends in club time", () => {
    expect(clubTimeRange(tenAm, 90)).toBe("10:00 – 11:30");
    expect(clubTimeRange(tenAm, 60)).toBe("10:00 – 11:00");
    expect(clubTimeRange(tenAm, 30)).toBe("10:00 – 10:30");
  });

  it("never produces a range that ends before it starts", () => {
    // Every slot the club can actually sell: one that finishes by closing.
    // A range that runs backwards is the shape of the bug — an end formatted in
    // a different timezone from its start.
    for (const hhmm of ["10:00", "13:30", "19:00", "22:00", "22:30", "23:00"]) {
      for (const mins of [30, 60, 90]) {
        const [h, m] = hhmm.split(":").map(Number);
        if (h * 60 + m + mins > 24 * 60) continue; // not bookable, see isWithinOpeningHours
        const start = clubWallTimeToInstant("2026-09-08", hhmm);
        const [from, to] = clubTimeRange(start, mins).split(" – ");
        if (to === "00:00") continue; // finishing exactly at closing reads as midnight
        expect(to > from, `${hhmm} + ${mins} gave ${from} – ${to}`).toBe(true);
      }
    }
  });

  it("names the club's day, not UTC's", () => {
    // 23:00 in Tbilisi is 19:00Z the same day; 00:30 is 20:30Z the day BEFORE,
    // which is where a server-timezone label silently changes the date.
    const lateEvening = clubWallTimeToInstant("2026-09-08", "23:00");
    expect(clubDateLabel(lateEvening)).toContain("8 Sept");
    expect(clubHHMM(lateEvening)).toBe("23:00");

    const justAfterMidnight = clubWallTimeToInstant("2026-09-09", "00:30");
    expect(clubDateLabel(justAfterMidnight)).toContain("9 Sept");
    expect(clubHHMM(justAfterMidnight)).toBe("00:30");
  });
});
