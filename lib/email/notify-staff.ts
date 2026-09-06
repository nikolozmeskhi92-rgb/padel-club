import { format } from "date-fns";
import { getResend } from "@/lib/email/send";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/currency";
import { CLUB_NAME } from "@/lib/club";
import { CLUB_TIMEZONE } from "@/lib/time/club";

export type StaffAlert = {
  type: "court" | "car_wash";
  resourceName: string;
  bookingCode: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string | null;
  start: Date;
  durationMinutes: number;
  priceCents: number;
  /** Whether this came in through the website or was typed at the desk. */
  bookedBy: "customer" | "desk";
};

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tell the club a booking came in.
 *
 * Nothing did this before: the customer got an email and the club found out by
 * looking at the dashboard, which works only while somebody is watching it.
 *
 * Three rules this follows, all learned the hard way elsewhere in this codebase:
 *
 *   - It never throws. A booking that succeeded must not be reported as failed
 *     because an inbox was unreachable; the slot is taken either way.
 *   - It returns what actually happened rather than assuming. `sent: 0` with a
 *     reason is the honest answer when there is no API key or no recipients,
 *     and the caller can say so instead of claiming an email went out.
 *   - Recipients come from the database, not the environment, so the club can
 *     add and remove addresses without a redeploy.
 */
export async function sendStaffBookingAlert(
  alert: StaffAlert
): Promise<{ sent: number; skipped: string | null }> {
  try {
    const supabase = createServiceRoleClient();
    const { data: recipients, error } = await supabase
      .from("notification_recipients")
      .select("email")
      .eq("active", true);

    if (error) {
      console.error("[email] couldn't read notification recipients:", error.message);
      return { sent: 0, skipped: "RECIPIENTS_UNREADABLE" };
    }
    const to = (recipients ?? []).map((r) => r.email).filter(Boolean);
    if (to.length === 0) return { sent: 0, skipped: "NO_RECIPIENTS" };

    const resend = getResend();
    if (!resend) {
      console.warn(
        `[email] RESEND_API_KEY not set — no staff alert for booking ${alert.bookingCode}`
      );
      return { sent: 0, skipped: "NO_API_KEY" };
    }

    const end = new Date(alert.start.getTime() + alert.durationMinutes * 60_000);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const kind = alert.type === "court" ? "Court booking" : "Car wash";
    const source = alert.bookedBy === "desk" ? "Taken at the desk" : "Booked online";

    const rows: [string, string][] = [
      ["When", `${when.format(alert.start)} – ${format(end, "HH:mm")} (club time)`],
      ["What", alert.resourceName],
      ["Guest", alert.guestName],
      ["Email", alert.guestEmail],
      ...(alert.guestPhone ? ([["Phone", alert.guestPhone]] as [string, string][]) : []),
      ["Price", formatMoney(alert.priceCents)],
      ["Code", alert.bookingCode],
      ["Source", source],
    ];

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0b1b2b;max-width:520px">
        <h2 style="margin:0 0 4px;font-size:18px">${kind} — ${escapeHtml(alert.resourceName)}</h2>
        <p style="margin:0 0 16px;color:#5b6b7b;font-size:13px">${escapeHtml(CLUB_NAME)}</p>
        <table style="border-collapse:collapse;font-size:14px;width:100%">
          ${rows
            .map(
              ([k, v]) =>
                `<tr><td style="padding:6px 12px 6px 0;color:#5b6b7b;white-space:nowrap">${k}</td>` +
                `<td style="padding:6px 0;font-weight:600">${escapeHtml(String(v))}</td></tr>`
            )
            .join("")}
        </table>
        <p style="margin:20px 0 0">
          <a href="${siteUrl}/admin/bookings"
             style="background:#0066CC;color:#fff;padding:10px 18px;border-radius:8px;
                    text-decoration:none;font-size:14px;font-weight:600">Open the bookings desk</a>
        </p>
      </div>`;

    const { error: sendError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "Padel Club <bookings@example.com>",
      to,
      subject: `${kind}: ${alert.resourceName}, ${when.format(alert.start)} — ${alert.guestName}`,
      html,
    });

    if (sendError) {
      console.error(`[email] staff alert refused for ${alert.bookingCode}: ${sendError.message}`);
      return { sent: 0, skipped: "SEND_FAILED" };
    }
    return { sent: to.length, skipped: null };
  } catch (err) {
    // A booking that succeeded must never be reported as failed because an
    // inbox was unreachable.
    console.error("[email] staff alert threw:", err);
    return { sent: 0, skipped: "UNEXPECTED_ERROR" };
  }
}
