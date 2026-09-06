"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Search, AlertCircle, Check } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { CLUB_TIMEZONE } from "@/lib/time/club";

type Found = {
  kind: "court" | "car_wash";
  resourceName: string;
  bookingCode: string;
  guestName: string;
  startIso: string | null;
  endIso: string | null;
  status: string;
  paymentStatus: string;
  priceCents: number;
  cancelToken: string | null;
};

const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
});

export function FindBooking() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const res = await fetch("/api/find-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Too many attempts. Wait a few minutes, or call the club and we'll find it for you."
            : // Deliberately one message for every kind of miss — naming which
              // half was wrong would confirm the other half to a stranger.
              "We couldn't find a booking with that code and email. Check both, or call the club."
        );
        return;
      }
      setFound(data.booking);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink">
        Find your booking
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Lost the confirmation email? Enter the booking code and the email you booked
        with, and we&apos;ll bring it back.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          placeholder="Booking code (e.g. 4C26A6F3)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 font-mono text-sm uppercase tracking-wider text-ink outline-none focus:border-brand"
        />
        <input
          type="email"
          placeholder="Email you booked with"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
        />
        <button
          disabled={busy || !email.trim() || !code.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Find it
        </button>
      </form>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-court border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {found && (
        <div className="mt-6 rounded-court border border-line bg-surface-base p-5 shadow-card">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-accent">
            <Check className="h-4 w-4" /> Found it
          </p>
          <p className="mt-3 font-heading text-lg font-bold text-ink">{found.resourceName}</p>
          <p className="mt-1 text-sm text-ink">
            {found.startIso ? when.format(new Date(found.startIso)) : "—"}
            {found.endIso && <> – {time.format(new Date(found.endIso))}</>}
          </p>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Booked by</dt>
              <dd className="text-ink">{found.guestName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Code</dt>
              <dd className="font-mono text-brand">{found.bookingCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Price</dt>
              <dd className="text-ink">{formatMoney(found.priceCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Status</dt>
              <dd className="capitalize text-ink">
                {found.status === "cancelled" ? "cancelled" : found.paymentStatus}
              </dd>
            </div>
          </dl>

          {found.cancelToken ? (
            <Link
              href={`/cancel/${found.cancelToken}`}
              className="mt-5 block rounded-court border border-line px-4 py-2.5 text-center text-sm font-semibold text-ink-muted hover:border-red-300 hover:text-red-600"
            >
              Cancel this booking
            </Link>
          ) : (
            <p className="mt-5 rounded-court bg-surface-muted px-4 py-2.5 text-center text-sm text-ink-muted">
              This booking has been cancelled.
            </p>
          )}

          <p className="mt-3 text-center text-xs text-ink-muted">
            Write the code down — it&apos;s what you check in with.
          </p>
        </div>
      )}

      <p className="mt-8 text-center text-xs text-ink-muted">
        Booked while signed in? Your bookings are all in{" "}
        <Link href="/account" className="font-semibold text-brand">
          your account
        </Link>
        .
      </p>
    </div>
  );
}
