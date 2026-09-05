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
};

const BAY_COUNT = 4;
const CHANGEOVER_MINUTES = 10; // staff turnover between cars, baked into every candidate block
const OPEN_HOUR = 7;
const CLOSE_HOUR = 22;
const SEARCH_STEP_MINUTES = 10;
/** How far outside the court window a wash is still allowed to spill and count as "close" rather than a non-match. */
const CLOSE_OVERLAP_TOLERANCE_MINUTES = 20;

function isBayFree(bayId: number, start: Date, end: Date, existing: BayBooking[]): boolean {
  return !existing.some((b) => b.bayId === bayId && start < b.end && end > b.start);
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

function atHour(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
    return { tier: "no_wash_today", best: null, alternatives: [] };
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

  return {
    tier: bestTier,
    best: toSuggestion(best),
    alternatives,
  };
}
