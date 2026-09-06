"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check, AlertCircle, Droplets, Clock, RefreshCw, ChevronDown, Home } from "lucide-react";
import { isPeakHour, formatMoney } from "@/lib/pricing";
import { cn } from "@/lib/utils/cn";
import {
  CLOSE_HOUR,
  OPEN_HOUR,
  buildSlotLabels,
  clubDateKey,
  clubHHMM,
  clubWallTimeToInstant,
  PUBLIC_HORIZON_DAYS,
} from "@/lib/time/club";
import type { WashRecommendationResult, WashSuggestion } from "@/lib/carwash/suggest";
import { CourtMap, type CourtMapBooking } from "@/components/courts/CourtMap";
import { useGuestIdentity } from "@/lib/hooks/useGuestIdentity";
import { MonthPicker } from "@/components/booking/MonthPicker";
import { CLUB_PHONE } from "@/lib/club";

type CourtRow = { id: number; name: string; indoor: boolean };
type BookedSlot = { court_id: number; slot: string; status: string };
type Equipment = { id: number; name: string; price_cents: number };

const COURTS: CourtRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  name: `Court ${i + 1}`,
  indoor: i >= 7,
}));

const EQUIPMENT: Equipment[] = [
  { id: 1, name: "Racket Rental", price_cents: 800 },
  { id: 2, name: "Ball Can (x3)", price_cents: 500 },
  { id: 3, name: "Grip Tape", price_cents: 300 },
];

// Opening hours and the slot grid come from lib/time/club, which the API and
// the wash page read too. They used to be redeclared here, and the wash page
// had its own 07:00-22:00 pair that disagreed with both this and the homepage.
const TIME_SLOTS = buildSlotLabels(30);

const CLOSE_MINUTES = CLOSE_HOUR * 60;

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(mins: number) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * People arrive knowing when they want to play, not which court they want.
 * Grouping the day into three periods lets the page open on the part of the day
 * the customer is actually shopping for — previously the 18:00-23:00 block, the
 * busiest and most expensive hours, sat off the right edge of a wide table.
 */
const PERIODS = [
  { id: "morning", label: "Morning", sub: "10:00–12:00", from: 10 * 60, to: 12 * 60 },
  { id: "afternoon", label: "Afternoon", sub: "12:00–17:00", from: 12 * 60, to: 17 * 60 },
  { id: "evening", label: "Evening", sub: "17:00–24:00", from: 17 * 60, to: 24 * 60 },
] as const;

type PeriodId = (typeof PERIODS)[number]["id"];

type Step = "slot" | "extras" | "checkout" | "success";

/**
 * `horizonDays` is how far ahead this caller may book. The public gets a week
 * as a row of day chips; the desk gets a month as a calendar, because a caller
 * says "the 24th" and nobody wants to count chips. The server enforces the same
 * limit — this only decides what is offered.
 */
export function CourtBookingFlow({
  horizonDays = PUBLIC_HORIZON_DAYS,
  staffMode = false,
}: {
  horizonDays?: number;
  staffMode?: boolean;
} = {}) {
  const [date, setDate] = useState(new Date());
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<60 | 90>(60);
  const [booked, setBooked] = useState<BookedSlot[]>([]);
  /**
   * Starts true so the server and the first client render agree.
   *
   * Availability, "Passed" labels and the list of remaining slots all depend on
   * the current time, which differs between the server render and hydration —
   * that mismatch threw React #418/#423/#425 and made React discard and re-render
   * the whole tree. Rendering the skeleton until the browser has fetched real
   * availability keeps both passes identical, and there is nothing truthful to
   * show before that fetch anyway.
   */
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [gridError, setGridError] = useState(false);
  const [gridReloadKey, setGridReloadKey] = useState(0);
  const [period, setPeriod] = useState<PeriodId>("evening");
  const [step, setStep] = useState<Step>("slot");
  const [equipment, setEquipment] = useState<Record<number, number>>({});
  // Checkout fills itself: the account's email, and whatever name and phone
  // this person last gave us. See lib/hooks/useGuestIdentity.
  const { guest, setGuest, remember, signedIn } = useGuestIdentity({ enabled: !staffMode });
  // Nothing is charged online yet, so every booking is recorded as settled on
  // site. Restore a real selector when a payment provider is wired up.
  const paymentMethod = "cash" as const;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // --- Car wash cross-sell ---
  const [washResult, setWashResult] = useState<WashRecommendationResult | null>(null);
  const [loadingWash, setLoadingWash] = useState(false);
  // Was a boolean over a single recommended slot. The club sells three washes;
  // the customer now picks which one (or none), so this holds the choice itself.
  const [chosenWash, setChosenWash] = useState<WashSuggestion | null>(null);
  const [washAdded, setWashAdded] = useState(false); // reflected in the success screen
  const [washMissed, setWashMissed] = useState(false); // wanted a wash, lost the bay

  const dayChips = useMemo(
    () => Array.from({ length: horizonDays }, (_, i) => addDays(new Date(), i)),
    [horizonDays]
  );
  const lastBookableDay = useMemo(
    () => addDays(new Date(), horizonDays - 1),
    [horizonDays]
  );

  // A failed availability fetch used to fall back to an empty `booked` list,
  // which renders every slot as free — the customer picks an already-taken
  // court and only finds out at checkout. Failing loudly is the safer default.
  useEffect(() => {
    let cancelled = false;
    setLoadingGrid(true);
    setGridError(false);
    setSelectedCourt(null);
    setSelectedTime(null);

    fetch(`/api/bookings?date=${clubDateKey(date)}`)
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
  }, [clubDateKey(date), gridReloadKey]);

  function isSlotTaken(courtId: number, time: string) {
    const slotStart = slotStartDate(time);
    return booked.some((b) => {
      if (b.court_id !== courtId) return false;
      const [rangeStart, rangeEnd] = parseRange(b.slot);
      return slotStart >= rangeStart && slotStart < rangeEnd;
    });
  }

  /**
   * The instant a "19:00" label refers to, on the CLUB's clock.
   * This used to be `new Date(date); d.setHours(h, m)`, i.e. the *visitor's*
   * clock — someone booking from Berlin picked 19:00 and reserved 21:00 in
   * Tbilisi. Everything downstream (the taken-slot check, pricing, the POST)
   * derives from this one function.
   */
  function slotStartDate(time: string) {
    return clubWallTimeToInstant(clubDateKey(date), time);
  }

  /**
   * A slot is bookable only if EVERY half-hour block it spans is free, it
   * finishes before the club closes, and it hasn't already started.
   *
   * The old grid checked only the starting block, so a 90-minute booking could
   * be selected on top of an existing one and a 22:30 start could run half an
   * hour past closing — both rejected by the server after the customer had
   * filled in the whole checkout form.
   */
  function isCourtFree(courtId: number, time: string, mins: number) {
    const start = toMinutes(time);
    if (start + mins > CLOSE_MINUTES) return false;
    for (let offset = 0; offset < mins; offset += 30) {
      if (isSlotTaken(courtId, toHHMM(start + offset))) return false;
    }
    return true;
  }

  function isPast(time: string) {
    return isSameDay(date, new Date()) && slotStartDate(time).getTime() <= Date.now();
  }

  /** Mirrors the pricing_rules seed data; the server always re-prices on submit. */
  function basePriceFor(time: string, mins: 60 | 90) {
    const d = slotStartDate(time);
    // Mirrors migration 0012: peak is weekday evenings from 19:00 and weekends
    // from noon. The server re-prices on submit, so this only has to agree with
    // the rules for the label to be honest — and when it didn't, the page
    // quoted ₾40 while the server charged ₾80.
    const peak = isPeakHour(d);
    return peak ? (mins === 60 ? 8000 : 12000) : mins === 60 ? 6000 : 9000;
  }

  /**
   * `booked` arrives as Postgres range literals; the map wants two instants.
   * Cancelled rows are filtered by the map itself so one rule covers both views.
   */
  const mapBookings: CourtMapBooking[] = useMemo(
    () =>
      booked.map((b) => {
        const [start, end] = parseRange(b.slot);
        return {
          courtId: b.court_id,
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          status: b.status,
        };
      }),
    [booked]
  );

  /** Half-hours already gone — only meaningful when the chosen day is today. */
  const pastBeforeMinutes = useMemo(() => {
    if (!isSameDay(date, new Date())) return null;
    const now = clubHHMM(new Date());
    return toMinutes(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubDateKey(date), booked]);

  /** Times that can actually be booked today, with the courts free for each. */
  const availability = useMemo(() => {
    const map = new Map<string, CourtRow[]>();
    for (const t of TIME_SLOTS) {
      if (toMinutes(t) + duration > CLOSE_MINUTES) continue;
      if (isPast(t)) continue;
      map.set(t, COURTS.filter((c) => isCourtFree(c.id, t, duration)));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booked, duration, date]);

  /**
   * True when nothing in the period can still be booked today.
   *
   * This used to compare the clock against the period's nominal end, so between
   * the last bookable start and that end — 11:30 and 12:00 for the morning —
   * the label fell through to "Fully booked". That told the customer the courts
   * were taken when the morning was simply over. Ask the real question instead:
   * is there any slot left in this period that could still start?
   */
  function periodHasPassed(from: number, to: number) {
    if (!isSameDay(date, new Date())) return false;
    return !TIME_SLOTS.some((t) => {
      const m = toMinutes(t);
      return m >= from && m < to && m + duration <= CLOSE_MINUTES && !isPast(t);
    });
  }

  const freeByPeriod = useMemo(() => {
    const counts: Record<string, number> = { morning: 0, afternoon: 0, evening: 0 };
    for (const [t, courts] of availability) {
      if (courts.length === 0) continue;
      const m = toMinutes(t);
      const p = PERIODS.find((x) => m >= x.from && m < x.to);
      if (p) counts[p.id] += 1;
    }
    return counts;
  }, [availability]);

  /**
   * Land on a period that has something in it. Evening is the default because
   * that is when most people play, but on a Tuesday at 21:00 — or on a fully
   * booked evening — sending the customer to an empty list is worse than
   * showing them tomorrow morning's options.
   */
  useEffect(() => {
    if (loadingGrid || gridError) return;
    if (freeByPeriod[period] > 0) return;
    const fallback = PERIODS.find((p) => freeByPeriod[p.id] > 0);
    if (fallback) setPeriod(fallback.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeByPeriod, loadingGrid, gridError]);

  // Fetch the car-wash recommendation the moment the customer moves to the
  // extras step — this is when we know the exact court slot to check against.
  useEffect(() => {
    if (step !== "extras" || !selectedTime) return;
    let cancelled = false;
    setLoadingWash(true);
    const courtStart = slotStartDate(selectedTime);

    fetch(`/api/car-wash/suggestions?courtStart=${encodeURIComponent(courtStart.toISOString())}&durationMinutes=${duration}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.result) return;
        const raw = data.result;
        const reviveSuggestion = (s: any): WashSuggestion => ({
          ...s,
          start: new Date(s.start),
          end: new Date(s.end),
        });
        setWashResult({
          tier: raw.tier,
          best: raw.best ? reviveSuggestion(raw.best) : null,
          alternatives: (raw.alternatives ?? []).map(reviveSuggestion),
          perService: (raw.perService ?? []).map(reviveSuggestion),
        });
        // Always off by default. This used to switch itself on for a
        // "perfect_fit" match, which meant picking a court silently added GEL 8
        // to the total — the customer had to notice an extra they never asked
        // for and untick it. An upsell the buyer has to opt out of is the kind
        // of thing that turns into an argument at the desk. Recommend it
        // prominently, but let them choose it.
        setChosenWash(null);
      })
      .catch(() => setWashResult(null))
      .finally(() => !cancelled && setLoadingWash(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedTime, selectedCourt, duration]);

  const price = useMemo(() => {
    if (!selectedTime) return 0;
    const base = basePriceFor(selectedTime, duration);
    const equipTotal = Object.entries(equipment).reduce(
      (sum, [id, qty]) => sum + (EQUIPMENT.find((e) => e.id === Number(id))?.price_cents ?? 0) * qty,
      0
    );
    const washTotal = chosenWash ? chosenWash.service.priceCents : 0;
    return base + equipTotal + washTotal;
  }, [selectedTime, duration, equipment, date, chosenWash]);

  async function submitBooking() {
    if (!selectedCourt || !selectedTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: selectedCourt,
          startTime: slotStartDate(selectedTime).toISOString(),
          durationMinutes: duration,
          guestName: guest.name,
          guestEmail: guest.email,
          guestPhone: guest.phone,
          paymentMethod,
          equipment: Object.entries(equipment)
            .filter(([, qty]) => qty > 0)
            .map(([equipmentId, quantity]) => ({ equipmentId: Number(equipmentId), quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "SLOT_TAKEN") {
          setError("That slot was just taken by someone else — please pick another time.");
        } else if (data.error === "BEYOND_BOOKING_HORIZON") {
          setError(
            `We only take online bookings ${data.horizonDays} days ahead. Get in touch and we'll arrange a date further out.`
          );
        } else {
          setError("Something went wrong. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      setBookingCode(data.booking.booking_code);
      setEmailSent(Boolean(data.emailSent));

      // Now that the booking is real, keep these details for next time — on the
      // account if they are signed in, in this browser if they are not. Doing it
      // here rather than on every keystroke means a half-typed number never
      // becomes the default.
      remember(guest);

      // Cross-sell: if the customer opted into the recommended wash slot,
      // book it now, linked to the court booking that just succeeded.
      // This never blocks the court confirmation — if the wash bay got
      // taken in the last few seconds, the court booking still stands.
      if (chosenWash) {
        try {
          const washRes = await fetch("/api/car-wash-bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bayId: chosenWash.bayId,
              startTime: chosenWash.start.toISOString(),
              service: chosenWash.service.id,
              durationMinutes: chosenWash.service.durationMinutes,
              guestName: guest.name,
              guestEmail: guest.email,
              paymentMethod,
              linkedCourtBookingId: data.booking.id,
            }),
          });
          if (washRes.ok) {
            setWashAdded(true);
          } else {
            // The bay was free when the panel loaded and is not now. The court
            // booking stands either way, but saying nothing would leave someone
            // handing over car keys at a bay that isn't expecting them.
            setWashMissed(true);
          }
        } catch {
          setWashMissed(true);
        }
      }

      setStep("success");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "success" && bookingCode) {
    return (
      <SuccessPanel
        bookingCode={bookingCode}
        email={guest.email}
        washAdded={washAdded}
        washMissed={washMissed}
        emailSent={emailSent}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink md:text-4xl">Book a court</h1>
      <p className="mt-2 text-ink-muted">Pick a day and a time — we&apos;ll show you which courts are free.</p>

      {/* Which day. A week of chips for the public, a calendar for the desk. */}
      {staffMode ? (
        <div className="mt-8 max-w-sm">
          <MonthPicker value={date} onChange={setDate} maxDate={lastBookableDay} />
        </div>
      ) : (
        <>
          <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
            {dayChips.map((d) => (
              <button
                key={d.toISOString()}
                onClick={() => setDate(d)}
                className={cn(
                  "flex min-w-[64px] flex-col items-center rounded-court border px-3 py-2.5 transition-colors",
                  isSameDay(d, date)
                    ? "border-brand bg-brand-accent/10 text-brand"
                    : "border-line text-ink-muted hover:border-ink-muted/30"
                )}
              >
                <span className="text-xs">{format(d, "EEE")}</span>
                <span className="text-lg font-bold">{format(d, "d")}</span>
              </button>
            ))}
          </div>

          {/*
            Say where the window ends and what to do about it. Without this the
            strip simply stops at seven days and the customer is left to guess
            whether the club is closed, full, or not taking bookings.
          */}
          <p className="mt-2 text-xs text-ink-muted">
            Online booking runs to {format(lastBookableDay, "EEEE d MMM")}. For a court
            further out,{" "}
            {CLUB_PHONE ? (
              <a href={`tel:${CLUB_PHONE.replace(/\s/g, "")}`} className="font-semibold text-brand">
                call us on {CLUB_PHONE}
              </a>
            ) : (
              <a href="/directions" className="font-semibold text-brand">
                get in touch
              </a>
            )}{" "}
            and we&apos;ll arrange it.
          </p>
        </>
      )}

      {/* Duration toggle */}
      <div className="mt-6 flex items-center gap-3">
        <span className="text-sm text-ink-muted">Duration:</span>
        {[60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDuration(d as 60 | 90)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors",
              duration === d
                ? "border-brand bg-brand text-white"
                : "border-line text-ink-muted"
            )}
          >
            {d} min
          </button>
        ))}
      </div>

      {/* Availability could not be loaded — offer nothing rather than slots we
          cannot vouch for. */}
      {gridError && !loadingGrid && (
        <div className="mt-8 rounded-court border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
          <p className="mt-3 text-sm font-semibold text-ink">
            We couldn&apos;t load live availability
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Rather than show you slots that might already be taken, we&apos;ve hidden them.
            Try again in a moment.
          </p>
          <button
            onClick={() => setGridReloadKey((k) => k + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-court bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      )}

      {!gridError && (
        <div className="mt-8">
          {/* Period tabs — the whole day in three taps instead of a 30-column scroll */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Time of day">
            {PERIODS.map((p) => {
              const count = freeByPeriod[p.id];
              const active = period === p.id;
              return (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={active}
                  disabled={!loadingGrid && count === 0}
                  onClick={() => {
                    setPeriod(p.id);
                    setSelectedTime(null);
                    setSelectedCourt(null);
                  }}
                  className={cn(
                    "flex flex-col items-start rounded-court border px-4 py-2.5 text-left transition-colors",
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-surface-base text-ink hover:border-ink-muted/40",
                    !loadingGrid && count === 0 && "cursor-not-allowed opacity-45"
                  )}
                >
                  <span className="text-sm font-semibold">{p.label}</span>
                  <span className={cn("text-xs", active ? "text-white/75" : "text-ink-muted")}>
                    {loadingGrid
                      ? p.sub
                      : count > 0
                      ? `${count} slot${count === 1 ? "" : "s"} open`
                      : periodHasPassed(p.from, p.to)
                      ? "Passed"
                      : "Fully booked"}
                  </span>
                </button>
              );
            })}
          </div>

          {loadingGrid ? (
            <div className="mt-5 space-y-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-court bg-surface-muted" />
              ))}
            </div>
          ) : (
            <TimeList
              period={period}
              availability={availability}
              duration={duration}
              selectedTime={selectedTime}
              selectedCourt={selectedCourt}
              priceFor={basePriceFor}
              isPeak={(t) => isPeakHour(slotStartDate(t))}
              onPickTime={(t) => {
                setSelectedTime(selectedTime === t ? null : t);
                setSelectedCourt(null);
              }}
              onPickCourt={setSelectedCourt}
            />
          )}

          {/* The same grid the desk looks at. The list above answers "what can I
              book at seven"; this answers "when is anything free at all", which
              is the question people actually arrive with. Clicking a free block
              picks it, so seeing the gap and taking it is one gesture. */}
          {!loadingGrid && (
            <CourtMap
              className="mt-8"
              title="Live court map"
              courts={COURTS}
              bookings={mapBookings}
              dateLabel={format(date, "EEE d MMM")}
              variant="public"
              pastBeforeMinutes={pastBeforeMinutes}
              selected={
                selectedCourt && selectedTime
                  ? {
                      courtId: selectedCourt,
                      minutes: toMinutes(selectedTime),
                      spanMinutes: duration,
                    }
                  : null
              }
              onSelect={(courtId, time) => {
                // Only offer what the flow itself would accept: a full free run
                // of `duration`, inside opening hours, not already gone.
                if (!isCourtFree(courtId, time, duration) || isPast(time)) return;
                const p = PERIODS.find((x) => toMinutes(time) >= x.from && toMinutes(time) < x.to);
                if (p) setPeriod(p.id);
                setSelectedTime(time);
                setSelectedCourt(courtId);
              }}
            />
          )}
        </div>
      )}


      {/* Sticky summary bar */}
      <AnimatePresence>
        {selectedCourt && selectedTime && step === "slot" && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur-md"
          >
            <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-semibold text-ink">
                  Court {selectedCourt} · {format(date, "EEE MMM d")} · {selectedTime}
                </p>
                <p className="text-xs text-ink-muted/80">{duration} min · {formatMoney(price)}</p>
              </div>
              <button
                onClick={() => setStep("extras")}
                className="rounded-court bg-brand px-5 py-2.5 text-sm font-semibold text-white"
              >
                Continue
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Extras + checkout modal-like panel */}
      <AnimatePresence>
        {(step === "extras" || step === "checkout") && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
            onClick={() => setStep("slot")}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-court border border-line bg-surface-base shadow-card p-6 sm:rounded-court"
            >
              {step === "extras" && (
                <>
                  <h2 className="font-heading text-xl font-bold text-ink">Anything else?</h2>
                  <p className="mt-1 text-sm text-ink-muted/80">Optional — skip if you're all set.</p>
                  <div className="mt-5 space-y-3">
                    {EQUIPMENT.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-court border border-line p-3">
                        <div>
                          <p className="text-sm font-medium text-ink">{item.name}</p>
                          <p className="text-xs text-ink-muted/80">{formatMoney(item.price_cents)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              setEquipment((prev) => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] ?? 0) - 1) }))
                            }
                            className="h-7 w-7 rounded-full border border-line text-ink"
                          >
                            −
                          </button>
                          <span className="w-4 text-center text-sm">{equipment[item.id] ?? 0}</span>
                          <button
                            onClick={() => setEquipment((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }))}
                            className="h-7 w-7 rounded-full border border-line text-ink"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 border-t border-line pt-5">
                    <WashCrossSell
                      loading={loadingWash}
                      result={washResult}
                      chosen={chosenWash}
                      onChoose={setChosenWash}
                    />
                  </div>

                  <button
                    onClick={() => setStep("checkout")}
                    className="mt-6 w-full rounded-court bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
                  >
                    Continue to checkout · {formatMoney(price)}
                  </button>
                </>
              )}

              {step === "checkout" && (
                <>
                  <h2 className="font-heading text-xl font-bold text-ink">Checkout</h2>
                  <div className="mt-5 space-y-3">
                    <input
                      placeholder="Full name"
                      value={guest.name}
                      onChange={(e) => setGuest({ ...guest, name: e.target.value })}
                      className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
                    />
                    <input
                      placeholder="Email"
                      type="email"
                      value={guest.email}
                      readOnly={signedIn}
                      onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                      className={cn(
                        "w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand",
                        signedIn && "cursor-not-allowed text-ink-muted"
                      )}
                    />
                    {signedIn && (
                      <p className="-mt-1 text-[11px] text-ink-muted">
                        Booking as {guest.email} — the confirmation goes to your account.
                      </p>
                    )}
                    <input
                      placeholder="Phone"
                      value={guest.phone}
                      onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                      className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
                    />

                    {/*
                      BOG / TBC / PayPal buttons used to sit here and charged
                      nothing — no /api/checkout route exists, so the booking
                      was stored `unpaid` while the customer believed they had
                      paid. Hidden until a provider is really wired up.
                    */}
                    <p className="mt-2 rounded-court bg-surface-muted px-4 py-3 text-xs text-ink-muted">
                      Pay at the club when you arrive. We&apos;ll hold the court for you.
                    </p>
                  </div>

                  {error && (
                    <div className="mt-4 flex items-center gap-2 rounded-court border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                    </div>
                  )}

                  <button
                    disabled={submitting || !guest.name || !guest.email || !guest.phone}
                    onClick={submitBooking}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Reserve · {formatMoney(price)}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-ink-muted/70">
                    Sandbox mode — no real charge will be made.
                  </p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One row per bookable start time: the time, what it costs, and how much of the
 * club is still free. Expanding a row reveals the courts, so choosing a
 * specific court is still one tap away for anyone who cares — but nobody has to
 * scan a 10x30 matrix to find out whether 19:00 is available.
 */
function TimeList({
  period,
  availability,
  duration,
  selectedTime,
  selectedCourt,
  priceFor,
  isPeak,
  onPickTime,
  onPickCourt,
}: {
  period: PeriodId;
  availability: Map<string, CourtRow[]>;
  duration: 60 | 90;
  selectedTime: string | null;
  selectedCourt: number | null;
  priceFor: (time: string, mins: 60 | 90) => number;
  isPeak: (time: string) => boolean;
  onPickTime: (time: string) => void;
  onPickCourt: (courtId: number) => void;
}) {
  const bounds = PERIODS.find((p) => p.id === period)!;
  const times = Array.from(availability.keys()).filter((t) => {
    const m = toMinutes(t);
    return m >= bounds.from && m < bounds.to;
  });

  if (times.length === 0) {
    return (
      <p className="mt-5 rounded-court border border-line bg-surface-base px-5 py-8 text-center text-sm text-ink-muted">
        Nothing left this {bounds.label.toLowerCase()} — try another part of the day, or
        pick tomorrow above.
      </p>
    );
  }

  return (
    <ul className="mt-5 divide-y divide-line overflow-hidden rounded-court border border-line bg-surface-base">
      {times.map((time) => {
        const free = availability.get(time) ?? [];
        const soldOut = free.length === 0;
        const open = selectedTime === time;
        const peak = isPeak(time);

        return (
          <li key={time}>
            <button
              disabled={soldOut}
              aria-expanded={open}
              onClick={() => onPickTime(time)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:gap-5 sm:px-5",
                soldOut ? "cursor-not-allowed opacity-50" : "hover:bg-surface-muted",
                open && "bg-surface-muted"
              )}
            >
              <span className="w-14 shrink-0 font-heading text-lg font-bold tabular-nums text-ink">
                {time}
              </span>

              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-heading text-sm font-bold text-ink">
                  {formatMoney(priceFor(time, duration))}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    peak ? "bg-peak/15 text-peak" : "bg-brand-accent/10 text-brand-accent"
                  )}
                >
                  {peak ? "Peak" : "Off-peak"}
                </span>
              </span>

              <span
                className={cn(
                  "shrink-0 text-xs font-medium sm:text-sm",
                  soldOut ? "text-ink-muted" : free.length <= 2 ? "text-peak" : "text-ink-muted"
                )}
              >
                {soldOut
                  ? "Fully booked"
                  : free.length <= 2
                  ? `Only ${free.length} left`
                  : `${free.length} of ${COURTS.length} free`}
              </span>

              {!soldOut && (
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-ink-muted transition-transform",
                    open && "rotate-180"
                  )}
                />
              )}
            </button>

            {open && !soldOut && (
              <div className="border-t border-line bg-surface-muted px-4 py-4 sm:px-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Choose a court
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {free.map((court) => {
                    const chosen = selectedCourt === court.id;
                    return (
                      <button
                        key={court.id}
                        onClick={() => onPickCourt(court.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-court border px-3.5 py-2 text-sm font-semibold transition-colors",
                          chosen
                            ? "border-brand bg-brand text-white"
                            : "border-line bg-surface-base text-ink hover:border-brand/50"
                        )}
                      >
                        {court.name}
                        {court.indoor && (
                          <span
                            className={cn(
                              "flex items-center gap-1 text-[10px] font-medium uppercase",
                              chosen ? "text-white/75" : "text-ink-muted"
                            )}
                          >
                            <Home className="h-3 w-3" /> Indoor
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}


function parseRange(pgRange: string): [Date, Date] {
  // Postgres tstzrange comes back like: ["2026-09-05 18:00:00+00","2026-09-05 19:00:00+00")
  const match = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
  if (!match) return [new Date(0), new Date(0)];
  return [new Date(match[1]), new Date(match[2])];
}

function SuccessPanel({
  bookingCode,
  email,
  washAdded,
  washMissed,
  emailSent,
}: {
  bookingCode: string;
  email: string;
  washAdded: boolean;
  washMissed: boolean;
  emailSent: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/10">
        <Check className="h-8 w-8 text-brand-accent" />
      </div>
      <h1 className="mt-6 font-heading text-2xl font-extrabold text-ink">Booking confirmed</h1>
      {/*
        This used to promise the email unconditionally. With no RESEND_API_KEY
        nothing is sent, so the customer was told to check an inbox that would
        stay empty — and the booking code on this screen is the only copy they
        have. Say which of the two actually happened.
      */}
      <p className="mt-2 text-ink-muted">
        Code <span className="font-mono text-brand">{bookingCode}</span>
        {emailSent ? (
          <> — a confirmation with your QR check-in code was sent to {email}.</>
        ) : (
          <> — write this down, it is what you check in with.</>
        )}
      </p>
      <p className="mt-3 rounded-court bg-surface-muted px-4 py-2.5 text-sm text-ink-muted">
        Pay at the club when you arrive.
      </p>
      {/* This screen is the only copy of the code for a guest who isn't signed
          in, and it disappears the moment they close the tab. Tell them how to
          get it back before they need to. */}
      <p className="mt-3 text-xs text-ink-muted">
        Lost it later?{" "}
        <a href="/find" className="font-semibold text-brand">
          Find your booking
        </a>{" "}
        with this code and your email.
      </p>
      {washAdded && (
        <p className="mt-4 flex items-center gap-2 rounded-court border border-line bg-brand-accent/5 px-4 py-2.5 text-sm text-ink">
          <Droplets className="h-4 w-4 text-brand-accent" />
          Your car wash is booked too — drop your keys at the bay before you head to the court.
        </p>
      )}
      {washMissed && (
        <p className="mt-4 flex items-center gap-2 rounded-court border border-peak/40 bg-peak/10 px-4 py-2.5 text-sm text-ink">
          <AlertCircle className="h-4 w-4 shrink-0 text-peak" />
          Your court is booked, but the wash bay was taken while you were checking
          out — nothing was charged for it. Ask at the desk when you arrive.
        </p>
      )}
    </div>
  );
}

/**
 * The cross-sell panel, driven entirely by the recommendation engine.
 *
 * Only a wash that actually lines up with the match may be added here. A slot
 * three hours after the customer has driven home is not an add-on, it is a
 * separate errand — offering it as a tick-box is how someone ends up paying for
 * a wash they cannot collect. When nothing fits, the panel says so plainly
 * rather than going quiet.
 */
function WashCrossSell({
  loading,
  result,
  chosen,
  onChoose,
}: {
  loading: boolean;
  result: WashRecommendationResult | null;
  chosen: WashSuggestion | null;
  onChoose: (v: WashSuggestion | null) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking car wash availability…
      </div>
    );
  }

  const all = result?.perService ?? [];
  const bookable = all.filter((o) => o.tier !== "court_only");
  const nearest = all.find((o) => o.tier === "court_only");

  if (all.length === 0) {
    return (
      <div className="rounded-court border border-line bg-surface-muted p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Droplets className="h-4 w-4 text-ink-muted" /> Car wash is fully booked today
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Every bay is taken for the rest of the day, so a wash can&apos;t be added to
          this booking. Your court is unaffected.
        </p>
      </div>
    );
  }

  if (bookable.length === 0) {
    return (
      <div className="rounded-court border border-line bg-surface-muted p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Droplets className="h-4 w-4 text-ink-muted" /> No wash bay is free during your
          match
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          All four bays are busy while you&apos;re playing, so a wash can&apos;t be added
          to this booking.
        </p>
        {nearest && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
            <Clock className="h-3.5 w-3.5" />
            Nearest free slot: Bay {nearest.bayId}, {nearest.service.label},{" "}
            {format(nearest.start, "HH:mm")}–{format(nearest.end, "HH:mm")}
          </p>
        )}
        <a href="/car-wash" className="mt-2 inline-block text-xs font-semibold text-brand">
          Book a wash separately →
        </a>
      </div>
    );
  }

  const notFitting = all.filter((o) => o.tier === "court_only");

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <Droplets className="h-4 w-4 text-brand-accent" />
        Wash your car while you play?
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Drop your keys at the bay — these are the washes that fit around your match.
      </p>

      <div className="mt-3 space-y-2">
        {bookable.map((option) => {
          const picked = chosen?.service.id === option.service.id;
          return (
            <label
              key={option.service.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-court border p-3 transition-colors",
                picked ? "border-brand bg-brand-accent/5" : "border-line bg-surface-muted"
              )}
            >
              <input
                type="radio"
                name="wash-service"
                checked={picked}
                onChange={() => onChoose(option)}
                className="mt-0.5 h-4 w-4 accent-[#0066CC]"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {option.service.label}
                  <span className="text-ink-muted">{formatMoney(option.service.priceCents)}</span>
                  {option.tier === "perfect_fit" && (
                    <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-semibold text-brand-accent">
                      Fits your match
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                  <Clock className="h-3.5 w-3.5" />
                  Bay {option.bayId} &middot; {format(option.start, "HH:mm")}–
                  {format(option.end, "HH:mm")} &middot; {option.service.durationMinutes} min
                </p>
                {/* The engine's own words for why this slot is what it is —
                    "ready 10 min before you finish" is worth more than a badge. */}
                <p className="mt-0.5 text-xs font-medium text-brand-accent">{option.note}</p>
              </div>
            </label>
          );
        })}

        {/* A service whose only free bay falls outside the match still gets
            named, so "where's the full detail?" has an answer on the page. */}
        {notFitting.length > 0 && (
          <p className="px-1 text-[11px] text-ink-muted">
            {notFitting.map((o) => o.service.label).join(", ")}{" "}
            {notFitting.length === 1 ? "has" : "have"} no bay free during your match —
            book separately if you want one.
          </p>
        )}

        <button
          type="button"
          onClick={() => onChoose(null)}
          className={cn(
            "w-full rounded-court border p-3 text-left text-sm transition-colors",
            chosen === null
              ? "border-brand bg-brand-accent/5 font-medium text-ink"
              : "border-line text-ink-muted hover:border-ink-muted/40"
          )}
        >
          No wash this time
        </button>
      </div>
    </div>
  );
}
