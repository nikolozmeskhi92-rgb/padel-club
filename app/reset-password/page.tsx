"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { checkPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { AuthLink, AuthShell, PasswordField, SubmitButton } from "@/components/auth/AuthShell";

/**
 * Where the link in a password-reset email ends up.
 *
 * By the time this renders, /auth/callback has already turned the recovery
 * token into a session — so the person is, briefly, signed in with the sole
 * purpose of changing their password. That session is the proof they own the
 * mailbox; there is no "old password" field because they have just proved it a
 * stronger way.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "no-session">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // A recovery link is good for an hour and for one use. Opening an old one, or
  // this page directly, has to say so — a password form that silently refuses
  // to save is the worst version of this screen.
  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setReady(data.user ? "ok" : "no-session");
      })
      .catch(() => !cancelled && setReady("no-session"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const verdict = checkPassword(password);
    if (!verdict.ok) {
      setError(verdict.message);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    // Straight in, rather than back to the sign-in form. They have just proved
    // the mailbox and set the password; asking them to type it again is a
    // ceremony that protects nobody.
    setTimeout(() => {
      router.push("/account");
      router.refresh();
    }, 1200);
  }

  if (ready === "checking") {
    return (
      <AuthShell title="Set a new password">
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
        </p>
      </AuthShell>
    );
  }

  if (ready === "no-session") {
    return (
      <AuthShell
        title="That link has expired"
        subtitle="Reset links last an hour and work once. Ask for a fresh one and it will take a moment."
        footer={
          <>
            Or <AuthLink href="/login">sign in</AuthLink> if you have remembered it.
          </>
        }
      >
        <AuthLink href="/forgot-password">Send me a new link</AuthLink>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose something you don't use anywhere else."
      error={error}
      notice={done ? "Password changed. Taking you to your account…" : null}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          showMeter
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        />
        <PasswordField
          label="Repeat new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          required
        />
        <SubmitButton loading={loading} disabled={done}>
          Save the new password
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
