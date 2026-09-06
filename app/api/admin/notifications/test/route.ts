import { NextResponse } from "next/server";
import { getStaffUser } from "@/lib/auth/staff";
import { sendStaffBookingAlert } from "@/lib/email/notify-staff";

/**
 * Send one fake booking alert to the list.
 *
 * Setting up an email provider has several places to go wrong — a wrong key, an
 * unverified domain, a from-address the provider refuses — and the only way to
 * find out used to be to make a real booking and hope. This does the same
 * thing the booking route does, through the same function, and reports back
 * exactly what happened.
 *
 * It uses an obviously fake code so nobody at the desk goes looking for it.
 */
export async function POST() {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const result = await sendStaffBookingAlert({
    type: "court",
    resourceName: "Court 1 (test)",
    bookingCode: "TEST0000",
    guestName: "Test alert — no booking was made",
    guestEmail: staff.email ?? "test@example.com",
    guestPhone: null,
    start: new Date(Date.now() + 3_600_000),
    durationMinutes: 60,
    priceCents: 8000,
    bookedBy: "desk",
  });

  return NextResponse.json(result);
}
