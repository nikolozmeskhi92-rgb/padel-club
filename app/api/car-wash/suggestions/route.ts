import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { recommendWashForCourtSlot, type WashService, type BayBooking } from "@/lib/carwash/suggest";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clubDateKey, clubDayBounds } from "@/lib/time/club";

const QuerySchema = z.object({
  courtStart: z.string().datetime(),
  durationMinutes: z.union([z.literal(60), z.literal(90)]),
});

/**
 * GET /api/car-wash/suggestions?courtStart=...&durationMinutes=60
 *
 * Given the court slot the customer just picked, returns the best car-wash
 * recommendation for that exact window (see lib/carwash/suggest.ts for the
 * classification logic), plus up to 2 alternatives.
 */
export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "suggest:wash", 60, 60);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    courtStart: searchParams.get("courtStart"),
    durationMinutes: Number(searchParams.get("durationMinutes")),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const courtStart = new Date(parsed.data.courtStart);
  const courtEnd = new Date(courtStart.getTime() + parsed.data.durationMinutes * 60_000);
  // The club's day, not UTC's — at UTC+4 a naive date slice loses the first
  // four hours of bookings and picks up four from the day before.
  const { start: dayStart, end: dayEnd } = clubDayBounds(clubDateKey(courtStart));

  const supabase = createServiceRoleClient();

  const [{ data: pricingRules }, { data: bookingsToday }] = await Promise.all([
    supabase.from("pricing_rules").select("*").eq("scope", "car_wash"),
    // `slot` is a tstzrange. Comparing it to a timestamp string makes Postgres
    // fail with `malformed range literal`, which PostgREST returns as an error
    // and this code silently read as "no bookings" — so every bay looked free
    // and the wash was offered on top of cars already booked in. The range
    // operator is the only correct comparison here.
    supabase
      .from("wash_bookings")
      .select("bay_id, slot, status")
      .in("status", ["pending", "confirmed"])
      .overlaps("slot", `[${dayStart.toISOString()},${dayEnd.toISOString()})`),
  ]);

  const services: WashService[] = (pricingRules ?? []).map((r) => ({
    id: r.label.toLowerCase().includes("quick")
      ? "quick_wash"
      : r.label.toLowerCase().includes("full")
      ? "full_detail"
      : "express_rinse",
    label: r.label,
    durationMinutes: r.duration_minutes,
    priceCents: r.price_cents,
  }));

  const existingBayBookings: BayBooking[] = (bookingsToday ?? []).map((b) => {
    const [start, end] = parsePgRange(b.slot);
    return { bayId: b.bay_id, start, end };
  });

  const result = recommendWashForCourtSlot({
    courtStart,
    courtEnd,
    services,
    existingBayBookings,
  });

  return NextResponse.json({ result });
}

function parsePgRange(pgRange: string): [Date, Date] {
  const match = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
  if (!match) return [new Date(0), new Date(0)];
  return [new Date(match[1]), new Date(match[2])];
}
