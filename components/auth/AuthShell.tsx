"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "@/lib/auth/password";

/**
 * The frame every auth page sits in.
 *
 * Four pages — sign in, create account, forgot password, set a new password —
 * that a person moves between while already unsure whether they have an
 * account. If each one has its own width, heading size and error style, the
 * journey reads as four different websites and the trust that a password form
 * needs is exactly the thing that leaks away. One shell, one shape.
 */
export function AuthShell({
  title,
  subtitle,
  error,
  notice,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  notice?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-7 py-12 sm:px-8">
      <h1 className="font-heading text-2xl font-extrabold text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}

      {/*
        role="alert" so a screen reader is told at the moment it appears. These
        two are the only things on the page that change without the person
        doing anything, and both matter.
      */}
      {error && (
        <p
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-court border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {notice && !error && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-court border border-brand/25 bg-brand/5 px-4 py-3 text-sm text-ink"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <span>{notice}</span>
        </p>
      )}

      <div className="mt-7">{children}</div>

      {footer && <div className="mt-7 text-center text-sm text-ink-muted">{footer}</div>}
    </div>
  );
}

export function AuthField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="w-full rounded-court border border-line bg-surface-base px-4 py-3 text-base text-ink outline-none transition-colors focus:border-brand sm:text-sm"
      />
      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * A password field with a reveal toggle and, optionally, a strength meter.
 *
 * The eye is not decoration. Typing a password blind on a phone keyboard is
 * where most "wrong password" attempts actually come from, and hiding it by
 * default while letting people look is the compromise every bank has settled
 * on. `autoComplete` is passed through deliberately: "new-password" tells a
 * password manager to offer to generate one, "current-password" tells it to
 * fill. Getting those two wrong is why managers sometimes do nothing at all.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  showMeter = false,
  hint,
  ...props
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "new-password" | "current-password";
  showMeter?: boolean;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const strength = passwordStrength(value);

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? MIN_PASSWORD_LENGTH : undefined}
          {...props}
          className="w-full rounded-court border border-line bg-surface-base py-3 pl-4 pr-12 text-base text-ink outline-none transition-colors focus:border-brand sm:text-sm"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-court text-ink-muted active:bg-surface-muted"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {showMeter && value.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex h-1 flex-1 gap-1" aria-hidden="true">
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={cn(
                  "h-full flex-1 rounded-full",
                  strength.score >= step
                    ? step === 1
                      ? "bg-peak"
                      : step === 2
                        ? "bg-peak"
                        : "bg-emerald-500"
                    : "bg-line"
                )}
              />
            ))}
          </div>
          <span className="w-16 text-right text-[11px] text-ink-muted">{strength.label}</span>
        </div>
      )}

      {hint && <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function SubmitButton({
  loading,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3.5 text-sm font-semibold text-white transition-colors active:bg-brand-hover disabled:opacity-50"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-brand underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}
