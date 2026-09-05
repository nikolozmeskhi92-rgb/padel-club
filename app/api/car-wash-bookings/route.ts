import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolvePrice } from "@/lib/pricing";
import { sendBookingConfirmationEmail } from "@/lib/email/send";
import { enforceRateLimit } from "@/lib/rate-limit";

const CHANGEOVER_MINUTES = 10; // staff turnover between cars — same value the suggestion engine assumes

const CarWashSchema = z.object({
  bayId: z.number().int().min(1).max(4),
  startTime: z.string().datetime(),
  service: z.enum(["quick_wash", "full_detail", "express_rinse"]),
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  guestName: z.string().min(2),
  guestEmail: z.string().email(),
  paymentMethod: z.enum(["tbc", "bog", "paypal", "cash"]),
  linkedCourtBookingId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
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
    userId,
  } = parsed.data;

  const supabase = createServiceRoleClient();
  const start = new Date(startTime);

  const { data: rules } = await supabase
    .from("pricing_rules")
    .select("*")
    .eq("scope", "car_wash");

  const matchedRule = rules ? resolvePrice(rules, "car_wash", start, durationMinutes) : null;
  if (!matchedRule) {
    return NextResponse.json({ error: "NO_PRICING_RULE_MATCHED" }, { status: 400 });
  }

  const { data: booking, error } = await supabase.rpc("create_wash_booking", {
    p_bay_id: bayId,
    p_start: start.toISOString(),
    p_service: service,
    p_duration_minutes: durationMinutes,
    p_buffer_minutes: CHANGEOVER_MINUTES,
    p_user_id: userId ?? null,
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

  if (paymentMethod === "cash") {
    await supabase.rpc("confirm_booking", {
      p_booking_type: "car_wash",
      p_booking_id: booking.id,
      p_payment_method: paymentMethod,
      p_provider_ref: null,
    });
  }

  const { data: policy } = await supabase
    .from("cancellation_policy")
    .select("free_cancellation_hours")
    .eq("id", 1)
    .maybeSingle();

  sendBookingConfirmationEmail({
    type: "car_wash",
    to: guestEmail,
    guestName,
    bookingCode: booking.booking_code,
    resourceName: `Wash Bay ${bayId}`,
    date: start,
    durationMinutes,
    priceCents: matchedRule.price_cents,
    paymentStatus: paymentMethod === "cash" ? "paid" : "unpaid",
    cancelToken: booking.cancel_token,
    freeCancellationHours: policy?.free_cancellation_hours ?? 24,
  }).catch((e) => console.error("Email send failed:", e));

  return NextResponse.json({ booking }, { status: 201 });
}
