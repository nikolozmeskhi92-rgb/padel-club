import Link from "next/link";
import { pageTitle } from "@/lib/club";
import { requireStaff } from "@/lib/auth/staff";
import { CourtBookingFlow } from "@/components/booking/CourtBookingFlow";
import { STAFF_HORIZON_DAYS } from "@/lib/time/club";

export const metadata = { title: pageTitle("New Booking") };
export const dynamic = "force-dynamic";

/**
 * Booking on a caller's behalf.
 *
 * The desk takes the calls the public window turns away — "can I have a court
 * on the 24th?" — so it books from a calendar a month deep rather than a strip
 * of seven day chips. It is the same flow the customer uses, on purpose: one
 * set of availability rules, one set of prices, one place where a double
 * booking could hide. Only the horizon and the date picker differ.
 */
export default async function AdminNewBookingPage() {
  await requireStaff("/admin/new-booking");

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10">
      <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
        ← Dashboard
      </Link>
      <div className="mt-4 rounded-court border border-brand/30 bg-brand-accent/5 px-4 py-3">
        <p className="text-sm font-semibold text-ink">Booking on a caller&apos;s behalf</p>
        <p className="mt-1 text-xs text-ink-muted">
          Enter the caller&apos;s own name, email and phone — the confirmation and the
          cancellation link go to them, not to the desk. You can book up to{" "}
          {STAFF_HORIZON_DAYS} days ahead here; the public site stops at seven.
        </p>
      </div>

      <CourtBookingFlow horizonDays={STAFF_HORIZON_DAYS} staffMode />
    </div>
  );
}
