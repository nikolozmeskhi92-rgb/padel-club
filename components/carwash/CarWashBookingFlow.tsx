"use client";

import { useEffect, useMemo, useState } from "react";
import {
  PaymentModal,
  PaymentToast,
  simulationMessage,
  type PayMethod,
} from "@/components/booking/payment";
import { addDays, format } from "date-fns";
import { Loader2, Check, Droplets, Sparkles, Zap, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/pricing";
import { useGuestIdentity } from "@/lib/hooks/useGuestIdentity";
import { washSlotEnd } from "@/lib/carwash/suggest";
import {
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
  // Same identity as the court flow: the account's email, and whatever name
  // and phone this person last gave us. The wash form asks for no phone, so it
  // carries the stored one through untouched rather than blanking it.
  const { guest, setGuest, remember, signedIn } = useGuestIdentity();
  const [submitting, setSubmitting] = useState(false);

  /*
    The same payment step the court flow has.

    A wash could be reserved straight from the panel while a court took you
    through a screen that named the total and asked how you wanted to pay. Two
    ways to buy from one club, and the quieter one was the one that took your
    money without ever mentioning money.
  */
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>("club");
  const [simulating, setSimulating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // The page behind a modal should not scroll. iOS ignores overflow on <body>,
  // so the modal also carries overscroll-contain; between them a flick inside
  // stays inside. Deliberately not position:fixed — that locks properly and
  // then throws the page back to the top when released.
  useEffect(() => {
    if (!payOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [payOpen]);

  useEffect(() => {
    if (!payOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [payOpen]);

  /**
   * The one button at the bottom of the payment step.
   *
   * "Pay at the club" is not a demo — it runs the real booking, exactly as
   * Reserve did before this step existed. Card and PayPal have no provider
   * behind them, so they wait a beat and say so, and deliberately do NOT close
   * the modal or drop the slot: a customer who tries the card button and finds
   * their bay gone has been punished for tapping what the page offered.
   */
  async function payAndBook() {
    setError(null);
    if (payMethod === "club") {
      await submit();
      return;
    }
    setSimulating(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setSimulating(false);
    setToast(simulationMessage(payMethod));
  }
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

  /** Ranges already reserved, per bay. Turnaround is inside them, not after. */
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
    const end = washSlotEnd(start, service.duration);
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
      setPayOpen(false);
      setCode(data.booking.booking_code);
      // Keep the details for next time now that the booking is real.
      remember(guest);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (code) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-7 sm:px-8 py-24 text-center">
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
    <div className="mx-auto max-w-3xl px-7 sm:px-8 py-12">
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
      <div className="-mx-7 mt-8 flex snap-x snap-mandatory gap-2 overflow-x-auto px-7 pb-2 sm:-mx-8 sm:px-8 [&>*]:snap-start">
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
              readOnly={signedIn}
              onChange={(e) => setGuest({ ...guest, email: e.target.value })}
              className={cn(
                "w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm outline-none focus:border-brand",
                signedIn && "cursor-not-allowed text-ink-muted"
              )}
            />
            {signedIn && (
              <p className="-mt-1 text-[11px] text-ink-muted">
                Booking as {guest.email} — the confirmation goes to your account.
              </p>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <button
            disabled={!guest.name || !guest.email}
            onClick={() => setPayOpen(true)}
            className="mt-5 w-full rounded-court bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            Continue · {formatMoney(service.price)}
          </button>
        </div>
      )}

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        summary={[
          { label: "Wash", value: service.label },
          { label: "Bay", value: bay ? `Bay ${bay}` : "—" },
          {
            label: "When",
            value: time ? `${format(date, "EEE d MMM")} · ${time}` : "—",
          },
          { label: "Length", value: `${service.duration} min` },
        ]}
        totalLabel={formatMoney(service.price)}
        method={payMethod}
        onMethod={setPayMethod}
        onConfirm={payAndBook}
        busy={submitting || simulating}
        error={error}
        confirmLabel={
          payMethod === "club" ? `Confirm booking · ${formatMoney(service.price)}` : "Continue to payment"
        }
      />

      <PaymentToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
