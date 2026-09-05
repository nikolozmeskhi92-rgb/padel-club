"use client";

import { useState } from "react";
import { addDays, format } from "date-fns";
import { Loader2, Check, Droplets, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMoney } from "@/lib/pricing";

const BAYS = [1, 2, 3, 4];
const SERVICES = [
  { id: "quick_wash", label: "Quick Wash", duration: 30, price: 800, icon: Droplets },
  { id: "full_detail", label: "Full Detail", duration: 60, price: 1500, icon: Sparkles },
  { id: "express_rinse", label: "Express Rinse", duration: 30, price: 1200, icon: Zap },
] as const;

function buildSlots(open = 7, close = 22) {
  const slots: string[] = [];
  for (let h = open; h < close; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}
const SLOTS = buildSlots();

export function CarWashBookingFlow() {
  const [service, setService] = useState<(typeof SERVICES)[number]>(SERVICES[0]);
  const [bay, setBay] = useState<number | null>(null);
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState<string | null>(null);
  const [guest, setGuest] = useState({ name: "", email: "" });
  const [paymentMethod, setPaymentMethod] = useState<"bog" | "tbc" | "paypal">("bog");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const next7Days = Array.from({ length: 7 }, (_, i) => addDays(new Date(), i));

  async function submit() {
    if (!bay || !time) return;
    setSubmitting(true);
    setError(null);
    const [h, m] = time.split(":").map(Number);
    const start = new Date(date);
    start.setHours(h, m, 0, 0);

    try {
      const res = await fetch("/api/car-wash-bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bayId: bay,
          startTime: start.toISOString(),
          service: service.id,
          durationMinutes: service.duration,
          guestName: guest.name,
          guestEmail: guest.email,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === "SLOT_TAKEN" ? "That bay just got booked — try another slot." : "Something went wrong.");
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
              onClick={() => setService(s)}
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
              format(d, "yyyy-MM-dd") === format(date, "yyyy-MM-dd")
                ? "border-brand bg-brand/5 text-brand"
                : "border-line text-ink-muted"
            )}
          >
            <span className="text-xs">{format(d, "EEE")}</span>
            <span className="text-lg font-bold">{format(d, "d")}</span>
          </button>
        ))}
      </div>

      {/* Bay */}
      <p className="mt-8 mb-3 text-sm font-semibold text-ink-muted">Choose a bay</p>
      <div className="flex gap-3">
        {BAYS.map((b) => (
          <button
            key={b}
            onClick={() => setBay(b)}
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-court border text-sm font-semibold",
              bay === b ? "border-brand bg-brand/5 text-brand" : "border-line text-ink-muted"
            )}
          >
            Bay {b}
          </button>
        ))}
      </div>

      {/* Time */}
      <p className="mt-8 mb-3 text-sm font-semibold text-ink-muted">Choose a time</p>
      <div className="flex flex-wrap gap-2">
        {SLOTS.map((t) => (
          <button
            key={t}
            onClick={() => setTime(t)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-medium",
              time === t ? "border-brand bg-brand text-white" : "border-line text-ink-muted"
            )}
          >
            {t}
          </button>
        ))}
      </div>

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
            <div className="flex gap-2">
              {(["bog", "tbc", "paypal"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={cn(
                    "flex-1 rounded-court border py-2.5 text-xs font-semibold uppercase",
                    paymentMethod === m ? "border-brand bg-brand/5 text-brand" : "border-line text-ink-muted"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <button
            disabled={submitting || !guest.name || !guest.email}
            onClick={submit}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirm & pay {formatMoney(service.price)}
          </button>
        </div>
      )}
    </div>
  );
}
