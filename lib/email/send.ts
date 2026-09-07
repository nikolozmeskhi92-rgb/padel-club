import { Resend } from "resend";
import BookingConfirmation from "@/emails/BookingConfirmation";
import { formatMoney } from "@/lib/currency";
import { clubDateLabel, clubTimeRange } from "@/lib/time/club";

// Constructed lazily, not at module scope: `new Resend(undefined)` throws, and a
// module-scope throw takes down the whole route at import time — which broke
// `next build` (page-data collection) on any machine without the key set.
let resendClient: Resend | null = null;

/**
 * Whether a *usable* key is set.
 *
 * "Is it set?" is not the question: .env.local ships with the placeholder
 * `re_xxxxxxxxxxxx`, which is a perfectly non-empty string. Treating that as
 * configured made every failure look like the provider rejecting us, when the
 * truth was that nobody had signed up yet — and it is the same trap that once
 * had this site telling customers a confirmation had been sent.
 */
export function isEmailConfigured(): boolean {
  const key = process.env.RESEND_API_KEY ?? "";
  return key.startsWith("re_") && key.length > 20 && !/^re_x+$/i.test(key);
}

export function getResend(): Resend | null {
  if (!isEmailConfigured()) return null;
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY!);
  return resendClient;
}

type SendConfirmationArgs = {
  type: "court" | "car_wash";
  to: string;
  guestName: string;
  bookingCode: string;
  resourceName: string;
  date: Date;
  durationMinutes: number;
  priceCents: number;
  paymentStatus: "paid" | "unpaid";
  cancelToken: string;                    // from the booking row; drives the cancel link
  freeCancellationHours?: number;         // from cancellation_policy
};

/**
 * Returns true only when Resend accepted the message. The caller uses this to
 * decide what to tell the customer — the success screen used to promise an
 * email unconditionally, which was a lie on any deployment without a working
 * key, and the booking code on that screen is their only copy.
 */
export async function sendBookingConfirmationEmail(
  args: SendConfirmationArgs
): Promise<boolean> {
  const {
    to,
    guestName,
    bookingCode,
    resourceName,
    date,
    durationMinutes,
    priceCents,
    paymentStatus,
    cancelToken,
    freeCancellationHours = 24,
  } = args;

  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping confirmation for booking ${bookingCode}`
    );
    return false;
  }

  const endTime = new Date(date.getTime() + durationMinutes * 60_000);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const clubName = process.env.NEXT_PUBLIC_CLUB_NAME || "Padel Club";
  const clubAddress = process.env.NEXT_PUBLIC_CLUB_ADDRESS || "";

  // No QR: reception looks a booking up by name, phone or code, and an image
  // in an email is the part most likely to be blocked, stripped, or simply not
  // loaded on the phone the customer is holding at the desk.

  const priceLabel = formatMoney(priceCents);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "Padel Club <bookings@example.com>",
    to,
    subject: `Booking confirmed — ${resourceName}, ${clubDateLabel(date)}`,
    react: BookingConfirmation({
      guestName,
      bookingCode,
      resourceName,
      // On the club's clock, not the server's. date-fns formats in the
      // timezone of the machine running it, and on Vercel that is UTC: a court
      // booked for 10:00 was confirmed to the customer as 06:00, and a booking
      // after 20:00 was confirmed with the wrong date as well.
      dateLabel: clubDateLabel(date),
      timeLabel: clubTimeRange(date, durationMinutes),
      priceLabel,
      paymentStatus,
      clubName,
      clubAddress,
      siteUrl,
      cancelUrl: `${siteUrl}/cancel/${cancelToken}`,
      freeCancellationHours,
    }),
  });

  if (error) {
    console.error(`[email] Resend refused booking ${bookingCode}: ${error.message}`);
    return false;
  }
  return true;
}
