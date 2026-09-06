import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { clubDateKey, clubDayBounds, CLUB_TIMEZONE } from "@/lib/time/club";
import { pageTitle } from "@/lib/club";
import { BookingsTable, type AdminBooking } from "@/components/admin/BookingsTable";

export const metadata = { title: pageTitle("Bookings") };
export const dynamic = "force-dynamic";

function rangeStart(pgRange: string): string | null {
  const m = pgRange.match(/[\[\(]"?([^",]+)"?,/);
  return m ? new Date(m[1]).toISOString() : null;
}

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string; status?: string }>;
}) {
  await requireStaff("/admin/bookings");
  const sp = await searchParams;

  const q = (sp.q ?? "").trim();
  // Default window: today forward a week. The desk is almost always asking
  // about something imminent, and an unbounded list would be useless within a
  // season.
  const from = sp.from || clubDateKey(new Date());
  const to = sp.to || clubDateKey(new Date(Date.now() + 7 * 86400_000));
  const status = sp.status ?? "active";

  // Service-role: staff are entitled to every booking, and going through RLS
  // here would mean the list silently depends on the policy staying permissive
  // for their role. The gate is requireStaff() above, in one place.
  const supabase = createServiceRoleClient();

  const start = clubDayBounds(from).start.toISOString();
  const end = clubDayBounds(to).end.toISOString();
  const window = `[${start},${end})`;

  function applyFilters(builder: any) {
    let b = builder.overlaps("slot", window);
    if (status === "active") b = b.in("status", ["pending", "confirmed"]);
    else if (status === "cancelled") b = b.eq("status", "cancelled");
    if (q) {
      // Search the things a caller can actually give you over the phone.
      b = b.or(
        [
          `guest_name.ilike.%${q}%`,
          `guest_email.ilike.%${q}%`,
          `booking_code.ilike.%${q}%`,
        ].join(",")
      );
    }
    return b;
  }

  const [{ data: courts }, { data: washes }] = await Promise.all([
    applyFilters(
      supabase
        .from("court_bookings")
        .select(
          "id, court_id, slot, duration_minutes, status, price_cents, payment_status, booking_code, guest_name, guest_email, guest_phone, user_id"
        )
    ),
    applyFilters(
      supabase
        .from("wash_bookings")
        .select(
          "id, bay_id, service, slot, status, price_cents, payment_status, booking_code, guest_name, guest_email, user_id"
        )
    ),
  ]);

  const rows: AdminBooking[] = [
    ...((courts ?? []) as any[]).map((b) => ({
      id: b.id,
      kind: "court" as const,
      resource: `Court ${b.court_id}`,
      startIso: rangeStart(b.slot),
      durationMinutes: b.duration_minutes,
      status: b.status,
      paymentStatus: b.payment_status,
      priceCents: b.price_cents,
      code: b.booking_code,
      name: b.guest_name,
      email: b.guest_email,
      phone: b.guest_phone,
      hasAccount: !!b.user_id,
    })),
    ...((washes ?? []) as any[]).map((b) => ({
      id: b.id,
      kind: "car_wash" as const,
      resource: `Bay ${b.bay_id} · ${String(b.service).replace(/_/g, " ")}`,
      startIso: rangeStart(b.slot),
      durationMinutes: null,
      status: b.status,
      paymentStatus: b.payment_status,
      priceCents: b.price_cents,
      code: b.booking_code,
      name: b.guest_name,
      email: b.guest_email,
      phone: null,
      hasAccount: !!b.user_id,
    })),
  ]
    .filter((r) => r.startIso)
    .sort((a, b) => a.startIso!.localeCompare(b.startIso!));

  // Phone numbers live only on court bookings, so a phone search has to be
  // applied here rather than in the two queries above.
  const filtered = q
    ? rows.filter(
        (r) =>
          [r.name, r.email, r.code, r.phone]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(q.toLowerCase()))
      )
    : rows;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink">
            Bookings
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Times are club time ({CLUB_TIMEZONE}).
          </p>
        </div>
        <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
          &larr; Dashboard
        </Link>
      </div>

      {/* A plain GET form: the filters end up in the URL, so a manager can
          bookmark "next week, unpaid" or send it to a colleague. */}
      <form className="mt-6 flex flex-wrap items-end gap-3 rounded-court border border-line bg-surface-base p-4 shadow-card">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Search</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Name, email, phone or code"
            className="rounded-court border border-line bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">From</span>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="rounded-court border border-line bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">To</span>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="rounded-court border border-line bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Status</span>
          <select
            name="status"
            defaultValue={status}
            className="rounded-court border border-line bg-surface-muted px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </label>
        <button className="rounded-court bg-brand px-5 py-2 text-sm font-semibold text-white">
          Apply
        </button>
      </form>

      <p className="mt-4 text-sm text-ink-muted">
        {filtered.length} booking{filtered.length === 1 ? "" : "s"}
      </p>

      <BookingsTable rows={filtered} />
    </div>
  );
}
