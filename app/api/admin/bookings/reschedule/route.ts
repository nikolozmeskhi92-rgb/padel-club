import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getStaffUser } from "@/lib/auth/staff";
import { resolvePrice } from "@/lib/pricing";
import {
  isWithinOpeningHours,
  isWithinBookingHorizon,
  STAFF_HORIZON_DAYS,
} from "@/lib/time/club";

const Schema = z.object({
  bookingId: z.string().uuid(),
  courtId: z.number().int().min(1).max(10),
  startTime: z.string().datetime(),
  durationMinutes: z.union([z.literal(60), z.literal(90)]),
  /** Omit to get a quote back; send true to actually move it. */
  confirm: z.boolean().optional(),
});

/**
 * Move a court booking, and re-price it.
 *
 * The pricing decision the club made: the new slot's price applies. A ₾25
 * off-peak morning moved to a ₾80 peak evening costs ₾80, and the reverse
 * refunds the difference. Keeping the original price would have made "book the
 * cheapest slot, then move it" a working discount.
 *
 * Because that means money changes, the endpoint has two phases. Without
 * `confirm` it returns a quote — old price, new price, difference — and writes
 * nothing, so the desk can read both numbers to the customer before agreeing.
 * With `confirm: true` it performs the move.
 *
 * Extras stay with the booking: the equipment lines are re-added to the new
 * base price rather than silently dropped along with the racket the customer
 * still expects to be waiting for them.
 */
export async function POST(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const { bookingId, courtId, startTime, durationMinutes, confirm } = parsed.data;
  const start = new Date(startTime);
  const supabase = createServiceRoleClient();

  if (start.getTime() < Date.now()) {
    return NextResponse.json({ error: "SLOT_IN_PAST" }, { status: 400 });
  }
  if (!isWithinOpeningHours(start, durationMinutes)) {
    return NextResponse.json({ error: "OUTSIDE_OPENING_HOURS" }, { status: 400 });
  }
  if (!isWithinBookingHorizon(start, STAFF_HORIZON_DAYS)) {
    return NextResponse.json(
      { error: "BEYOND_BOOKING_HORIZON", horizonDays: STAFF_HORIZON_DAYS },
      { status: 400 }
    );
  }

  const { data: booking } = await supabase
    .from("court_bookings")
    .select("id, price_cents, status, booking_code, guest_name, court_id, slot, duration_minutes")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) {
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  }
  if (["cancelled", "completed", "no_show"].includes(booking.status)) {
    return NextResponse.json({ error: "NOT_RESCHEDULABLE" }, { status: 409 });
  }

  // --- Re-price against the same rules the booking page uses. ---
  const { data: rules } = await supabase.from("pricing_rules").select("*").eq("scope", "court");
  if (!rules) {
    return NextResponse.json({ error: "PRICING_UNAVAILABLE" }, { status: 500 });
  }
  const matchedRule = resolvePrice(rules, "court", start, durationMinutes);
  if (!matchedRule) {
    return NextResponse.json({ error: "NO_PRICING_RULE_MATCHED" }, { status: 400 });
  }

  // Extras were paid for and are still expected; they ride along.
  const { data: extras } = await supabase
    .from("booking_equipment")
    .select("quantity, price_cents")
    .eq("court_booking_id", bookingId);

  const equipmentTotal = (extras ?? []).reduce(
    (sum, e: any) => sum + e.price_cents * e.quantity,
    0
  );
  const newPriceCents = matchedRule.price_cents + equipmentTotal;

  const quote = {
    bookingCode: booking.booking_code,
    guest: booking.guest_name,
    oldPriceCents: booking.price_cents,
    newPriceCents,
    differenceCents: newPriceCents - booking.price_cents,
    equipmentCents: equipmentTotal,
  };

  if (!confirm) {
    return NextResponse.json({ quote });
  }

  const { data, error } = await supabase
    .rpc("reschedule_court_booking", {
      p_booking_id: bookingId,
      p_court_id: courtId,
      p_start: start.toISOString(),
      p_duration_minutes: durationMinutes,
      p_price_cents: newPriceCents,
    })
    .single();

  if (error) {
    // The EXCLUDE constraint is what makes this safe: if someone took the
    // destination in the seconds since the quote, the UPDATE is refused and the
    // booking stays exactly where it was.
    if (error.code === "23P01" || error.message?.includes("SLOT_TAKEN")) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    const known = ["BOOKING_NOT_FOUND", "NOT_RESCHEDULABLE"].find((c) =>
      error.message?.includes(c)
    );
    if (known) return NextResponse.json({ error: known }, { status: 409 });

    console.error("reschedule_court_booking failed:", error);
    return NextResponse.json({ error: "RESCHEDULE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ moved: data, quote });
}
