import { Resend } from "resend";
import QRCode from "qrcode";
import { format } from "date-fns";
import BookingConfirmation from "@/emails/BookingConfirmation";

// Constructed lazily, not at module scope: `new Resend(undefined)` throws, and a
// module-scope throw takes down the whole route at import time — which broke
// `next build` (page-data collection) on any machine without the key set.
let resendClient: Resend | null = null;

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
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
};

export async function sendBookingConfirmationEmail(args: SendConfirmationArgs) {
  const {
    to,
    guestName,
    bookingCode,
    resourceName,
    date,
    durationMinutes,
    priceCents,
    paymentStatus,
  } = args;

  const resend = getResend();
  if (!resend) {
    console.warn(
      `[email] RESEND_API_KEY not set — skipping confirmation for booking ${bookingCode}`
    );
    return;
  }

  const endTime = new Date(date.getTime() + durationMinutes * 60_000);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const clubName = process.env.NEXT_PUBLIC_CLUB_NAME || "Padel Club";
  const clubAddress = process.env.NEXT_PUBLIC_CLUB_ADDRESS || "";

  // QR encodes a check-in URL staff can scan at reception
  const qrDataUrl = await QRCode.toDataURL(`${siteUrl}/checkin/${bookingCode}`, {
    margin: 1,
    color: { dark: "#001A33", light: "#FFFFFF" },
  });

  const priceLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(priceCents / 100);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "Padel Club <bookings@example.com>",
    to,
    subject: `Booking confirmed — ${resourceName}, ${format(date, "EEE MMM d")}`,
    react: BookingConfirmation({
      guestName,
      bookingCode,
      resourceName,
      dateLabel: format(date, "EEE, MMM d"),
      timeLabel: `${format(date, "HH:mm")} – ${format(endTime, "HH:mm")}`,
      priceLabel,
      paymentStatus,
      qrDataUrl,
      clubName,
      clubAddress,
      siteUrl,
    }),
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
