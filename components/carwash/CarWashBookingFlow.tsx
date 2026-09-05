"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { Loader2, Check, Droplets, Sparkles, Zap, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/pricing";
import {
  CHANGEOVER_MINUTES,
  buildSlotLabels,
  clubDateKey,
  clubWallTimeToInstant,
} from "@/lib/time/club";

const BAYS = [1, 2, 3, 4];
const SERVICES = [
  { id: "quick_wash", label: "Quick Wash", duration: 30, price: 800, icon: Droplets },
  { id: "full_detail", label: "Full Detail", duration: 60, price: 1500, icon: Sparkles },
  { id: "express_rinse", label: "Express Rinse", duration: 30, price: 1200, icon: Zap },
] as const;

/**
 * Slot labels come from the shared club-hours definition. They used to be built
 * here from `buildSlots(open = 7, close = 22)` — 07:00 to 21:30 — while the
 * courts and the home page both said 08:00-23:00, so the wash page offered an
 * hour before the club opened and shut 90 minutes early.
 */
const SLOTS = buildSlotLabels(30);

type WashBooking = { id: string; bay_id: number; slot: string; status: string };

function parseRange(pgRange: string): [Date, Date] {
  // Postgres tstzrange comes back like: ["2026-09-05 18:00:00+00","2026-09-05 18:40:00+00")
  const match = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
  if (!match) return [new Date(0), new Date(0)];
  return [new Date(match[1]), new Date(match[2])];
}

export function CarWashBookingFlow() {
  const [service, setService] = useState<(typeof SERVICES)[number]>(SERVICES[0]);
  const [bay, setBay] = useState<number | null>(null);
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState<string | null>(null);
  const [guest, setGuest] = useState({ name: "", email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const [booked, setBooked] = useState<WashBooking[]>([]);
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [gridError, setGridError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const next7Days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)), []);
  const dateKey = clubDateKey(date);

  /**
   * Live availability. This page previously drew every slot as free and only
   * found out about a clash when the customer submitted — the database refused
   * it and they were told to "try another slot" after filling in their details.
   * Same failure the court grid had before f4e5c26, same fix: ask first, and if
   * the answer can't be trusted, say so instead of guessing.
   */
  useEffect(() => {
    let cancelled = false;
    setLoadingGrid(true);
    setGridError(false);
    setBay(null);
    setTime(null);

    fetch(`/api/car-wash-bookings?date=${dateKey}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`availability ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (!Array.isArray(d?.bookings)) throw new Error("malformed availability payload");
        setBooked(d.bookings);
      })
      .catch(() => {
        if (cancelled) return;
        setBooked([]);
        setGridError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingGrid(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dateKey, reloadKey]);

  /** Ranges already reserved, per bay. The stored range includes the changeover. */
  const busyByBay = useMemo(() => {
    const map = new Map<number, [Date, Date][]>();
    for (const b of booked) {
      const list = map.get(b.bay_id) ?? [];
      list.push(parseRange(b.slot));
      map.set(b.bay_id, list);
    }
    return map;
  }, [booked]);

  /** The instant a label refers to, on the club's clock — not the visitor's. */
  function instantFor(label: string): Date {
    return clubWallTimeToInstant(dateKey, label);
  }

  function isFree(bayId: number, label: string): boolean {
    const start = instantFor(label);
    if (start.getTime() <= Date.now()) return false; // no booking the past
    const end = new Date(start.getTime() + (service.duration + CHANGEOVER_MINUTES) * 60_000);
    const busy = busyByBay.get(bayId) ?? [];
    return !busy.some(([bs, be]) => start < be && end > bs);
  }

  /** A slot is offered if at least one bay can take it; a bay is offered if it can take the chosen slot. */
  const anyBayFree = (label: string) => BAYS.some((b) => isFree(b, label));
  const bayCanTakeSelected = (b: number) => (time ? isFree(b, time) : BAYS.length > 0);

  async function submit() {
    if (!bay || !time) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/car-wash-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bayId: bay,
          startTime: instantFor(time).toISOString(),
          service: service.id,
          durationMinutes: service.duration,
          guestName: guest.name,
          guestEmail: guest.email,
          // Nothing is charged online yet, so the booking is recorded as paid
          // on site. See the note under checkout.
          paymentMethod: "cash",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "SLOT_TAKEN") {
          setError("That bay just got booked — pick another slot.");
          setReloadKey((k) => k + 1); // refresh the grid so the taken slot greys out
        } else if (data.error === "OUTSIDE_OPENING_HOURS") {
          setError("That time falls outside the club's opening hours.");
        } else if (data.error === "SLOT_IN_PAST") {
          setError("That time has already passed.");
        } else {
          setError("Something went wrong.");
        }
        setSubmitting(false);
        return;
      }
      setCode(data.booking.booking_code);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (code) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/10">
          <Check className="h-8 w-8 text-brand-accent" />
        </div>
        <h1 className="mt-6 font-heading text-2xl font-extrabold text-ink">Car wash booked</h1>
        <p className="mt-2 text-ink-muted">
          Code <span className="font-mono text-brand">{code}</span> — drop your keys at Bay {bay}.
        </p>
        <p className="mt-4 text-sm text-ink-muted/80">
          Pay at the club when you drop the car off.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink md:text-4xl">
        Book a car wash
      </h1>
      <p className="mt-2 text-ink-muted">
        4 wash bays &middot; 30&ndash;60 min cycles &middot; drop your car off, play your match, drive away clean.
      </p>

      {/* Service */}
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {SERVICES.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => {
                setService(s);
                setTime(null); // a longer cycle may not fit where the old one did
              }}
              className={cn(
                "rounded-court border p-4 text-left transition-colors",
                service.id === s.id ? "border-brand bg-brand/5" : "border-line"
              )}
            >
              <Icon className="h-5 w-5 text-brand-accent" />
              <p className="mt-3 text-sm font-semibold text-ink">{s.label}</p>
              <p className="text-xs text-ink-muted">{s.duration} min &middot; {formatMoney(s.price)}</p>
            </button>
          );
        })}
      </div>

      {/* Date */}
      <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
        {next7Days.map((d) => (
          <button
            key={d.toISOString()}
            onClick={() => setDate(d)}
            className={cn(
              "flex min-w-[64px] flex-col items-center rounded-court border px-3 py-2.5",
              clubDateKey(d) === dateKey ? "border-brand bg-brand/5 text-brand" : "border-line text-ink-muted"
            )}
          >
            <span className="text-xs">{format(d, "EEE")}</span>
            <span className="text-lg font-bold">{format(d, "d")}</span>
          </button>
        ))}
      </div>

      {loadingGrid && (
        <div className="mt-10 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking which bays are free&hellip;
        </div>
      )}

      {!loadingGrid && gridError && (
        <div className="mt-10 rounded-court border border-red-200 bg-red-50/60 p-8 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
          <p className="mt-3 text-sm font-semibold text-ink">We couldn&apos;t load live availability</p>
          <p className="mt-1 text-sm text-ink-muted">
            Rather than show you bays that might already be taken, we&apos;ve hidden them. Try again in a moment.
          </p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-court bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        </div>
      )}

      {!loadingGrid && !gridError && (
        <>
          {/* Time */}
          <p className="mt-8 mb-3 text-sm font-semibold text-ink-muted">Choose a time</p>
          <div className="flex flex-wrap gap-2">
            {SLOTS.map((t) => {
              const free = anyBayFree(t);
              const selected = time === t;
              return (
                <button
                  key={t}
                  disabled={!free}
                  onClick={() => {
                    setTime(t);
                    if (bay && !isFree(bay, t)) setBay(null);
                  }}
                  title={free ? undefined : "No bay free for this cycle length"}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                    selected
                      ? "border-brand bg-brand text-white"
                      : free
                        ? "border-line text-ink-muted hover:border-brand"
                        : "cursor-not-allowed border-line/60 text-ink-muted/35 line-through"
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
          {SLOTS.every((t) => !anyBayFree(t)) && (
            <p className="mt-3 text-sm text-ink-muted">
              Every bay is booked for this service on this day — try another date.
            </p>
          )}

          {/* Bay */}
          {time && (
            <>
              <p className="mt-8 mb-3 text-sm font-semibold text-ink-muted">Choose a bay</p>
              <div className="flex gap-3">
                {BAYS.map((b) => {
                  const free = bayCanTakeSelected(b);
                  return (
                    <button
                      key={b}
                      disabled={!free}
                      onClick={() => setBay(b)}
                      title={free ? undefined : "Busy at this time"}
                      className={cn(
                        "flex h-16 w-16 flex-col items-center justify-center rounded-court border text-sm font-semibold transition-colors",
                        bay === b
                          ? "border-brand bg-brand/5 text-brand"
                          : free
                            ? "border-line text-ink-muted hover:border-brand"
                            : "cursor-not-allowed border-line/60 text-ink-muted/35"
                      )}
                    >
                      <span>Bay {b}</span>
                      {!free && <span className="text-[10px] font-normal">busy</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Guest + checkout */}
      {bay && time && (
        <div className="mt-10 rounded-court border border-line bg-surface-base shadow-card p-6">
          <div className="space-y-3">
            <input
              placeholder="Full name"
              value={guest.name}
              onChange={(e) => setGuest({ ...guest, name: e.target.value })}
              className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
            <input
              placeholder="Email"
              type="email"
              value={guest.email}
              onChange={(e) => setGuest({ ...guest, email: e.target.value })}
              className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
          </div>

          {/*
            The bank buttons that used to sit here (BOG / TBC / PayPal) charged
            nothing: no /api/checkout route exists, so the booking was written
            as `unpaid` and the customer walked away believing they had paid.
            Until a provider is actually wired up, the honest thing to show is
            where payment happens.
          */}
          <p className="mt-4 rounded-court bg-surface-muted px-4 py-3 text-xs text-ink-muted">
            Pay at the club when you drop the car off. We&apos;ll hold the bay for you.
          </p>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <button
            disabled={submitting || !guest.name || !guest.email}
            onClick={submit}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Reserve for {formatMoney(service.price)}
          </button>
        </div>
      )}
    </div>
  );
}
