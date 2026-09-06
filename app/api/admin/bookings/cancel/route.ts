import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getStaffUser } from "@/lib/auth/staff";

const Schema = z.object({
  bookingType: z.enum(["court", "car_wash"]),
  bookingId: z.string().uuid(),
  reason: z.string().max(280).optional(),
});

/**
 * Cancel a booking as staff.
 *
 * `cancel_booking()` has accepted `p_actor = 'staff'` since migration 0004 —
 * nothing ever called it that way, so the desk had no way to cancel anything
 * and had to ask the customer to find their own email link. The refund /
 * credit decision stays entirely in the database function; this route only
 * says who is asking.
 *
 * Staff cancelling is deliberately allowed after the slot has started, which
 * `cancel_booking` refuses for `p_actor = 'customer'` — a no-show still has to
 * be closed off by someone.
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

  const { bookingType, bookingId, reason } = parsed.data;
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .rpc("cancel_booking", {
      p_booking_type: bookingType,
      p_booking_id: bookingId,
      p_actor: "staff",
      p_actor_user_id: staff.id,
      p_reason: reason ?? null,
    })
    .single();

  if (error) {
    // These come back as raised exceptions with a readable message; pass the
    // known ones through so the desk sees "already cancelled" rather than
    // "something went wrong".
    const known = [
      "ALREADY_CANCELLED",
      "BOOKING_NOT_FOUND",
      "NOT_CANCELLABLE",
      "UNKNOWN_BOOKING_TYPE",
    ].find((code) => error.message?.includes(code));
    if (known) return NextResponse.json({ error: known }, { status: 409 });

    console.error("staff cancel_booking failed:", error);
    return NextResponse.json({ error: "CANCEL_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ result: data });
}
