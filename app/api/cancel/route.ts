import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";

const TokenSchema = z.object({ token: z.string().uuid() });

type Kind = "court" | "car_wash";

/**
 * Resolve a cancel token to the booking it belongs to. Tokens are unique across
 * both tables (separate uuid columns, so a collision is not a practical
 * concern), and the token is the only thing the customer needs — no login.
 */
async function findByToken(token: string) {
  const supabase = createServiceRoleClient();

  const { data: court } = await supabase
    .from("court_bookings")
    .select("id, court_id, slot, duration_minutes, status, price_cents, payment_status, guest_name, guest_email, booking_code")
    .eq("cancel_token", token)
    .maybeSingle();

  if (court) {
    return {
      kind: "court" as Kind,
      booking: court,
      resourceName: `Court ${court.court_id}`,
    };
  }

  const { data: wash } = await supabase
    .from("wash_bookings")
    .select("id, bay_id, slot, service, status, price_cents, payment_status, guest_name, guest_email, booking_code")
    .eq("cancel_token", token)
    .maybeSingle();

  if (wash) {
    return {
      kind: "car_wash" as Kind,
      booking: wash,
      resourceName: `Wash Bay ${wash.bay_id}`,
    };
  }

  return null;
}

/** What the customer would get back if they cancelled right now. */
async function previewOutcome(slotStart: string, paymentStatus: string) {
  const supabase = createServiceRoleClient();
  const { data: policy } = await supabase
    .from("cancellation_policy")
    .select("free_cancellation_hours, late_credit_pct, credit_valid_days")
    .eq("id", 1)
    .single();

  const freeHours = policy?.free_cancellation_hours ?? 24;
  const creditPct = policy?.late_credit_pct ?? 100;
  const hoursUntil = (new Date(slotStart).getTime() - Date.now()) / 3_600_000;

  if (paymentStatus !== "paid") {
    return { outcome: "released" as const, hoursUntil, freeHours, creditPct };
  }
  return {
    outcome: hoursUntil >= freeHours ? ("refunded" as const) : ("credited" as const),
    hoursUntil,
    freeHours,
    creditPct,
  };
}

/** GET /api/cancel?token=... — show the customer what will happen, before they commit. */
export async function GET(req: NextRequest) {
  const limited = await enforceRateLimit(req, "cancel:read", 30, 60);
  if (limited) return limited;

  const parsed = TokenSchema.safeParse({ token: req.nextUrl.searchParams.get("token") });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }

  const found = await findByToken(parsed.data.token);
  if (!found) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const { kind, booking, resourceName } = found;
  const slotStart = booking.slot.replace(/^[\[(]"?/, "").split(",")[0].replace(/"$/, "");
  const preview = await previewOutcome(slotStart, booking.payment_status);

  return NextResponse.json({
    kind,
    resourceName,
    bookingCode: booking.booking_code,
    guestName: booking.guest_name,
    startTime: slotStart,
    status: booking.status,
    priceCents: booking.price_cents,
    paymentStatus: booking.payment_status,
    ...preview,
  });
}

/** POST /api/cancel — actually cancel. The database decides refund vs credit. */
export async function POST(req: NextRequest) {
  const limited = await enforceRateLimit(req, "cancel:write", 10, 600);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = TokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }

  const found = await findByToken(parsed.data.token);
  if (!found) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .rpc("cancel_booking", {
      p_booking_type: found.kind,
      p_booking_id: found.booking.id,
      p_actor: "customer",
      p_actor_user_id: null,
      p_reason: "Cancelled by customer via emailed link",
    })
    .single<{
      outcome: string;
      refund_cents: number;
      credit_cents: number;
      credit_code: string | null;
      credit_expires_at: string | null;
      hours_before_start: number;
    }>();

  if (error) {
    // The RPC raises named exceptions for the states worth telling the
    // customer about; anything else is ours, not theirs.
    const known = ["ALREADY_CANCELLED", "ALREADY_STARTED", "NOT_CANCELLABLE", "BOOKING_NOT_FOUND"];
    const match = known.find((k) => error.message?.includes(k));
    if (match) {
      return NextResponse.json({ error: match }, { status: 409 });
    }
    console.error("cancel_booking failed:", error);
    return NextResponse.json({ error: "CANCEL_FAILED" }, { status: 500 });
  }

  return NextResponse.json({
    outcome: data.outcome,
    refundCents: data.refund_cents,
    creditCents: data.credit_cents,
    creditCode: data.credit_code,
    creditExpiresAt: data.credit_expires_at,
    resourceName: found.resourceName,
  });
}
