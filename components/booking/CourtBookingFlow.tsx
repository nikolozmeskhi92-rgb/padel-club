"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check, AlertCircle, Droplets, Clock, RefreshCw } from "lucide-react";
import { isPeakHour, formatMoney } from "@/lib/pricing";
import { cn } from "@/lib/utils/cn";
import type { WashRecommendationResult, WashSuggestion } from "@/lib/carwash/suggest";

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

const OPEN_HOUR = 8;
const CLOSE_HOUR = 23;

function buildTimeSlots() {
  const slots: string[] = [];
  for (let h = OPEN_HOUR; h < CLOSE_HOUR; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}
const TIME_SLOTS = buildTimeSlots();

type Step = "slot" | "extras" | "checkout" | "success";

export function CourtBookingFlow() {
  const [date, setDate] = useState(new Date());
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<60 | 90>(60);
  const [booked, setBooked] = useState<BookedSlot[]>([]);
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [gridError, setGridError] = useState(false);
  const [gridReloadKey, setGridReloadKey] = useState(0);
  const [step, setStep] = useState<Step>("slot");
  const [equipment, setEquipment] = useState<Record<number, number>>({});
  const [guest, setGuest] = useState({ name: "", email: "", phone: "" });
  const [paymentMethod, setPaymentMethod] = useState<"tbc" | "bog" | "paypal">("bog");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingCode, setBookingCode] = useState<string | null>(null);

  // --- Car wash cross-sell ---
  const [washResult, setWashResult] = useState<WashRecommendationResult | null>(null);
  const [loadingWash, setLoadingWash] = useState(false);
  const [wantWash, setWantWash] = useState(false);
  const [washAdded, setWashAdded] = useState(false); // reflected in the success screen

  const next7Days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(new Date(), i)), []);

  // A failed availability fetch used to fall back to an empty `booked` list,
  // which renders every slot as free — the customer picks an already-taken
  // court and only finds out at checkout. Failing loudly is the safer default.
  useEffect(() => {
    let cancelled = false;
    setLoadingGrid(true);
    setGridError(false);
    setSelectedCourt(null);
    setSelectedTime(null);

    fetch(`/api/bookings?date=${format(date, "yyyy-MM-dd")}`)
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
  }, [date, gridReloadKey]);

  function isSlotTaken(courtId: number, time: string) {
    const [h, m] = time.split(":").map(Number);
    const slotStart = new Date(date);
    slotStart.setHours(h, m, 0, 0);
    return booked.some((b) => {
      if (b.court_id !== courtId) return false;
      const [rangeStart, rangeEnd] = parseRange(b.slot);
      return slotStart >= rangeStart && slotStart < rangeEnd;
    });
  }

  function slotStartDate(time: string) {
    const [h, m] = time.split(":").map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d;
  }

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
        });
        // Default the toggle on for a genuinely good match, off otherwise —
        // the customer shouldn't have to opt out of something that barely fits.
        setWantWash(raw.tier === "perfect_fit");
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
    const d = slotStartDate(selectedTime);
    const peak = isPeakHour(d);
    // mirrors the server pricing_rules seed data
    const base =
      d.getDay() === 0 || d.getDay() === 6
        ? duration === 60 ? 4500 : 6400
        : peak
        ? duration === 60 ? 4000 : 5800
        : duration === 60 ? 2500 : 3600;
    const equipTotal = Object.entries(equipment).reduce(
      (sum, [id, qty]) => sum + (EQUIPMENT.find((e) => e.id === Number(id))?.price_cents ?? 0) * qty,
      0
    );
    const washTotal = wantWash && washResult?.best ? washResult.best.service.priceCents : 0;
    return base + equipTotal + washTotal;
  }, [selectedTime, duration, equipment, date, wantWash, washResult]);

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
        } else {
          setError("Something went wrong. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      setBookingCode(data.booking.booking_code);

      // Cross-sell: if the customer opted into the recommended wash slot,
      // book it now, linked to the court booking that just succeeded.
      // This never blocks the court confirmation — if the wash bay got
      // taken in the last few seconds, the court booking still stands.
      if (wantWash && washResult?.best) {
        try {
          const washRes = await fetch("/api/car-wash-bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bayId: washResult.best.bayId,
              startTime: washResult.best.start.toISOString(),
              service: washResult.best.service.id,
              durationMinutes: washResult.best.service.durationMinutes,
              guestName: guest.name,
              guestEmail: guest.email,
              paymentMethod,
              linkedCourtBookingId: data.booking.id,
            }),
          });
          if (washRes.ok) setWashAdded(true);
        } catch {
          // Court booking already succeeded — silently skip the wash add-on rather than alarming the customer.
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
    return <SuccessPanel bookingCode={bookingCode} email={guest.email} washAdded={washAdded} />;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink md:text-4xl">Book a court</h1>
      <p className="mt-2 text-ink-muted">Pick a date, then tap an open slot on the grid.</p>

      {/* Date strip */}
      <div className="mt-8 flex gap-2 overflow-x-auto pb-2">
        {next7Days.map((d) => (
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

      {/* Availability could not be loaded — show nothing rather than a grid of
          slots we cannot vouch for. */}
      {gridError && !loadingGrid && (
        <div className="mt-8 rounded-court border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
          <p className="mt-3 text-sm font-semibold text-ink">
            We couldn&apos;t load live availability
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Rather than show you slots that might already be taken, we&apos;ve hidden the grid.
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

      {/* Court x Time grid */}
      <div
        className={cn(
          "relative mt-8 overflow-x-auto rounded-court border border-line",
          gridError && !loadingGrid && "hidden"
        )}
      >
        {loadingGrid && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        )}
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] bg-surface-base p-3 text-left text-xs font-semibold text-ink-muted/80">
                Court
              </th>
              {TIME_SLOTS.map((t) => (
                <th key={t} className="min-w-[52px] p-1 text-center text-[10px] font-medium text-ink-muted/70">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COURTS.map((court) => (
              <tr key={court.id} className="border-t border-line">
                <td className="sticky left-0 z-[1] bg-surface-base p-3 text-xs font-bold uppercase tracking-tight text-ink">
                  {court.name}
                  {court.indoor && <span className="ml-1 text-[10px] text-ink-muted/70">(indoor)</span>}
                </td>
                {TIME_SLOTS.map((t) => {
                  const taken = isSlotTaken(court.id, t);
                  const isSelected = selectedCourt === court.id && selectedTime === t;
                  const peak = isPeakHour(slotStartDate(t));
                  return (
                    <td key={t} className="p-1 text-center">
                      <button
                        disabled={taken}
                        onClick={() => {
                          setSelectedCourt(court.id);
                          setSelectedTime(t);
                        }}
                        className={cn(
                          "h-7 w-11 rounded-md text-[10px] transition-colors",
                          taken && "cursor-not-allowed bg-line",
                          !taken && isSelected && "bg-brand",
                          !taken && !isSelected && peak && "bg-peak/15 hover:bg-peak/25",
                          !taken && !isSelected && !peak && "bg-brand-accent/10 hover:bg-brand-accent/20"
                        )}
                        aria-label={`${court.name} at ${t}${taken ? " (unavailable)" : ""}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className={cn(
          "mt-3 flex gap-5 text-xs text-ink-muted/80",
          gridError && !loadingGrid && "hidden"
        )}
      >
        <Legend swatch="bg-brand-accent/10" label="Off-peak" />
        <Legend swatch="bg-peak/15" label="Peak" />
        <Legend swatch="bg-line" label="Booked" />
      </div>

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
                      wantWash={wantWash}
                      onToggle={setWantWash}
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
                      onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                      className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
                    />
                    <input
                      placeholder="Phone"
                      value={guest.phone}
                      onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                      className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
                    />

                    <div className="flex gap-2 pt-2">
                      {(["bog", "tbc", "paypal"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setPaymentMethod(m)}
                          className={cn(
                            "flex-1 rounded-court border py-2.5 text-xs font-semibold uppercase",
                            paymentMethod === m
                              ? "border-brand bg-brand-accent/10 text-brand"
                              : "border-line text-ink-muted"
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
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
                    Confirm & pay {formatMoney(price)}
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

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-sm", swatch)} />
      {label}
    </div>
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
}: {
  bookingCode: string;
  email: string;
  washAdded: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/10">
        <Check className="h-8 w-8 text-brand-accent" />
      </div>
      <h1 className="mt-6 font-heading text-2xl font-extrabold text-ink">Booking confirmed</h1>
      <p className="mt-2 text-ink-muted">
        Code <span className="font-mono text-brand">{bookingCode}</span> — a confirmation with your QR
        check-in code was sent to {email}.
      </p>
      {washAdded && (
        <p className="mt-4 flex items-center gap-2 rounded-court border border-line bg-brand-accent/5 px-4 py-2.5 text-sm text-ink">
          <Droplets className="h-4 w-4 text-brand-accent" />
          Your car wash is booked too — drop your keys at the bay before you head to the court.
        </p>
      )}
    </div>
  );
}

/**
 * Renders the cross-sell panel driven entirely by the recommendation engine's
 * output. The copy is deliberately different per tier so the customer always
 * understands *why* they're seeing what they're seeing — a vague "car wash
 * available?" toggle would undersell (or oversell) what's actually possible.
 */
function WashCrossSell({
  loading,
  result,
  wantWash,
  onToggle,
}: {
  loading: boolean;
  result: WashRecommendationResult | null;
  wantWash: boolean;
  onToggle: (v: boolean) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking car wash availability…
      </div>
    );
  }

  if (!result || (!result.best && result.tier === "no_wash_today")) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Droplets className="h-4 w-4" /> Car wash is fully booked for the rest of today.
      </p>
    );
  }

  const { tier, best } = result;

  if (tier === "court_only" && best) {
    return (
      <div className="rounded-court border border-line bg-surface-muted p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Droplets className="h-4 w-4 text-ink-muted" /> Car wash isn't free during your match
        </p>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-muted">
          <Clock className="h-3.5 w-3.5" /> Nearest open slot: Bay {best.bayId}, {best.service.label},{" "}
          {format(best.start, "HH:mm")}–{format(best.end, "HH:mm")}
        </p>
        <a href="/car-wash" className="mt-2 inline-block text-xs font-semibold text-brand">
          Book it separately →
        </a>
      </div>
    );
  }

  if (best) {
    return (
      <label className="flex cursor-pointer items-start gap-3 rounded-court border border-line bg-surface-muted p-4">
        <input
          type="checkbox"
          checked={wantWash}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#0066CC]"
        />
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Droplets className="h-4 w-4 text-brand-accent" />
            Wash your car while you play?
            {tier === "perfect_fit" && (
              <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-semibold text-brand-accent">
                Recommended
              </span>
            )}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Bay {best.bayId} &middot; {best.service.label} &middot; {format(best.start, "HH:mm")}–
            {format(best.end, "HH:mm")} &middot; {formatMoney(best.service.priceCents)}
          </p>
          <p className="mt-1 text-xs font-medium text-brand-accent">{best.note}</p>
        </div>
      </label>
    );
  }

  return null;
}
