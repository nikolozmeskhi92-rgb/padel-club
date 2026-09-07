"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import {
  AuthField,
  AuthLink,
  AuthShell,
  PasswordField,
  SubmitButton,
} from "@/components/auth/AuthShell";

export default function SignUpPage() {
  return (
    <Suspense fallback={<AuthShell title="Create an account">{null}</AuthShell>}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const params = useSearchParams();
  const redirect = params.get("redirect");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Checked here as well as in the field so the message appears once, at the
    // moment of submitting, rather than nagging while someone is still typing.
    const verdict = checkPassword(password, email);
    if (!verdict.ok) {
      setError(verdict.message);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const next = redirect ?? "/account";
    const { error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Where the link in the email lands. /auth/callback is what turns the
        // token into a session cookie; without this the confirmation would
        // bounce to Supabase's own domain and the customer would end up
        // confirmed but not signed in, on a page that is not ours.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // Read by the handle_new_user trigger, which fills profiles.full_name.
        data: { full_name: name.trim() || undefined },
      },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    /*
      The same screen whether or not that address already has an account.

      Supabase deliberately returns a success-shaped answer for an address that
      is already registered, and this page deliberately does not look any
      closer. "That email is already taken" is a free account-existence oracle:
      anyone can paste a list of addresses in and learn which of them belong to
      customers here. The wording below covers both cases honestly without
      confirming either.
    */
    setSentTo(email.trim());
  }

  if (sentTo) return <CheckYourInbox email={sentTo} redirect={redirect} />;

  return (
    <AuthShell
      title="Create an account"
      subtitle="Keep your bookings together, and skip typing your details every time."
      error={error}
      footer={
        <>
          Already have one? <AuthLink href={redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login"}>Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <AuthField
          label="Full name"
          type="text"
          autoComplete="name"
          placeholder="Nika Meskhi"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <AuthField
          label="Email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          showMeter
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words beat one clever word.`}
        />
        <PasswordField
          label="Repeat password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />

        <SubmitButton loading={loading}>Create account</SubmitButton>

        <p className="text-center text-[11px] leading-relaxed text-ink-muted">
          By creating an account you agree to our{" "}
          <AuthLink href="/terms">terms</AuthLink> and{" "}
          <AuthLink href="/privacy">privacy policy</AuthLink>.
        </p>
      </form>
    </AuthShell>
  );
}

/**
 * The screen after signing up.
 *
 * It does one job: stop the person waiting on a page that looks like it failed.
 * It names the address the mail went to — a typo in the domain is the single
 * most common reason "the email never arrived" — mentions the spam folder,
 * because it is where these land, and offers to send it again behind a cooldown
 * so the button cannot be leaned on.
 */
function CheckYourInbox({ email, redirect }: { email: string; redirect: string | null }) {
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [cooldown]);

  async function resend() {
    setError(null);
    const supabase = createClient();
    const next = redirect ?? "/account";
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setResent(true);
    setCooldown(60);
  }

  return (
    <AuthShell
      title="Check your email"
      error={error}
      notice={resent ? "Sent again." : null}
      footer={
        <>
          Wrong address? <AuthLink href="/signup">Start again</AuthLink>
        </>
      }
    >
      <div className="rounded-court border border-line bg-surface-base p-5 text-sm text-ink-muted">
        <MailCheck className="h-6 w-6 text-brand" />
        <p className="mt-3">
          If <span className="font-semibold text-ink">{email}</span> is new here, a confirmation
          link is on its way. Open it and you'll be signed in.
        </p>
        <p className="mt-3">
          If that address already has an account, nothing new was sent —{" "}
          <AuthLink href="/login">sign in</AuthLink> instead, or{" "}
          <AuthLink href="/forgot-password">reset the password</AuthLink>.
        </p>
        <p className="mt-3 text-xs">
          Nothing after a minute or two? Look in spam — confirmation emails from a new sender
          often land there.
        </p>
      </div>

      <button
        type="button"
        onClick={resend}
        disabled={cooldown > 0}
        className="mt-4 w-full rounded-court border border-line py-3 text-sm font-semibold text-ink transition-colors active:bg-surface-muted disabled:opacity-50"
      >
        {cooldown > 0 ? `Send again in ${cooldown}s` : "Send the email again"}
      </button>
    </AuthShell>
  );
}
