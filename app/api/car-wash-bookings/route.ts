import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase, createServiceRoleClient } from "@/lib/supabase/server";
import { resolvePrice } from "@/lib/pricing";
import { sendBookingConfirmationEmail } from "@/lib/email/send";
import { sendStaffBookingAlert } from "@/lib/email/notify-staff";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  CHANGEOVER_MINUTES,
  clubDayBounds,
  isWithinOpeningHours,
} from "@/lib/time/club";

const CarWashSchema = z.object({
  bayId: z.number().int().min(1).max(4),
  startTime: z.string().datetime(),
  service: z.enum(["quick_wash", "full_detail", "express_rinse"]),
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  guestName: z.string().min(2),
  guestEmail: z.string().email(),
  paymentMethod: z.enum(["tbc", "bog", "paypal", "cash"]),
  linkedCourtBookingId: z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "book:wash", 10, 600);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = CarWashSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_INPUT", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const {
    bayId,
    startTime,
    service,
    durationMinutes,
    guestName,
    guestEmail,
    paymentMethod,
    linkedCourtBookingId,
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

  // The court route guarded both of these and this one guarded neither, so a
  // wash could be booked into the past or at 03:00. The bay is reserved for
  // duration + changeover, so that whole span has to fit inside opening hours.
  if (start.getTime() < Date.now()) {
    return NextResponse.json({ error: "SLOT_IN_PAST" }, { status: 400 });
  }
  if (!isWithinOpeningHours(start, durationMinutes + CHANGEOVER_MINUTES)) {
    return NextResponse.json({ error: "OUTSIDE_OPENING_HOURS" }, { status: 400 });
  }

  const { data: rules } = await supabase
    .from("pricing_rules")
    .select("*")
    .eq("scope", "car_wash");

  // Priced by service, not just duration: Quick Wash and Express Rinse are both
  // 30 minutes, and matching on duration alone charged the cheaper of the two.
  const matchedRule = rules
    ? resolvePrice(rules, "car_wash", start, durationMinutes, service)
    : null;
  if (!matchedRule) {
    return NextResponse.json({ error: "NO_PRICING_RULE_MATCHED" }, { status: 400 });
  }

  const { data: booking, error } = await supabase.rpc("create_wash_booking", {
    p_bay_id: bayId,
    p_start: start.toISOString(),
    p_service: service,
    p_duration_minutes: durationMinutes,
    p_buffer_minutes: CHANGEOVER_MINUTES,
    p_user_id: user?.id ?? null,
    p_guest_name: guestName,
    p_guest_email: guestEmail,
    p_price_cents: matchedRule.price_cents,
    p_payment_method: paymentMethod,
    p_linked_court_booking_id: linkedCourtBookingId ?? null,
  });

  if (error) {
    if (error.code === "23P01" || error.message?.includes("SLOT_TAKEN")) {
      return NextResponse.json({ error: "SLOT_TAKEN" }, { status: 409 });
    }
    console.error("create_wash_booking failed:", error);
    return NextResponse.json({ error: "BOOKING_FAILED" }, { status: 500 });
  }

  // Same as the court route: hold the bay, but don't claim the money is in.
  await supabase
    .from("wash_bookings")
    .update({ status: "confirmed" })
    .eq("id", booking.id);

  const { data: policy } = await supabase
    .from("cancellation_policy")
    .select("free_cancellation_hours")
    .eq("id", 1)
    .maybeSingle();

  const emailSent = await sendBookingConfirmationEmail({
    type: "car_wash",
    to: guestEmail,
    guestName,
    bookingCode: booking.booking_code,
    resourceName: `Wash Bay ${bayId}`,
    date: start,
    durationMinutes,
    priceCents: matchedRule.price_cents,
    paymentStatus: "unpaid",
    cancelToken: booking.cancel_token,
    freeCancellationHours: policy?.free_cancellation_hours ?? 24,
  }).catch((e) => {
    // The booking is already committed; a failed email must not undo it.
    console.error("Email send failed:", e);
    return false;
  });

  const staffAlert = await sendStaffBookingAlert({
    type: "car_wash",
    resourceName: `Wash Bay ${bayId} · ${String(service).replace(/_/g, " ")}`,
    bookingCode: booking.booking_code,
    guestName,
    guestEmail,
    start,
    durationMinutes,
    priceCents: matchedRule.price_cents,
    bookedBy: "customer",
  });

  return NextResponse.json(
    { booking, emailSent, staffAlerted: staffAlert.sent },
    { status: 201 }
  );
}

/**
 * GET /api/car-wash-bookings?date=YYYY-MM-DD — the booked ranges for a club-local
 * day, so the page can grey out taken slots.
 *
 * The wash page used to have no availability call at all: it drew every slot as
 * free and only discovered a clash when the customer submitted and the database
 * rejected it with SLOT_TAKEN. The court grid was fixed for exactly this in
 * f4e5c26; this is the same fix for the wash bays.
 */
export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "avail:wash", 120, 60);
  if (limited) return limited;

  const date = req.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ error: "DATE_REQUIRED" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { start: dayStart, end: dayEnd } = clubDayBounds(date);

  // Same range-overlap rule as the court endpoint — `slot` is a tstzrange.
  const { data, error } = await supabase
    .from("wash_bookings")
    .select("id, bay_id, slot, status")
    .in("status", ["pending", "confirmed"])
    .overlaps("slot", `[${dayStart.toISOString()},${dayEnd.toISOString()})`);

  if (error) {
    return NextResponse.json({ error: "FETCH_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ bookings: data });
}
