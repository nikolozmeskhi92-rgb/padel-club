import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase, createServiceRoleClient } from "@/lib/supabase/server";
import { resolvePrice } from "@/lib/pricing";
import { sendBookingConfirmationEmail } from "@/lib/email/send";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  clubDayBounds,
  clubDateKey,
  isWithinOpeningHours,
  isWithinBookingHorizon,
  PUBLIC_HORIZON_DAYS,
  STAFF_HORIZON_DAYS,
} from "@/lib/time/club";
import { getStaffUser } from "@/lib/auth/staff";

const BookingSchema = z.object({
  courtId: z.number().int().min(1).max(10),
  startTime: z.string().datetime(), // ISO string, UTC
  durationMinutes: z.union([z.literal(60), z.literal(90)]),
  guestName: z.string().min(2),
  guestEmail: z.string().email(),
  guestPhone: z.string().min(6),
  paymentMethod: z.enum(["tbc", "bog", "paypal", "cash"]),
  equipment: z
    .array(z.object({ equipmentId: z.number(), quantity: z.number().min(1) }))
    .default([]),
});

export async function POST(req: NextRequest) {
  // Creating bookings is the expensive, abusable path: each success writes a
  // 'pending' row that holds a court against everyone else until it expires.
  const limited = await enforceRateLimit(req, "book:court", 10, 600);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = BookingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_INPUT", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    courtId,
    startTime,
    durationMinutes,
    guestName,
    guestEmail,
    guestPhone,
    paymentMethod,
    equipment,
  } = parsed.data;

  // Whose account this booking belongs to comes from the SESSION, never from
  // the request body. The schema used to accept a `userId` and hand it straight
  // to the RPC, so anyone could have filed a booking under someone else's
  // account just by sending their UUID. Nothing was sending it yet, but the
  // hole was open.
  const sessionClient = await createServerSupabase();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  const supabase = createServiceRoleClient();
  const start = new Date(startTime);

  // Guard: no bookings in the past, and the slot must fit inside opening hours.
  if (start.getTime() < Date.now()) {
    return NextResponse.json({ error: "SLOT_IN_PAST" }, { status: 400 });
  }
  // Opening hours are the CLUB's, on the club's clock. This used to compare
  // `start.getUTCHours()` against 8..23, which with the club at UTC+4 rejected
  // every booking from 08:00 to 11:59 club time with OUTSIDE_OPENING_HOURS —
  // a quarter of the trading day — while letting 00:00-02:59 through.
  // It also only checked the START hour, so a 90-minute slot at 22:30 was
  // accepted and ran half an hour past closing.
  if (!isWithinOpeningHours(start, durationMinutes)) {
    return NextResponse.json({ error: "OUTSIDE_OPENING_HOURS" }, { status: 400 });
  }

  // How far ahead this caller may book. The public gets a week; the desk gets a
  // month, because the calls it takes are exactly the ones the public window
  // turns away. Enforced here and not only in the date picker: the picker is a
  // convenience, this is the rule.
  const staff = await getStaffUser();
  const horizonDays = staff ? STAFF_HORIZON_DAYS : PUBLIC_HORIZON_DAYS;
  if (!isWithinBookingHorizon(start, horizonDays)) {
    return NextResponse.json(
      { error: "BEYOND_BOOKING_HORIZON", horizonDays },
      { status: 400 }
    );
  }

  // --- Authoritative server-side price resolution (never trust client-sent prices) ---
  const { data: rules, error: rulesError } = await supabase
    .from("pricing_rules")
    .select("*")
    .eq("scope", "court");

  if (rulesError || !rules) {
    return NextResponse.json({ error: "PRICING_UNAVAILABLE" }, { status: 500 });
  }

  const matchedRule = resolvePrice(rules, "court", start, durationMinutes);
  if (!matchedRule) {
    return NextResponse.json({ error: "NO_PRICING_RULE_MATCHED" }, { status: 400 });
  }

  // --- Equipment line items (server-priced) ---
  let equipmentPayload: { equipment_id: number; quantity: number; price_cents: number }[] = [];
  let equipmentTotal = 0;
  if (equipment.length > 0) {
    const ids = equipment.map((e) => e.equipmentId);
    const { data: items } = await supabase
      .from("equipment_items")
      .select("*")
      .in("id", ids);

    equipmentPayload = equipment.map((e) => {
      const item = items?.find((i) => i.id === e.equipmentId);
      const price = item?.price_cents ?? 0;
      equipmentTotal += price * e.quantity;
      return { equipment_id: e.equipmentId, quantity: e.quantity, price_cents: price };
    });
  }

  const totalCents = matchedRule.price_cents + equipmentTotal;

  // --- Atomic insert via Postgres RPC. The EXCLUDE constraint on court_bookings
  // guarantees no two overlapping bookings can ever be committed, even under
  // simultaneous requests — Postgres itself is the source of truth here, not app logic. ---
  const { data: booking, error } = await supabase.rpc("create_court_booking", {
    p_court_id: courtId,
    p_start: start.toISOString(),
    p_duration_minutes: durationMinutes,
    p_user_id: user?.id ?? null,
    p_guest_name: guestName,
    p_guest_email: guestEmail,
    p_guest_phone: guestPhone,
    p_price_cents: totalCents,
    p_payment_method: paymentMethod,
    p_equipment: equipmentPayload,
  });

  if (error) {
    if (error.code === "23P01" || error.message?.includes("SLOT_TAKEN")) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    console.error("create_court_booking failed:", error);
    return NextResponse.json({ error: "BOOKING_FAILED" }, { status: 500 });
  }

  // Pay-on-site: confirm the booking so the slot is held, but do NOT mark it
  // paid — nothing has been collected yet. `confirm_booking()` sets status and
  // payment_status together and writes a `paid` payments row, which told staff
  // the money was already in and showed the customer "Payment: Paid" on their
  // check-in page before they had paid a lari. Call that RPC from a real
  // payment webhook, or from the admin when cash is taken at the desk.
  await supabase
    .from("court_bookings")
    .update({ status: "confirmed" })
    .eq("id", booking.id);

  // Fire-and-forget confirmation email — booking succeeds even if email fails.
  const { data: policy } = await supabase
    .from("cancellation_policy")
    .select("free_cancellation_hours")
    .eq("id", 1)
    .maybeSingle();

  const emailSent = await sendBookingConfirmationEmail({
    type: "court",
    to: guestEmail,
    guestName,
    bookingCode: booking.booking_code,
    resourceName: `Court ${courtId}`,
    date: start,
    durationMinutes,
    priceCents: totalCents,
    paymentStatus: "unpaid",
    cancelToken: booking.cancel_token,
    freeCancellationHours: policy?.free_cancellation_hours ?? 24,
  }).catch((e) => {
    // The booking is already committed; a failed email must not undo it.
    console.error("Email send failed:", e);
    return false;
  });

  // The UI used to promise "a confirmation was sent to <email>" unconditionally.
  // Without RESEND_API_KEY nothing is sent, so say which actually happened.
  return NextResponse.json(
    { booking, emailSent },
    { status: 201 }
  );
}

export async function GET(req: NextRequest) {
  // Read-only and polled by the grid on every date change, so the ceiling is
  // generous — it exists to stop scraping, not normal browsing.
  const limited = await enforceRateLimit(req, "avail:court", 120, 60);
  if (limited) return limited;

  // Returns booked ranges for a court/day so the client can render the grid.
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date"); // "YYYY-MM-DD"
  if (!date) {
    return NextResponse.json({ error: "DATE_REQUIRED" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  // `date` is a club-local calendar day, so its UTC bounds are not midnight-to-
  // midnight Z. Asking for `${date}T00:00:00Z`..`T23:59:59Z` silently shifted
  // the window by the club's offset and clipped the ends of the day.
  const { start: dayStart, end: dayEnd } = clubDayBounds(date);

  // `slot` is a tstzrange, so it has to be matched with the range OVERLAP
  // operator. Comparing it to a timestamp (`.gte`/`.lt`) made Postgres try to
  // read the timestamp as a range and fail with `malformed range literal`, so
  // this endpoint always returned FETCH_FAILED and /book always fell back to
  // its "couldn't load live availability" panel. Overlap is also the correct
  // question to ask: show bookings that touch this day, not only ones that
  // start inside it.
  const { data, error } = await supabase
    .from("court_bookings")
    .select("id, court_id, slot, status")
    .in("status", ["pending", "confirmed"])
    .overlaps("slot", `[${dayStart.toISOString()},${dayEnd.toISOString()})`);

  if (error) {
    return NextResponse.json({ error: "FETCH_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ bookings: data });
}
