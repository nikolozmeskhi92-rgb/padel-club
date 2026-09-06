"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Trash2, AlertCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Recipient = {
  id: string;
  email: string;
  label: string | null;
  active: boolean;
};

const MESSAGES: Record<string, string> = {
  ALREADY_ON_LIST: "That address is already on the list.",
  INVALID_EMAIL: "That doesn't look like an email address.",
  FORBIDDEN: "Your session has expired — sign in again.",
};

/**
 * The club's own notification list.
 *
 * Switching an address off is offered alongside removing it, because those are
 * different intentions: a manager on holiday comes back, and re-typing an
 * address is how a typo gets onto the list.
 */
export function NotificationRecipients({ emailConfigured }: { emailConfigured: boolean }) {
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/admin/notifications");
      const data = await res.json();
      setRows(res.ok ? data.recipients : []);
      if (!res.ok) setError(MESSAGES[data.error] ?? "Couldn't load the list.");
    } catch {
      setError("Couldn't load the list.");
      setRows([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, label: label || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(MESSAGES[data.error] ?? "Couldn't add that address.");
        return;
      }
      setEmail("");
      setLabel("");
      await load();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: Recipient) {
    setError(null);
    await fetch("/api/admin/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, active: !r.active }),
    });
    load();
  }

  async function remove(r: Recipient) {
    // Removing is not the same as pausing, so the confirmation says which one
    // this is and points at the other.
    const ok = window.confirm(
      `Remove ${r.email} from the notification list?\n\n` +
        `They'll stop receiving booking alerts. If this is temporary, use the ` +
        `On/Off switch instead — it keeps the address.`
    );
    if (!ok) return;
    setError(null);
    await fetch(`/api/admin/notifications?id=${encodeURIComponent(r.id)}`, {
      method: "DELETE",
    });
    load();
  }

  /**
   * Prove the whole chain before relying on it. A wrong key, an unverified
   * domain, a refused from-address — each fails silently and each used to be
   * discoverable only by making a real booking and hoping.
   */
  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/notifications/test", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError("Couldn't send the test.");
        return;
      }
      setTestResult(
        data.sent > 0
          ? `Sent to ${data.sent} address${data.sent === 1 ? "" : "es"} — check the inbox (and spam).`
          : data.skipped === "NO_RECIPIENTS"
            ? "Nobody is on the list yet, so there was nowhere to send it."
            : data.skipped === "NO_API_KEY"
              ? "No email provider is configured, so nothing was sent."
              : "The provider refused it. Check the API key and the from-address."
      );
    } catch {
      setError("Network error — try again.");
    } finally {
      setTesting(false);
    }
  }

  const activeCount = (rows ?? []).filter((r) => r.active).length;

  return (
    <div className="rounded-court border border-line bg-surface-base p-5 shadow-card">
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-ink">
        <Mail className="h-4 w-4 text-brand" /> Booking alerts
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Everyone on this list gets an email the moment a court or a wash is booked —
        online or at the desk.
      </p>

      {/* Say plainly when the club would hear nothing, rather than letting a
          full-looking list imply the alerts are working. */}
      {!emailConfigured && (
        <p className="mt-3 flex items-start gap-2 rounded-court border border-peak/40 bg-peak/10 px-3 py-2 text-xs text-ink">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-peak" />
          No email provider is configured yet (<code>RESEND_API_KEY</code>), so nothing is
          actually being sent. Add the key and this list starts working with no other
          changes.
        </p>
      )}

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="manager@example.com"
            className="rounded-court border border-line bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex w-40 flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Front desk"
            className="rounded-court border border-line bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <button
          disabled={busy || !email.trim()}
          className="flex items-center gap-2 rounded-court bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Add
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-court border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button
          onClick={sendTest}
          disabled={testing}
          className="flex items-center gap-2 rounded-court border border-line px-4 py-2 text-sm font-medium text-ink-muted hover:border-brand hover:text-brand disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send a test alert
        </button>
        {testResult && <p className="text-xs text-ink-muted">{testResult}</p>}
      </div>

      <div className="mt-5">
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-court border border-line bg-surface-muted px-4 py-6 text-center text-sm text-ink-muted">
            Nobody is on the list yet, so no booking alerts are going out.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-muted">
              {activeCount} of {rows.length} receiving alerts
            </p>
            <ul className="divide-y divide-line/60 rounded-court border border-line">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-4 py-3",
                    !r.active && "opacity-60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.email}</p>
                    {r.label && <p className="text-xs text-ink-muted">{r.label}</p>}
                  </div>
                  <button
                    onClick={() => toggle(r)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      r.active
                        ? "border-brand-accent/40 bg-brand-accent/10 text-brand-accent"
                        : "border-line text-ink-muted"
                    )}
                  >
                    {r.active ? "On" : "Off"}
                  </button>
                  <button
                    onClick={() => remove(r)}
                    aria-label={`Remove ${r.email}`}
                    className="rounded-court border border-line p-1.5 text-ink-muted hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
