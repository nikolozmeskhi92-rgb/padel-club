"use client";

import { useState } from "react";
import { MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage, isEmailRateLimit } from "@/lib/auth/errors";
import { AuthField, AuthLink, AuthShell, SubmitButton } from "@/components/auth/AuthShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      // The link goes through /auth/callback, which turns the recovery token
      // into a session, and only then to the page that sets the new password.
      // Landing straight on /reset-password would arrive with no session and
      // nothing to update.
      redirectTo: `${window.location.origin}/auth/callback?next=%2Freset-password`,
    });
    setLoading(false);

    /*
      The same answer either way, and deliberately.

      "No account with that email" is a free way to find out who is a customer
      here — paste in a list of addresses and read the answers. Rate limiting
      does not fix that, it only slows it down. So this page says what it did,
      not what it found, and a person who mistypes their address finds out the
      ordinary way: no email arrives.

      Two failures are still reported, because neither says anything about who
      has an account: the network being down, and the mail quota being spent.
      The second one is the important one — telling someone their link is on
      its way when the provider has just refused to send it is the version of
      this page that wastes an afternoon.
    */
    if (resetError && (isEmailRateLimit(resetError) || /network|fetch|unreachable/i.test(resetError.message))) {
      setError(authErrorMessage(resetError));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        footer={
          <>
            Remembered it? <AuthLink href="/login">Sign in</AuthLink>
          </>
        }
      >
        <div className="rounded-court border border-line bg-surface-base p-5 text-sm text-ink-muted">
          <MailCheck className="h-6 w-6 text-brand" />
          <p className="mt-3">
            If <span className="font-semibold text-ink">{email}</span> has an account, a link to
            set a new password is on its way. It is good for one hour.
          </p>
          <p className="mt-3 text-xs">
            No email? Check spam, and check the address above for a typo — that is usually what
            has happened.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Give us the address you signed up with and we'll send a link to set a new one."
      error={error}
      footer={
        <>
          Remembered it? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
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
        <SubmitButton loading={loading}>Send the link</SubmitButton>
      </form>
    </AuthShell>
  );
}
