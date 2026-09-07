"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import {
  AuthField,
  AuthLink,
  AuthShell,
  PasswordField,
  SubmitButton,
} from "@/components/auth/AuthShell";

// useSearchParams() opts a component out of static prerendering, so the form
// lives in its own component behind a Suspense boundary. Without it, `next build`
// fails on /login with a CSR-bailout prerender error.
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShell title="Sign in">{null}</AuthShell>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);

  // The callback route reports provider refusals back through ?error=, so a
  // declined consent screen says why instead of silently returning here.
  const [error, setError] = useState<string | null>(params.get("error"));

  const redirectTo = params.get("redirect");
  const withRedirect = (path: string) =>
    redirectTo ? `${path}?redirect=${encodeURIComponent(redirectTo)}` : path;

  async function signInWithGoogle() {
    setOauthLoading(true);
    setError(null);
    const supabase = createClient();
    // The browser goes to Google, Google returns to Supabase, and Supabase
    // forwards to /auth/callback — which is where the session cookie is
    // actually written. `next` is carried through that round trip.
    const callback = new URL("/auth/callback", window.location.origin);
    if (redirectTo) callback.searchParams.set("next", redirectTo);

    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });

    if (oauthError) {
      setOauthLoading(false);
      setError(`Could not start Google sign-in. ${oauthError.message}`);
    }
    // On success the browser navigates away; no need to clear the loading state.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUnconfirmed(false);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setLoading(false);
      /*
        One message for a wrong password and for an address that has no
        account. Telling them apart is convenient for the person who mistyped
        and just as convenient for someone working through a list of addresses
        to see which are customers here.

        An unconfirmed account is the exception, and has to be: that person did
        everything right, the account exists, and the only thing standing in the
        way is an email they have not opened. Saying "wrong password" there
        would send them round in circles for ever.
      */
      if (/confirm/i.test(signInError.message)) {
        setUnconfirmed(true);
        setError("This account hasn't been confirmed yet. Open the link in your email first.");
        return;
      }
      setError("That email and password don't match an account.");
      return;
    }

    // Staff belong on the dashboard, customers on their own page. Sending
    // everyone to /admin and letting it bounce them looks like a failed login.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let destination = redirectTo ?? "/account";
    if (!redirectTo && user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile && ["staff", "admin"].includes(profile.role)) destination = "/admin";
    }

    setLoading(false);
    router.push(destination);
    router.refresh();
  }

  async function resendConfirmation() {
    setResent(false);
    const supabase = createClient();
    const next = redirectTo ?? "/account";
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setResent(true);
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Keep your bookings in one place. Staff land on the dashboard."
      error={error}
      notice={resent ? "Confirmation email sent again." : null}
      footer={
        <>
          No account yet? <AuthLink href={withRedirect("/signup")}>Create one</AuthLink>
        </>
      }
    >
      {/*
        The mark comes from react-icons, which ships the official glyph —
        Google's branding guidelines ask for their supplied mark rather than a
        hand-drawn copy, and a redrawn logo would be both inaccurate and not
        ours to redraw.

        The icon sits in a fixed-width slot on the left with the label centred.
        The spinner replaces the mark in place rather than being added beside
        it, so nothing shifts when the button is pressed.
      */}
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={oauthLoading}
        className="relative flex w-full items-center justify-center rounded-court border border-line bg-surface-base py-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink-muted/40 disabled:opacity-50"
      >
        <span className="absolute left-4 flex h-5 w-5 items-center justify-center">
          {oauthLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FcGoogle className="h-5 w-5" />
          )}
        </span>
        Continue with Google
      </button>
      {/*
        Facebook is not offered. The provider is not enabled — Meta wants
        business verification and app review before anyone outside a tester
        list can use it — so the button did nothing but fail. Offering a way in
        that cannot let anyone in is worse than showing one option that works.
      */}

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-ink-muted">or with email</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
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
        <div>
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
          <p className="mt-2 text-right text-xs">
            <AuthLink href="/forgot-password">Forgotten your password?</AuthLink>
          </p>
        </div>

        <SubmitButton loading={loading}>Sign in</SubmitButton>

        {unconfirmed && (
          <button
            type="button"
            onClick={resendConfirmation}
            className="w-full rounded-court border border-line py-3 text-sm font-semibold text-ink transition-colors active:bg-surface-muted"
          >
            Send the confirmation email again
          </button>
        )}
      </form>
    </AuthShell>
  );
}
