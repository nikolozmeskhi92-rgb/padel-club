"use client";

import { CreditCard, Landmark, Loader2, Wallet } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils/cn";

/**
 * How the customer says they want to pay.
 *
 * Only "club" settles anything today. Card and PayPal are drawn, labelled
 * "coming soon", and simulated — the club has no provider wired up, and a
 * button that looks like it takes money and does not is the single worst thing
 * these pages could do. An earlier version of this site had exactly that: TBC /
 * BOG / PayPal buttons that charged nothing while the booking was written
 * `unpaid` and the customer believed they had paid.
 *
 * Shared by the court flow and the car wash flow. The two pages are built
 * differently — one has a multi-step sheet, the other a single panel — but the
 * choice is the same choice, and a customer who is offered three methods on one
 * page and a different three on the other has been given a reason to wonder
 * which page is the real one.
 */
export type PayMethod = "card" | "paypal" | "club";

/**
 * The three ways to pay, in the order they are offered.
 *
 * Named in words rather than drawn as bank logos: TBC's and Bank of Georgia's
 * marks belong to them, and the club will be given the correct artwork as part
 * of the merchant agreement that makes these buttons real.
 *
 * "Pay at the club" is last but selected by default — last because the two
 * people look for first should be where they look, default because it is the
 * only one that takes a booking today.
 */
export const PAY_METHODS: {
  id: PayMethod;
  name: string;
  hint: string;
  icon: typeof CreditCard;
  comingSoon?: boolean;
}[] = [
  {
    id: "card",
    name: "Card — TBC or Bank of Georgia",
    hint: "Visa and Mastercard issued in Georgia",
    icon: CreditCard,
    comingSoon: true,
  },
  {
    id: "paypal",
    name: "PayPal",
    hint: "Useful if you are paying from abroad",
    icon: Wallet,
    comingSoon: true,
  },
  {
    id: "club",
    name: "Pay at the club",
    hint: "Cash or card terminal at reception",
    icon: Landmark,
  },
];

/** What a simulated method should say once it has finished pretending. */
export function simulationMessage(method: PayMethod): string {
  return method === "card"
    ? "TBC / BOG — simulation only, no card was charged. Choose “Pay at the club” to confirm."
    : "PayPal — simulation only, nothing was charged. Choose “Pay at the club” to confirm.";
}

/**
 * A radiogroup rather than three buttons: one thing is chosen out of three,
 * arrow keys should move between them, and a screen reader should say "2 of 3"
 * rather than reading three unrelated buttons.
 */
export function PaymentMethodPicker({
  value,
  onChange,
  disabled,
}: {
  value: PayMethod;
  onChange: (m: PayMethod) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="How you'd like to pay" className="space-y-2.5">
      {PAY_METHODS.map((m) => {
        const Icon = m.icon;
        const active = value === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(m.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-court border px-4 py-3 text-left transition-colors disabled:opacity-60",
              active
                ? "border-brand bg-brand/5 ring-1 ring-brand"
                : "border-line bg-surface-base active:bg-surface-muted"
            )}
          >
            <Icon className={cn("h-5 w-5 shrink-0", active ? "text-brand" : "text-ink-muted")} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-ink">{m.name}</span>
                {m.comingSoon && (
                  <span className="rounded-full bg-peak/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Coming soon
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted/90">{m.hint}</span>
            </span>
            {/*
              A filled dot, not a tick: a tick reads as "done", and nothing here
              is done until the button below is pressed.
            */}
            <span
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 rounded-full border-2",
                active ? "border-brand bg-brand" : "border-line"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/** The line under the button, which changes with the method. */
export function PaymentFootnote({ method }: { method: PayMethod }) {
  return (
    <p className="mt-2.5 text-center text-[11px] leading-relaxed text-ink-muted/80">
      {method === "club"
        ? "Nothing is charged now. We hold it for you and you settle it at reception."
        : "Online payment isn't live yet — this button runs a simulation and takes no money."}
    </p>
  );
}

/**
 * The message after a simulated payment.
 *
 * At the top of the screen, not the bottom: the bottom of an iPhone belongs to
 * Safari's collapsed toolbar, and a message that lands half under the browser's
 * own chrome is a message nobody reads. z-50 so it clears a modal at z-40,
 * since what it is reporting on happened inside one.
 */
export function PaymentToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="status"
          aria-live="polite"
          onClick={onDismiss}
          className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+1rem)] z-50 mx-auto max-w-md cursor-pointer rounded-court bg-ink px-4 py-3 text-sm leading-snug text-white shadow-[0_8px_28px_rgba(0,26,51,0.28)]"
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A standalone payment modal, for a page that has no sheet of its own.
 *
 * The court flow already has a multi-step sheet and puts the picker inside it;
 * the car wash is a single panel, so it gets this. Same shape as that sheet on
 * purpose — a grabber, a visible ✕, 85svh so a strip of the page behind stays
 * visible, Escape and the scrim to close, and the body padded well clear of the
 * bottom edge so the confirm button is not sitting in Safari's own tap band.
 */
export function PaymentModal({
  open,
  onClose,
  summary,
  totalLabel,
  method,
  onMethod,
  onConfirm,
  busy,
  error,
  confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  summary: { label: string; value: string }[];
  totalLabel: string;
  method: PayMethod;
  onMethod: (m: PayMethod) => void;
  onConfirm: () => void;
  busy?: boolean;
  error?: string | null;
  confirmLabel: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          /*
            No backdrop-blur. A backdrop-filter on a fixed layer composites
            separately from the layer that receives touches on iOS, and that is
            half of why a button under one can need two taps.
          */
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-title"
            /*
              Opacity only, no slide: the same AnimatePresence transform on a
              fixed overlay is what once left Safari hit-testing an action bar
              where it had animated from, costing the first tap.
            */
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85svh] w-full max-w-lg flex-col rounded-t-court border border-line bg-surface-base shadow-card sm:max-h-[85vh] sm:rounded-court"
          >
            <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden="true">
              <span className="h-1 w-9 rounded-full bg-line" />
            </div>

            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-2 sm:px-3">
              <span className="h-11 w-11 shrink-0" aria-hidden="true" />
              <h2
                id="pay-title"
                className="min-w-0 flex-1 truncate text-center font-heading text-base font-bold text-ink"
              >
                Payment
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 items-center justify-center rounded-court text-2xl leading-none text-ink-muted active:bg-surface-muted"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
              <dl className="rounded-court border border-line bg-surface-muted px-4 py-3 text-sm">
                {summary.map((row, i) => (
                  <div
                    key={row.label}
                    className={cn("flex items-baseline justify-between gap-3", i > 0 && "mt-1.5")}
                  >
                    <dt className="text-ink-muted">{row.label}</dt>
                    <dd className="text-right font-semibold text-ink">{row.value}</dd>
                  </div>
                ))}
                <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
                  <dt className="font-semibold text-ink">Total</dt>
                  <dd className="font-heading text-lg font-bold text-ink">{totalLabel}</dd>
                </div>
              </dl>

              <div className="mt-5">
                <PaymentMethodPicker value={method} onChange={onMethod} disabled={busy} />
              </div>

              {error && (
                <div className="mt-4 rounded-court border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {error}
                </div>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {confirmLabel}
              </button>

              <PaymentFootnote method={method} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
