"use client";

import { useCallback, useEffect, useState } from "react";

export type GuestIdentity = { name: string; email: string; phone: string };

const STORAGE_KEY = "luki:guest-details";

/**
 * Who is checking out, filled in before they are asked.
 *
 * Two sources, in order of authority:
 *   1. the signed-in account — email comes from the session and is not a guess;
 *   2. this browser's last checkout, for people who never sign in.
 *
 * The browser copy is a convenience, not a record: it holds a name, a phone
 * number and an email the person typed themselves on this device, nothing that
 * identifies anyone else, and it is wrapped in try/catch because private
 * windows and blocked site data make every access throw.
 *
 * `remember` is called after a booking succeeds rather than on every keystroke,
 * so a half-typed number never becomes the default for next time.
 */
export function useGuestIdentity({ enabled = true }: { enabled?: boolean } = {}) {
  const [guest, setGuest] = useState<GuestIdentity>({ name: "", email: "", phone: "" });
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Disabled at the desk: staff are booking for a caller, and prefilling the
    // staff member's own email would quietly send the caller's confirmation and
    // cancellation link to the club instead of to them.
    if (!enabled) {
      setReady(true);
      return;
    }
    let cancelled = false;

    let stored: Partial<GuestIdentity> = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
    } catch {
      stored = {};
    }

    // Show what the browser remembers immediately; the account, if any,
    // overwrites it a moment later.
    if (stored.name || stored.email || stored.phone) {
      setGuest({
        name: stored.name ?? "",
        email: stored.email ?? "",
        phone: stored.phone ?? "",
      });
    }

    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.signedIn) return;
        setSignedIn(true);
        setGuest((g) => ({
          // The account's email is authoritative — never let a stale browser
          // copy put someone else's address on this person's booking.
          email: d.email || g.email,
          name: d.name || g.name,
          phone: d.phone || g.phone,
        }));
      })
      .catch(() => {
        /* signed out, offline, or the profile is unreadable — the form still works */
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const remember = useCallback(
    (details: GuestIdentity) => {
      if (!enabled) return;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(details));
      } catch {
        /* storage unavailable — the account copy below still carries it */
      }
      if (!signedIn) return;
      fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: details.name, phone: details.phone }),
      }).catch(() => {
        /* remembering is a convenience; never fail a completed booking over it */
      });
    },
    [signedIn, enabled]
  );

  return { guest, setGuest, remember, signedIn, ready };
}
