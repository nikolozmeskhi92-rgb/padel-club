"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Phone, Mail, UserCheck, Trash2 } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { CLUB_TIMEZONE } from "@/lib/time/club";
import { cn } from "@/lib/utils/cn";

export type AdminBooking = {
  id: string;
  kind: "court" | "car_wash";
  resource: string;
  startIso: string | null;
  durationMinutes: number | null;
  status: string;
  paymentStatus: string;
  priceCents: number;
  code: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  hasAccount: boolean;
};

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const CANCEL_MESSAGES: Record<string, string> = {
  ALREADY_CANCELLED: "That booking is already cancelled.",
  BOOKING_NOT_FOUND: "That booking no longer exists.",
  NOT_CANCELLABLE: "Completed and no-show bookings can't be cancelled.",
  FORBIDDEN: "Your session has expired — sign in again.",
};

const DELETE_MESSAGES: Record<string, string> = {
  BOOKING_NOT_FOUND: "That booking no longer exists.",
  FORBIDDEN: "Your session has expired — sign in again.",
};

export function BookingsTable({ rows }: { rows: AdminBooking[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function cancel(b: AdminBooking) {
    // A cancellation moves money — a refund, or credit issued against the
    // club. Worth one deliberate confirmation, with the outcome spelled out
    // rather than a bare "are you sure?".
    const ok = window.confirm(
      `Cancel ${b.resource} on ${b.startIso ? when.format(new Date(b.startIso)) : "—"} for ` +
        `${b.name ?? "this guest"}?\n\n` +
        `The database decides refund vs club credit from the cancellation policy. ` +
        `This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(b.id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/bookings/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingType: b.kind,
          bookingId: b.id,
          reason: "Cancelled at the desk",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(CANCEL_MESSAGES[data.error] ?? "Couldn't cancel that booking.");
        return;
      }
      const r = data.result ?? {};
      setDone(
        r.outcome === "refunded"
          ? `Cancelled — ${formatMoney(r.refund_cents ?? 0)} refunded.`
          : r.outcome === "credited"
            ? `Cancelled — ${formatMoney(r.credit_cents ?? 0)} issued as credit, code ${r.credit_code}.`
            : "Cancelled — the slot is back on sale."
      );
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Delete is not a stronger cancel — it is a different thing, and the
   * confirmation says so. Cancelling records that a booking happened and was
   * called off; deleting is for rows that should never have existed at all
   * (a test, a duplicate, a wrong number). It cannot be undone and it leaves
   * nothing behind, so the wording avoids "cancel" entirely.
   */
  async function remove(b: AdminBooking) {
    const ok = window.confirm(
      `Delete ${b.resource} on ${b.startIso ? when.format(new Date(b.startIso)) : "—"} for ` +
        `${b.name ?? "this guest"}?\n\n` +
        `The booking and its record disappear completely — no refund, no credit, ` +
        `nothing in the history. Use Cancel instead if the customer called it off.\n\n` +
        `This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(b.id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/admin/bookings/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingType: b.kind, bookingId: b.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "HAS_CREDIT_NOTE"
            ? `That booking issued credit note ${data.creditCode}, which the club still owes. ` +
              `It can be cancelled, but not deleted.`
            : (DELETE_MESSAGES[data.error] ?? "Couldn't delete that booking.")
        );
        return;
      }
      setDone(`Deleted ${data.deleted?.booking_code ?? "the booking"} — the slot is free again.`);
      router.refresh();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-court border border-line bg-surface-base p-10 text-center shadow-card">
        <p className="text-sm font-semibold text-ink">Nothing matches</p>
        <p className="mt-1 text-sm text-ink-muted">
          Try a wider date range, or clear the search.
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <p className="mt-4 rounded-court border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {done && (
        <p className="mt-4 rounded-court border border-brand-accent/30 bg-brand-accent/5 px-4 py-3 text-sm text-ink">
          {done}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-court border border-line bg-surface-base shadow-card">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">Resource</th>
              <th className="px-4 py-3 font-semibold">Guest</th>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Price</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const cancelled = b.status === "cancelled";
              return (
                <tr
                  key={`${b.kind}-${b.id}`}
                  className={cn("border-b border-line/60 last:border-0", cancelled && "opacity-55")}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-ink">
                    {b.startIso ? when.format(new Date(b.startIso)) : "—"}
                    {b.durationMinutes && (
                      <span className="ml-1 text-xs text-ink-muted">{b.durationMinutes}m</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 capitalize text-ink">{b.resource}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 font-medium text-ink">
                      {b.name ?? "—"}
                      {b.hasAccount && (
                        <UserCheck className="h-3.5 w-3.5 text-brand" aria-label="Has an account" />
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-muted">
                      {b.phone && (
                        <a href={`tel:${b.phone}`} className="flex items-center gap-1 hover:text-ink">
                          <Phone className="h-3 w-3" />
                          {b.phone}
                        </a>
                      )}
                      {b.email && (
                        <a href={`mailto:${b.email}`} className="flex items-center gap-1 hover:text-ink">
                          <Mail className="h-3 w-3" />
                          {b.email}
                        </a>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-muted">
                    {b.code}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">
                    {formatMoney(b.priceCents)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
                        cancelled
                          ? "bg-surface-muted text-ink-muted"
                          : b.paymentStatus === "paid"
                            ? "bg-brand-accent/10 text-brand-accent"
                            : "bg-peak/10 text-peak"
                      )}
                    >
                      {cancelled ? "cancelled" : b.paymentStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!cancelled && (
                        <button
                          onClick={() => cancel(b)}
                          disabled={busyId === b.id}
                          className="inline-flex items-center gap-1.5 rounded-court border border-line px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                          {busyId === b.id && <Loader2 className="h-3 w-3 animate-spin" />}
                          Cancel
                        </button>
                      )}
                      <button
                        onClick={() => remove(b)}
                        disabled={busyId === b.id}
                        title="Delete this booking permanently"
                        aria-label={`Delete booking ${b.code}`}
                        className="inline-flex items-center gap-1.5 rounded-court border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
