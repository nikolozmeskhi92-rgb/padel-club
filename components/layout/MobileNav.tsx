"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

type Item = { href: string; label: string };

/**
 * The phone half of the header.
 *
 * Everything except the wordmark and "Book a court" used to be `hidden sm:block`
 * or `hidden md:flex`, so on a phone the site had no navigation at all and no
 * way to sign in — the two things a header exists for. This is that menu.
 *
 * It is a client component only because a panel has to open and close; the
 * session is still read on the server and handed down, so the menu never
 * flickers between "signed out" and "signed in" the way a client-side fetch
 * would.
 */
export function MobileNav({
  nav,
  signedIn,
  displayName,
  isStaff,
}: {
  nav: readonly Item[];
  signedIn: boolean;
  displayName: string | null;
  isStaff: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navigating with the panel open would otherwise leave it covering the page
  // you just asked for.
  useEffect(() => setOpen(false), [pathname]);

  // Escape closes it, and the page behind it does not scroll while it is up —
  // scrolling the page under an open menu is the thing that makes a phone menu
  // feel broken.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const linkClass =
    "flex min-h-[48px] items-center rounded-court px-3 text-base text-ink transition-colors hover:bg-surface-muted active:bg-surface-muted";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-court text-ink transition-colors hover:bg-surface-muted md:hidden"
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {open && (
        <>
          {/* Tapping anywhere off the panel closes it, which is what a thumb
              reaches for first. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-x-0 bottom-0 top-16 z-30 cursor-default bg-ink/30 backdrop-blur-sm md:hidden"
          />
          <div
            id="mobile-nav"
            className="fixed inset-x-0 top-16 z-40 max-h-[calc(100vh-4rem)] overflow-y-auto border-b border-line bg-surface-base px-4 pb-4 pt-2 shadow-card md:hidden"
          >
            <nav className="flex flex-col">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="my-2 h-px bg-line" />

            {signedIn ? (
              <div className="flex flex-col">
                {isStaff && (
                  <Link href="/admin" className={`${linkClass} font-semibold text-brand`}>
                    Dashboard
                  </Link>
                )}
                <Link href="/account" className={linkClass}>
                  <span className="truncate">{displayName}</span>
                </Link>
                {/* A form, because signing out is a POST — see app/auth/signout. */}
                <form action="/auth/signout" method="post">
                  <button type="submit" className={`${linkClass} w-full text-left`}>
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex flex-col">
                <Link href="/login" className={linkClass}>
                  Sign in
                </Link>
                <Link href="/find" className={linkClass}>
                  Find your booking
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
