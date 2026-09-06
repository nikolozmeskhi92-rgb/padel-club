"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { formatMoney } from "@/lib/pricing";
import { cn } from "@/lib/utils/cn";
import {
  CLOSE_HOUR,
  STAFF_HORIZON_DAYS,
  buildSlotLabels,
  clubDateKey,
  clubWallTimeToInstant,
} from "@/lib/time/club";
import type { AdminBooking } from "@/components/admin/BookingsTable";

type Booked = { court_id: number; slot: string; status: string };

const COURTS = Array.from({ length: 10 }, (_, i) => i + 1);
const TIME_SLOTS = buildSlotLabels(30);

function parseRange(pgRange: string): [Date, Date] {
  const m = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
  if (!m) return [new Date(0), new Date(0)];
  return [new Date(m[1]), new Date(m[2])];
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Moving a booking, with the price change shown before anything moves.
 *
 * The club's rule is that the new slot's price applies, which means a move can
 * cost the customer ₾55 more or hand them ₾55 back. Nobody should discover that
 * after the fact, so this asks the server for a quote first and only sends the
 * confirm once both numbers are on screen and the desk has read them out.
 *
 * Availability is the same endpoint the booking page uses, so a slot that looks
 * free here is free by the same definition. It is still only a picture: the
 * EXCLUDE constraint has the final say, and a slot taken in between comes back
 * as SLOT_TAKEN rather than quietly overwriting someone.
 */
export function RescheduleDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: AdminBooking;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const originalStart = booking.startIso ? new Date(booking.startIso) : new Date();
  const [date, setDate] = useState(() => clubDateKey(originalStart));
  const [duration, setDuration] = useState<60 | 90>(
    booking.durationMinutes === 90 ? 90 : 60
  );
  const [courtId, setCourtId] = useState<number | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const [booked, setBooked] = useState<Booked[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const maxDate = useMemo(
    () => clubDateKey(addDays(new Date(), STAFF_HORIZON_DAYS - 1)),
    []
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBooked(null);
    setError(null);
    fetch(`/api/bookings?date=${date}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        if (!Array.isArray(d?.bookings)) throw new Error("bad payload");
        setBooked(d.bookings);
      })
      .catch(() => {
        // Same rule as the customer's page: rather than show a grid we cannot
        // vouch for, show nothing and say so.
        if (!cancelled) setError("Couldn't load that day's availability.");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date]);

  /** Free means every half-hour the new slot spans is free — and this booking's
   *  own slot counts as free, since it is the thing being moved. */
  function isFree(court: number, hhmm: string) {
    if (!booked) return false;
    const start = toMinutes(hhmm);
    if (start + duration > CLOSE_HOUR * 60) return false;
    for (let offset = 0; offset < duration; offset += 30) {
      const at = clubWallTimeToInstant(
        date,
        `${String(Math.floor((start + offset) / 60)).padStart(2, "0")}:${String(
          (start + offset) % 60
        ).padStart(2, "0")}`
      ).getTime();
      const clash = booked.some((b) => {
        if (b.court_id !== court) return false;
        const [s, e] = parseRange(b.slot);
        return at >= s.getTime() && at < e.getTime();
      });
      if (clash) return false;
    }
    return clubWallTimeToInstant(date, hhmm).getTime() > Date.now();
  }

  async function send(confirm: boolean) {
    if (!courtId || !time) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bookings/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: booking.id,
          courtId,
          startTime: clubWallTimeToInstant(date, time).toISOString(),
          durationMinutes: duration,
          confirm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "SLOT_TAKEN"
            ? "That slot was taken while you were looking at it — pick another."
            : data.error === "NOT_RESCHEDULABLE"
              ? "Cancelled and finished bookings can't be moved."
              : data.error === "OUTSIDE_OPENING_HOURS"
                ? "That time falls outside opening hours."
                : "Couldn't move that booking."
        );
        return;
      }
      if (confirm) {
        const q = data.quote;
        const diff = q.differenceCents;
        onDone(
          `Moved ${q.bookingCode} to Court ${courtId}, ${format(
            clubWallTimeToInstant(date, time),
            "EEE d MMM HH:mm"
          )} — ` +
            (diff === 0
              ? `price unchanged at ${formatMoney(q.newPriceCents)}.`
              : diff > 0
                ? `${formatMoney(diff)} to collect (now ${formatMoney(q.newPriceCents)}).`
                : `${formatMoney(-diff)} to refund (now ${formatMoney(q.newPriceCents)}).`)
        );
      } else {
        setQuote(data.quote);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  const diff = quote?.differenceCents ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-court border border-line bg-surface-base p-6 shadow-card"
      >
        <h2 className="font-heading text-lg font-bold text-ink">
          Move {booking.resource} — {booking.name ?? "guest"}
        </h2>
        <p className="mt-1 text-xs text-ink-muted">
          Currently{" "}
          {booking.startIso ? format(new Date(booking.startIso), "EEE d MMM, HH:mm") : "—"} ·{" "}
          {formatMoney(booking.priceCents)} · {booking.code}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={date}
            min={clubDateKey(new Date())}
            max={maxDate}
            onChange={(e) => {
              setDate(e.target.value);
              setCourtId(null);
              setTime(null);
              setQuote(null);
            }}
            className="rounded-court border border-line bg-surface-muted px-3 py-1.5 text-sm text-ink"
          />
          {[60, 90].map((d) => (
            <button
              key={d}
              onClick={() => {
                setDuration(d as 60 | 90);
                setQuote(null);
              }}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-semibold",
                duration === d ? "border-brand bg-brand text-white" : "border-line text-ink-muted"
              )}
            >
              {d} min
            </button>
          ))}
        </div>

        {loading ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading that day…
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[640px] text-xs">
              <thead>
                <tr>
                  <th className="w-16" />
                  {TIME_SLOTS.filter((t) => toMinutes(t) % 60 === 0).map((t) => (
                    <th key={t} colSpan={2} className="pb-1 text-ink-muted">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COURTS.map((c) => (
                  <tr key={c}>
                    <td className="pr-2 font-semibold text-ink">Court {c}</td>
                    {TIME_SLOTS.map((t) => {
                      const free = isFree(c, t);
                      const picked = courtId === c && time === t;
                      return (
                        <td key={t} className="p-[1px]">
                          <button
                            disabled={!free}
                            title={`Court ${c} ${t}`}
                            onClick={() => {
                              setCourtId(c);
                              setTime(t);
                              setQuote(null);
                            }}
                            className={cn(
                              "h-6 w-full rounded-[3px] border",
                              picked
                                ? "border-brand bg-brand"
                                : free
                                  ? "border-line bg-surface-muted/60 hover:bg-brand/20"
                                  : "border-line/60 bg-ink/15"
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-court border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {/* The whole point of the two-step: both prices, side by side, before
            anything moves. */}
        {quote && (
          <div className="mt-4 rounded-court border border-brand/30 bg-brand-accent/5 p-4">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
              <span className="font-semibold">{formatMoney(quote.oldPriceCents)}</span>
              <ArrowRight className="h-4 w-4 text-ink-muted" />
              <span className="font-semibold">{formatMoney(quote.newPriceCents)}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  diff > 0
                    ? "bg-peak/20 text-ink"
                    : diff < 0
                      ? "bg-brand-accent/15 text-brand-accent"
                      : "bg-surface-muted text-ink-muted"
                )}
              >
                {diff === 0
                  ? "no change"
                  : diff > 0
                    ? `${formatMoney(diff)} to collect`
                    : `${formatMoney(-diff)} to refund`}
              </span>
            </p>
            {quote.equipmentCents > 0 && (
              <p className="mt-1 text-xs text-ink-muted">
                Includes {formatMoney(quote.equipmentCents)} of extras, carried over.
              </p>
            )}
            <p className="mt-1 text-xs text-ink-muted">
              Read both prices to the customer before confirming.
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-court border border-line px-4 py-2 text-sm text-ink-muted"
          >
            Cancel
          </button>
          {quote ? (
            <button
              disabled={busy}
              onClick={() => send(true)}
              className="flex items-center gap-2 rounded-court bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm move
            </button>
          ) : (
            <button
              disabled={busy || !courtId || !time}
              onClick={() => send(false)}
              className="flex items-center gap-2 rounded-court bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Check new price
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
