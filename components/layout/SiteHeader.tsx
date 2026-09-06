import Link from "next/link";
import { wordmarkParts } from "@/lib/club";
import { createServerSupabase } from "@/lib/supabase/server";
import { MobileNav } from "./MobileNav";

const NAV = [
  { href: "/book", label: "Courts" },
  { href: "/car-wash", label: "Car wash" },
  { href: "/blog", label: "News" },
];

/**
 * The header reads the session, so it can say who is signed in.
 *
 * It used to render a "Sign in" link unconditionally — after signing in you
 * were still invited to sign in, with nothing anywhere to say it had worked or
 * to get back out again. Reading the session here makes the header the honest
 * answer to "am I logged in?", which is the question a header is for.
 *
 * The cost is that every page carrying this header renders dynamically rather
 * than statically. For a club site whose interesting pages already hit the
 * database on every request, that is the right trade.
 */
export async function SiteHeader() {
  const wordmark = wordmarkParts();

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  let isStaff = false;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .maybeSingle();
    displayName = profile?.full_name ?? user.email ?? "Account";
    isStaff = !!profile && ["staff", "admin"].includes(profile.role);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-7 sm:px-8">
        <Link href="/" className="font-heading text-lg font-extrabold tracking-tight text-ink">
          {wordmark.lead} <span className="text-brand">{wordmark.accent}</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/*
          Below md every one of these was hidden, which left a phone with a
          logo, a booking button and no way to reach the car wash, the news or
          its own account. They stay hidden here — but the same links are in the
          menu beside them now, rather than nowhere.
        */}
        <div className="flex items-center gap-1 sm:gap-3">
          {user ? (
            <>
              {isStaff && (
                <Link
                  href="/admin"
                  className="hidden text-sm font-semibold text-brand transition-colors hover:text-brand-hover md:block"
                >
                  Dashboard
                </Link>
              )}
              <Link
                href="/account"
                className="hidden max-w-[12rem] truncate text-sm text-ink-muted transition-colors hover:text-ink md:block"
                title="My bookings"
              >
                {displayName}
              </Link>
              {/* A form, because signing out is a POST — see app/auth/signout. */}
              <form action="/auth/signout" method="post" className="hidden md:block">
                <button
                  type="submit"
                  className="text-sm text-ink-muted transition-colors hover:text-ink"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="hidden text-sm text-ink-muted transition-colors hover:text-ink md:block"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/book"
            className="rounded-court bg-brand px-3.5 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98] sm:px-4"
          >
            Book a court
          </Link>
          <MobileNav
            nav={NAV}
            signedIn={!!user}
            displayName={displayName}
            isStaff={isStaff}
          />
        </div>
      </div>
    </header>
  );
}
