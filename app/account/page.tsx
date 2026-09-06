import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Droplets, Ticket } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/currency";
import { pageTitle } from "@/lib/club";
import { CLUB_TIMEZONE } from "@/lib/time/club";

export const metadata = { title: pageTitle("My bookings") };
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  slot: string;
  status: string;
  price_cents: number;
  payment_status: string;
  booking_code: string;
  cancel_token: string;
};

/** Postgres hands tstzrange back as `["2026-09-07 05:00:00+00","2026-09-07 06:00:00+00")`. */
function rangeStart(pgRange: string): Date | null {
  const m = pgRange.match(/[\[\(]"?([^",]+)"?,/);
  return m ? new Date(m[1]) : null;
}

/** Always render times on the club's clock, whatever clock the reader is on. */
const when = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TIMEZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AccountPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?redirect=/account");

  // Two separate questions, and it matters that they are not confused:
  // RLS answers "what is this person ALLOWED to see", and the policy is
  // "own rows, or everything if staff/admin". This page asks "what is MINE".
  // For a customer the two happen to coincide; for an admin they do not, and
  // relying on the policy alone put the whole club's bookings under a heading
  // that said "Everything booked while signed in as you". Filter explicitly.
  //
  // The session client is still the right one to use: the policy stays as a
  // second line of defence behind this filter, so a mistake here cannot leak
  // another customer's rows the way the service-role key would.
  const [{ data: courts }, { data: washes }] = await Promise.all([
    supabase
      .from("court_bookings")
      .select("id, slot, status, price_cents, payment_status, booking_code, cancel_token, court_id")
      .eq("user_id", user.id)
      .order("slot", { ascending: false }),
    supabase
      .from("wash_bookings")
      .select("id, slot, status, price_cents, payment_status, booking_code, cancel_token, service, bay_id")
      .eq("user_id", user.id)
      .order("slot", { ascending: false }),
  ]);

  const items = [
    ...((courts ?? []) as (Row & { court_id: number })[]).map((b) => ({
      ...b,
      kind: "court" as const,
      label: `Court ${b.court_id}`,
    })),
    ...((washes ?? []) as (Row & { service: string; bay_id: number })[]).map((b) => ({
      ...b,
      kind: "wash" as const,
      label: `Bay ${b.bay_id} · ${b.service.replace(/_/g, " ")}`,
    })),
  ]
    .map((b) => ({ ...b, start: rangeStart(b.slot) }))
    .filter((b) => b.start)
    .sort((a, b) => b.start!.getTime() - a.start!.getTime());

  const upcoming = items.filter((b) => b.start! > new Date() && b.status !== "cancelled");
  const past = items.filter((b) => !(b.start! > new Date() && b.status !== "cancelled"));

  return (
    <div className="mx-auto max-w-2xl px-7 sm:px-8 py-14">
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink">
        My bookings
      </h1>
      <p className="mt-2 text-ink-muted">
        Everything booked while signed in as {user.email}.
      </p>

      {items.length === 0 && (
        <div className="mt-10 rounded-court border border-line bg-surface-base p-8 text-center shadow-card">
          <CalendarDays className="mx-auto h-6 w-6 text-ink-muted/60" />
          <p className="mt-3 text-sm font-semibold text-ink">Nothing here yet</p>
          {/*
            Worth saying plainly: bookings made before signing in, or made as a
            guest, are not attached to this account and will not appear. The
            confirmation email and the booking code are how those are found.
          */}
          <p className="mt-1 text-sm text-ink-muted">
            Bookings you made as a guest aren&apos;t linked to this account — use the
            code from your confirmation for those.
          </p>
          <Link
            href="/book"
            className="mt-5 inline-block rounded-court bg-brand px-5 py-2.5 text-sm font-semibold text-white"
          >
            Book a court
          </Link>
        </div>
      )}

      {upcoming.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Upcoming
          </h2>
          <ul className="mt-3 space-y-3">
            {upcoming.map((b) => (
              <BookingCard key={b.id} b={b} cancellable />
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Past &amp; cancelled
          </h2>
          <ul className="mt-3 space-y-3">
            {past.map((b) => (
              <BookingCard key={b.id} b={b} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BookingCard({
  b,
  cancellable = false,
}: {
  b: {
    kind: "court" | "wash";
    label: string;
    start: Date | null;
    status: string;
    payment_status: string;
    price_cents: number;
    booking_code: string;
    cancel_token: string;
  };
  cancellable?: boolean;
}) {
  const cancelled = b.status === "cancelled";
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 rounded-court border border-line bg-surface-base p-4 shadow-card ${
        cancelled ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold capitalize text-ink">
          {b.kind === "wash" ? (
            <Droplets className="h-4 w-4 shrink-0 text-brand-accent" />
          ) : (
            <CalendarDays className="h-4 w-4 shrink-0 text-brand" />
          )}
          {b.label}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{b.start ? when.format(b.start) : "—"}</p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted/80">
          <Ticket className="h-3 w-3" />
          <span className="font-mono">{b.booking_code}</span>
          <span>·</span>
          <span>{formatMoney(b.price_cents)}</span>
          <span>·</span>
          <span className="capitalize">{cancelled ? "cancelled" : b.payment_status}</span>
        </p>
      </div>

      {cancellable && !cancelled && (
        // Reuses the guest cancel page, which already shows refund-vs-credit
        // before anything is confirmed. No second cancellation path to keep in
        // step with the first.
        <Link
          href={`/cancel/${b.cancel_token}`}
          className="shrink-0 rounded-court border border-line px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-red-300 hover:text-red-600"
        >
          Cancel
        </Link>
      )}
    </li>
  );
}
