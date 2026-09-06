/**
 * Court + Car Wash cross-sell recommendation engine.
 *
 * The club's real workflow: a customer books a court, drops their car keys
 * at the wash bay, plays their match, and picks the car up clean on the way
 * out. This module answers one question well: "given the court time this
 * person just picked, what's the best wash bay + service to suggest — and
 * is it even possible today?"
 *
 * It never assumes a fit exists. It always classifies what's actually
 * available into one of four honest outcomes so the UI can render the
 * right message instead of pretending everything lines up:
 *
 *   - "perfect_fit"    both resources are free AND the timing works: the
 *                       wash finishes at or before the match ends.
 *   - "close_overlap"  both resources are free, but the wash spills a little
 *                       outside the match window (starts a bit early, or
 *                       isn't ready until a bit after the match ends).
 *   - "court_only"     the court is available but no wash bay can be made
 *                       to fit anywhere near this time — court booking can
 *                       still proceed, wash just isn't offered right now.
 *   - "no_wash_today"  every bay is fully booked for the rest of the day.
 */

import {
  CLOSE_HOUR,
  OPEN_HOUR,
  clubDateKey,
  clubHHMM,
  clubWallTimeToInstant,
} from "@/lib/time/club";

export type WashServiceId = "quick_wash" | "full_detail" | "express_rinse";

export type WashService = {
  id: WashServiceId;
  label: string;
  durationMinutes: number;
  priceCents: number;
};

export type BayBooking = {
  bayId: number;
  start: Date; // inclusive
  end: Date; // exclusive — already includes any changeover buffer
};

export type SuggestionTier =
  | "perfect_fit"
  | "close_overlap"
  | "court_only"
  | "no_wash_today";

export type WashSuggestion = {
  tier: SuggestionTier;
  bayId: number;
  service: WashService;
  start: Date;
  end: Date;
  /** Human-readable explanation shown directly in the UI, e.g. "Ready 10 min before you finish". */
  note: string;
};

export type WashRecommendationResult = {
  tier: SuggestionTier;
  /** The single best suggestion to lead with, if any exists. */
  best: WashSuggestion | null;
  /** Up to 2 further alternatives (different bay/service/time), for a "or try" list. */
  alternatives: WashSuggestion[];
  /**
   * The best available slot for EVERY service the club sells, one each.
   *
   * `best` alone answered "what should we push?", so a customer who wanted a
   * full detail was shown a quick wash and had to leave the booking to find
   * the rest. The club sells three washes; the customer should see three.
   */
  perService: WashSuggestion[];
};

const BAY_COUNT = 4;
const CHANGEOVER_MINUTES = 10; // staff turnover between cars, baked into every candidate block
// Opening hours come from lib/time/club — this file used to declare its own
// 07:00-22:00 pair, which disagreed with the club's real 08:00-23:00 and so
// offered washes an hour before the gates opened and hid the last hour of the day.
const SEARCH_STEP_MINUTES = 10;
/** How far outside the court window a wash is still allowed to spill and count as "close" rather than a non-match. */
const CLOSE_OVERLAP_TOLERANCE_MINUTES = 20;

function isBayFree(bayId: number, start: Date, end: Date, existing: BayBooking[]): boolean {
  return !existing.some((b) => b.bayId === bayId && start < b.end && end > b.start);
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

/**
 * An hour on the CLUB's clock, not the server's. `setHours` here meant the
 * search window followed whatever machine happened to be running the app —
 * correct on a laptop in Tbilisi, an hour or four out on a cloud host.
 *
 * It is built from the club day's own midnight rather than from a "HH:00"
 * string, because the club now closes at 24:00 and "24:00" is not a wall-clock
 * time. Asked for it, the parser did not complain — it quietly returned 00:00
 * of the SAME day, which put closing fourteen hours before opening. The
 * candidate loop then never ran a single iteration and every request came back
 * `no_wash_today`: the car wash had been silently unbookable, on every device,
 * since the day the hours changed from 23:00 to 24:00.
 *
 * Tbilisi has no daylight saving, so adding hours to local midnight is exact.
 * This is the same arithmetic clubDayBounds() already uses for the same reason.
 */
function atHour(date: Date, hour: number): Date {
  const midnight = clubWallTimeToInstant(clubDateKey(date), "00:00");
  return new Date(midnight.getTime() + hour * 60 * 60 * 1000);
}

function fmt(d: Date): string {
  return clubHHMM(d);
}

/**
 * Generates every candidate (bay, service, start-time) combination for the
 * day that is actually free, independent of the court window — this is the
 * full "what's bookable today" set that the classifier below sorts through.
 */
function generateFreeCandidates(
  date: Date,
  services: WashService[],
  existingBayBookings: BayBooking[]
): { bayId: number; service: WashService; start: Date; end: Date }[] {
  const dayStart = atHour(date, OPEN_HOUR);
  const dayEnd = atHour(date, CLOSE_HOUR);
  const out: { bayId: number; service: WashService; start: Date; end: Date }[] = [];

  for (const service of services) {
    const lastPossibleStart = new Date(dayEnd.getTime() - service.durationMinutes * 60_000);
    for (let bayId = 1; bayId <= BAY_COUNT; bayId++) {
      for (
        let start = new Date(dayStart);
        start <= lastPossibleStart;
        start = new Date(start.getTime() + SEARCH_STEP_MINUTES * 60_000)
      ) {
        const end = new Date(start.getTime() + service.durationMinutes * 60_000);
        const reservedEnd = new Date(end.getTime() + CHANGEOVER_MINUTES * 60_000);
        if (isBayFree(bayId, start, reservedEnd, existingBayBookings)) {
          out.push({ bayId, service, start, end });
        }
      }
    }
  }
  return out;
}

/**
 * Main entry point: call this once the customer has picked a court + time.
 * Returns the best wash recommendation (if any) plus a couple of alternatives,
 * already classified and annotated with a plain-English note for the UI.
 */
export function recommendWashForCourtSlot(params: {
  courtStart: Date;
  courtEnd: Date;
  services: WashService[];
  existingBayBookings: BayBooking[]; // all bays, whole day, in the same timezone as courtStart
}): WashRecommendationResult {
  const { courtStart, courtEnd, services, existingBayBookings } = params;

  const freeCandidates = generateFreeCandidates(courtStart, services, existingBayBookings);

  if (freeCandidates.length === 0) {
    return { tier: "no_wash_today", best: null, alternatives: [], perService: [] };
  }

  const scored = freeCandidates.map((c) => {
    const fitsInside = c.start.getTime() >= courtStart.getTime() && c.end.getTime() <= courtEnd.getTime();
    const overlaps = c.start < courtEnd && c.end > courtStart;
    const startsEarlyBy = Math.max(0, minutesBetween(c.start, courtStart)); // wash starts before court starts
    const finishesLateBy = Math.max(0, minutesBetween(courtEnd, c.end)); // wash finishes after court ends

    let tier: SuggestionTier;
    if (fitsInside) {
      tier = "perfect_fit";
    } else if (overlaps && startsEarlyBy <= CLOSE_OVERLAP_TOLERANCE_MINUTES && finishesLateBy <= CLOSE_OVERLAP_TOLERANCE_MINUTES) {
      tier = "close_overlap";
    } else {
      tier = "court_only"; // this particular candidate doesn't work with the match time — not a global verdict yet
    }

    // Idle time = how much of the wash slot sits "wasted" outside the match window.
    // Lower is better — 0 for a candidate that starts exactly at courtStart and
    // finishes exactly at or before courtEnd.
    const idleMinutes = startsEarlyBy + finishesLateBy;

    let note: string;
    if (tier === "perfect_fit") {
      const readyBuffer = minutesBetween(c.end, courtEnd);
      note =
        readyBuffer > 0
          ? `Ready ${Math.round(readyBuffer)} min before you finish playing`
          : "Ready right as you finish playing";
    } else if (tier === "close_overlap") {
      note =
        finishesLateBy > 0
          ? `Ready ${Math.round(finishesLateBy)} min after you finish playing`
          : `Starts ${Math.round(startsEarlyBy)} min before your match`;
    } else {
      note = `${fmt(c.start)}–${fmt(c.end)} — doesn't overlap your match time`;
    }

    return { ...c, tier, idleMinutes, note };
  });

  const rankOf = (t: SuggestionTier) => (t === "perfect_fit" ? 0 : t === "close_overlap" ? 1 : 2);

  scored.sort((a, b) => rankOf(a.tier) - rankOf(b.tier) || a.idleMinutes - b.idleMinutes || +a.start - +b.start);

  const best = scored[0];
  const bestTier: SuggestionTier = best.tier === "court_only" ? "court_only" : best.tier;

  const toSuggestion = (c: (typeof scored)[number]): WashSuggestion => ({
    tier: c.tier,
    bayId: c.bayId,
    service: c.service,
    start: c.start,
    end: c.end,
    note: c.note,
  });

  // Alternatives: different bay or different service than `best`, same or next-best tier, capped at 2.
  const alternatives = scored
    .filter((c) => c !== best && (c.bayId !== best.bayId || c.service.id !== best.service.id))
    .filter((c, i, arr) => arr.findIndex((x) => x.bayId === c.bayId && x.service.id === c.service.id) === i)
    .slice(0, 2)
    .map(toSuggestion);

  // One entry per service, each the best slot that service can actually get.
  // Kept in the club's own service order (as priced) rather than ranked, so the
  // menu doesn't reshuffle itself every time a bay frees up.
  const perService = services
    .map((svc) => scored.find((c) => c.service.id === svc.id))
    .filter((c): c is (typeof scored)[number] => Boolean(c))
    .map(toSuggestion);

  return {
    tier: bestTier,
    best: toSuggestion(best),
    alternatives,
    perService,
  };
}
