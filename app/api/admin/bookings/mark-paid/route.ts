import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getStaffUser } from "@/lib/auth/staff";

const Schema = z.object({
  bookingType: z.enum(["court", "car_wash"]),
  bookingId: z.string().uuid(),
  // What the club actually took. Recording a card payment as cash would
  // quietly corrupt the takings breakdown the nightly report is built on.
  method: z.enum(["cash", "card", "comp"]),
});

/**
 * Settle a booking at the desk.
 *
 * Pay-on-site means every booking is written `unpaid` and had no way to become
 * anything else: the paid/unpaid colouring on the court map carried no
 * information, and the revenue figure counted money nobody had handed over.
 *
 * The write lives in `settle_booking()` so the guards hold whoever calls it —
 * already paid, cancelled, missing — and so the status change and the payments
 * row are one atomic step rather than two writes that can half-fail.
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

  const { bookingType, bookingId, method } = parsed.data;
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .rpc("settle_booking", {
      p_booking_type: bookingType,
      p_booking_id: bookingId,
      p_method: method,
      p_actor_user_id: staff.id,
    })
    .single();

  if (error) {
    const known = [
      "ALREADY_PAID",
      "BOOKING_NOT_FOUND",
      "NOT_SETTLEABLE",
      "UNKNOWN_BOOKING_TYPE",
    ].find((code) => error.message?.includes(code));
    if (known) return NextResponse.json({ error: known }, { status: 409 });

    console.error("settle_booking failed:", error);
    return NextResponse.json({ error: "SETTLE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ settled: data });
}
