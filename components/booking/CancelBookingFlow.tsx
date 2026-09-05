"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertCircle, CalendarX, Check, Loader2, Ticket } from "lucide-react";
import { formatMoney } from "@/lib/currency";

type Preview = {
  kind: "court" | "car_wash";
  resourceName: string;
  bookingCode: string;
  guestName: string | null;
  startTime: string;
  status: string;
  priceCents: number;
  paymentStatus: string;
  outcome: "refunded" | "credited" | "released";
  hoursUntil: number;
  freeHours: number;
  creditPct: number;
};

type Result = {
  outcome: string;
  refundCents: number;
  creditCents: number;
  creditCode: string | null;
  creditExpiresAt: string | null;
  resourceName: string;
};

const ERROR_COPY: Record<string, string> = {
  NOT_FOUND: "This cancellation link isn't valid. It may have already been used.",
  ALREADY_CANCELLED: "This booking has already been cancelled.",
  ALREADY_STARTED: "This booking has already started, so it can't be cancelled online. Please call the club.",
  NOT_CANCELLABLE: "This booking can no longer be cancelled. Please call the club.",
  RATE_LIMITED: "Too many attempts. Please wait a minute and try again.",
  INVALID_TOKEN: "This cancellation link isn't valid.",
};

export function CancelBookingFlow({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/cancel?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "NOT_FOUND");
        return d as Preview;
      })
      .then(setPreview)
      .catch((e) => setError(ERROR_COPY[e.message] ?? ERROR_COPY.NOT_FOUND))
      .finally(() => setLoading(false));
  }, [token]);

  async function confirmCancel() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(ERROR_COPY[data.error] ?? "Something went wrong. Please call the club.");
        return;
      }
      setResult(data as Result);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand" />
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell>
        <Check className="mx-auto h-12 w-12 rounded-full bg-brand-accent/10 p-2.5 text-brand-accent" />
        <h1 className="mt-5 font-heading text-2xl font-extrabold text-ink">Booking cancelled</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {result.resourceName} is back on sale. We&apos;ve emailed you a copy of this.
        </p>

        {result.refundCents > 0 && (
          <div className="mt-6 rounded-court border border-line bg-surface-base p-5 text-left">
            <p className="text-sm font-semibold text-ink">
              {formatMoney(result.refundCents)} refunded
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Back on your original payment method. Card refunds usually settle within
              5–10 business days.
            </p>
          </div>
        )}

        {result.creditCents > 0 && result.creditCode && (
          <div className="mt-6 rounded-court border border-brand/20 bg-brand/5 p-5 text-left">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-brand" />
              <p className="text-sm font-semibold text-ink">
                {formatMoney(result.creditCents)} in club credit
              </p>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              You cancelled inside the free-cancellation window, so the value stays with
              you as credit rather than a cash refund. Use this code at checkout:
            </p>
            <p className="mt-3 select-all rounded-court border border-brand/30 bg-white px-4 py-2.5 text-center font-mono text-lg font-bold tracking-widest text-ink">
              {result.creditCode}
            </p>
            {result.creditExpiresAt && (
              <p className="mt-2 text-center text-xs text-ink-muted/80">
                Valid until {format(new Date(result.creditExpiresAt), "d MMMM yyyy")}
              </p>
            )}
          </div>
        )}

        <a
          href="/book"
          className="mt-8 inline-block rounded-court bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Book another court
        </a>
      </Shell>
    );
  }

  if (error && !preview) {
    return (
      <Shell>
        <AlertCircle className="mx-auto h-10 w-10 text-red-400" />
        <h1 className="mt-4 font-heading text-xl font-extrabold text-ink">
          We can&apos;t open this booking
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{error}</p>
      </Shell>
    );
  }

  if (!preview) return null;

  if (preview.status === "cancelled") {
    return (
      <Shell>
        <CalendarX className="mx-auto h-10 w-10 text-ink-muted/50" />
        <h1 className="mt-4 font-heading text-xl font-extrabold text-ink">
          Already cancelled
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {preview.resourceName} on {format(new Date(preview.startTime), "EEE d MMM, HH:mm")} was
          cancelled earlier.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <CalendarX className="mx-auto h-10 w-10 text-ink-muted/60" />
      <h1 className="mt-4 font-heading text-2xl font-extrabold text-ink">Cancel this booking?</h1>

      <div className="mt-6 rounded-court border border-line bg-surface-base p-5 text-left">
        <Row label="Booking" value={preview.resourceName} />
        <Row
          label="When"
          value={format(new Date(preview.startTime), "EEEE d MMMM, HH:mm")}
        />
        <Row label="Reference" value={preview.bookingCode} />
        <Row label="Paid" value={formatMoney(preview.priceCents)} />
      </div>

      {/* Say plainly what they get back before they click, not after. */}
      <div
        className={
          preview.outcome === "refunded"
            ? "mt-4 rounded-court border border-line bg-surface-muted p-4 text-left text-sm text-ink-muted"
            : "mt-4 rounded-court border border-brand/20 bg-brand/5 p-4 text-left text-sm text-ink-muted"
        }
      >
        {preview.outcome === "refunded" && (
          <>
            You&apos;re cancelling more than {preview.freeHours} hours ahead, so you&apos;ll get
            a full refund of <strong className="text-ink">{formatMoney(preview.priceCents)}</strong>{" "}
            to your original payment method.
          </>
        )}
        {preview.outcome === "credited" && (
          <>
            This is inside the {preview.freeHours}-hour free-cancellation window
            {preview.hoursUntil > 0 && ` (${Math.max(0, Math.round(preview.hoursUntil))}h to go)`}, so
            instead of a cash refund you&apos;ll receive{" "}
            <strong className="text-ink">
              {formatMoney(Math.round((preview.priceCents * preview.creditPct) / 100))}
            </strong>{" "}
            as club credit to use on a future booking.
          </>
        )}
        {preview.outcome === "released" && (
          <>
            This booking hasn&apos;t been paid for, so cancelling just releases the slot —
            there&apos;s nothing to refund.
          </>
        )}
      </div>

      {error && (
        <p className="mt-4 flex items-center justify-center gap-2 text-sm text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <button
        onClick={confirmCancel}
        disabled={submitting}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-court bg-red-500 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        Yes, cancel this booking
      </button>
      <a
        href="/"
        className="mt-3 inline-block text-sm font-medium text-ink-muted hover:text-ink"
      >
        Keep my booking
      </a>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-12 text-center">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}
