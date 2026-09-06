"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

// useSearchParams() opts a component out of static prerendering, so the form
// lives in its own component behind a Suspense boundary. Without it, `next build`
// fails on /login with a CSR-bailout prerender error.
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <div className="h-7 w-44 animate-pulse rounded-court bg-surface-muted" />
      <div className="mt-2 h-4 w-56 animate-pulse rounded-court bg-surface-muted" />
      <div className="mt-8 space-y-3">
        <div className="h-11 w-full animate-pulse rounded-court bg-surface-muted" />
        <div className="h-11 w-full animate-pulse rounded-court bg-surface-muted" />
        <div className="h-12 w-full animate-pulse rounded-court bg-surface-muted" />
      </div>
    </div>
  );
}

type Provider = "google" | "facebook";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<Provider | null>(null);

  // The callback route reports provider refusals back through ?error=, so a
  // declined consent screen says why instead of silently returning here.
  const [error, setError] = useState<string | null>(params.get("error"));

  const redirectTo = params.get("redirect");

  async function signInWith(provider: Provider) {
    setOauthLoading(provider);
    setError(null);
    const supabase = createClient();
    // The browser goes to the provider, the provider returns to Supabase, and
    // Supabase forwards to /auth/callback — which is where the session cookie
    // is actually written. `next` is carried through that round trip.
    const callback = new URL("/auth/callback", window.location.origin);
    if (redirectTo) callback.searchParams.set("next", redirectTo);

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });

    if (error) {
      setOauthLoading(null);
      setError(
        `Could not start ${provider === "google" ? "Google" : "Facebook"} sign-in. ${error.message}`
      );
    }
    // On success the browser navigates away; no need to clear the loading state.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(redirectTo ?? "/admin");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-6">
      <h1 className="font-heading text-2xl font-extrabold text-ink">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Keep your bookings in one place. Staff land on the dashboard.
      </p>

      {error && (
        <p className="mt-6 rounded-court border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-8 space-y-3">
        {/*
          Plain text buttons. Google's branding guidelines require their own
          supplied mark on a "Sign in with Google" button rather than a
          hand-drawn copy, so drop the official asset in here from
          developers.google.com/identity/branding-guidelines when you have it —
          same for Meta's. Text-only is correct and unbranded until then.
        */}
        <button
          type="button"
          onClick={() => signInWith("google")}
          disabled={oauthLoading !== null}
          className="flex w-full items-center justify-center gap-2 rounded-court border border-line bg-surface-base py-3 text-sm font-semibold text-ink transition-colors hover:border-ink-muted/40 disabled:opacity-50"
        >
          {oauthLoading === "google" && <Loader2 className="h-4 w-4 animate-spin" />}
          Continue with Google
        </button>
        <button
          type="button"
          onClick={() => signInWith("facebook")}
          disabled={oauthLoading !== null}
          className="flex w-full items-center justify-center gap-2 rounded-court border border-line bg-surface-base py-3 text-sm font-semibold text-ink transition-colors hover:border-ink-muted/40 disabled:opacity-50"
        >
          {oauthLoading === "facebook" && <Loader2 className="h-4 w-4 animate-spin" />}
          Continue with Facebook
        </button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-ink-muted">or with email</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-court border border-line bg-surface-base px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-court border border-line bg-surface-base px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </form>
    </div>
  );
}
