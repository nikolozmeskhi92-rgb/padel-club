import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolvePrice } from "@/lib/pricing";
import { sendBookingConfirmationEmail } from "@/lib/email/send";
import { enforceRateLimit } from "@/lib/rate-limit";

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
  userId: z.string().uuid().nullable().optional(),
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
    userId,
  } = parsed.data;

  const supabase = createServiceRoleClient();
  const start = new Date(startTime);

  // Guard: no bookings in the past, and courts only open 08:00-23:00.
  if (start.getTime() < Date.now()) {
    return NextResponse.json({ error: "SLOT_IN_PAST" }, { status: 400 });
  }
  const hour = start.getUTCHours();
  if (hour < 8 || hour >= 23) {
    return NextResponse.json({ error: "OUTSIDE_OPENING_HOURS" }, { status: 400 });
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
    p_user_id: userId ?? null,
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

  // Booking created as 'pending'. In production this confirms after the payment
  // provider webhook fires; cash/on-site payment methods can confirm immediately.
  if (paymentMethod === "cash") {
    await supabase.rpc("confirm_booking", {
      p_booking_type: "court",
      p_booking_id: booking.id,
      p_payment_method: paymentMethod,
      p_provider_ref: null,
    });
  }

  // Fire-and-forget confirmation email — booking succeeds even if email fails.
  sendBookingConfirmationEmail({
    type: "court",
    to: guestEmail,
    guestName,
    bookingCode: booking.booking_code,
    resourceName: `Court ${courtId}`,
    date: start,
    durationMinutes,
    priceCents: totalCents,
    paymentStatus: paymentMethod === "cash" ? "paid" : "unpaid",
  }).catch((e) => console.error("Email send failed:", e));

  return NextResponse.json({ booking }, { status: 201 });
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
  const dayStart = new Date(`${date}T00:00:00Z`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59Z`).toISOString();

  const { data, error } = await supabase
    .from("court_bookings")
    .select("id, court_id, slot, status")
    .in("status", ["pending", "confirmed"])
    .gte("slot", dayStart)
    .lte("slot", dayEnd);

  if (error) {
    return NextResponse.json({ error: "FETCH_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ bookings: data });
}
