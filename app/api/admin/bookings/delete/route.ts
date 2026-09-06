import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getStaffUser } from "@/lib/auth/staff";

const Schema = z.object({
  bookingType: z.enum(["court", "car_wash"]),
  bookingId: z.string().uuid(),
});

/**
 * Erase a booking outright.
 *
 * This is a different act from cancelling, and the difference matters:
 *
 *   cancel — the booking happened and the customer called it off. The row stays
 *            with status 'cancelled' and whatever refund or credit it earned;
 *            the club's history still shows it.
 *   delete — the booking should never have existed: a test row, a duplicate, a
 *            wrong-number mis-key. The row goes and takes its traces with it.
 *
 * Because it is unrecoverable it is staff-only, one row at a time, and there is
 * deliberately no bulk endpoint.
 *
 * The one thing it will not do is destroy money. A booking that issued a credit
 * note is refused: that note is an amount the club owes a named customer, and
 * it outlives the booking that created it. Cancel such a booking instead.
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

  const { bookingType, bookingId } = parsed.data;
  const isCourt = bookingType === "court";
  const table = isCourt ? "court_bookings" : "wash_bookings";
  const fk = isCourt ? "court_booking_id" : "wash_booking_id";
  const paymentFk = isCourt ? "court_booking_id" : "car_wash_booking_id";
  const creditFk = isCourt ? "source_court_booking_id" : "source_wash_booking_id";

  const supabase = createServiceRoleClient();

  // Money first: if this booking issued a credit note, it is not ours to erase.
  const { data: credits } = await supabase
    .from("credit_notes")
    .select("code")
    .eq(creditFk, bookingId)
    .limit(1);

  if (credits && credits.length > 0) {
    return NextResponse.json(
      { error: "HAS_CREDIT_NOTE", creditCode: credits[0].code },
      { status: 409 }
    );
  }

  // Rows that point at this booking and would otherwise block the delete.
  // booking_equipment already cascades; the rest do not.
  await supabase.from("booking_cancellations").delete().eq(fk, bookingId);
  await supabase.from("payments").delete().eq(paymentFk, bookingId);
  if (isCourt) {
    // A wash booked as a cross-sell belongs to the match it was attached to.
    await supabase.from("wash_bookings").delete().eq("linked_court_booking_id", bookingId);
  }

  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq("id", bookingId)
    .select("id, booking_code")
    .maybeSingle();

  if (error) {
    console.error("staff delete booking failed:", error);
    return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ deleted: data });
}
