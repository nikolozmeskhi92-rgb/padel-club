import { pageTitle } from "@/lib/club";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { clubDateKey, clubDayBounds } from "@/lib/time/club";

export const metadata = { title: pageTitle("Admin Dashboard") };
export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string; to?: string }>;
}) {
  const { date: requestedDate, from: requestedFrom, to: requestedTo } = await searchParams;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?redirect=/admin");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || !["staff", "admin"].includes(profile.role)) {
    redirect("/");
  }

  // The chart window: half a month back, half a month forward. Backwards is
  // money taken, forwards is money booked, and an owner asks both questions in
  // the same breath — "how did the fortnight go, and how does the next one
  // look?". get_daily_summary() buckets by the CLUB's calendar day (see
  // club_timezone() in migration 0002), so the dates asked for have to be the
  // club's too: toISOString() would ask for UTC days and shift the whole chart.
  const DEFAULT_WINDOW_DAYS = 15;
  const dayKeyOffset = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return clubDateKey(d);
  };
  const isDateKey = (v: string | undefined) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

  let chartFrom = isDateKey(requestedFrom) ? requestedFrom! : dayKeyOffset(-DEFAULT_WINDOW_DAYS);
  let chartTo = isDateKey(requestedTo) ? requestedTo! : dayKeyOffset(DEFAULT_WINDOW_DAYS);
  if (chartFrom > chartTo) [chartFrom, chartTo] = [chartTo, chartFrom];

  // One round trip for the whole window (migration 0011), not one call per day.
  const { data: rangeRows } = await supabase.rpc("get_summary_range", {
    p_from: chartFrom,
    p_to: chartTo,
  });

  const summaries = ((rangeRows ?? []) as any[]).map((r) => ({ ...r, date: r.day }));

  // `slot` is a tstzrange, so it needs the range overlap operator — comparing it
  // to a date string makes Postgres try to read that string as a range and fail
  // with `malformed range literal`, which silently emptied both lists here the
  // same way it broke /book. Bounds are the club's calendar day, not UTC's.
  const today = clubDateKey(new Date());
  // The desk needs any day, not just this one — "is the 24th busy?" is asked at
  // the counter constantly. The date comes in as a club-local YYYY-MM-DD; a
  // malformed one falls back to today rather than throwing a 500 at whoever
  // edited the URL.
  const viewDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "")
    ? (requestedDate as string)
    : today;
  const { start: dayStart, end: dayEnd } = clubDayBounds(viewDate);
  const dayRange = `[${dayStart.toISOString()},${dayEnd.toISOString()})`;

  const { data: todaysCourtBookings } = await supabase
    .from("court_bookings")
    .select("id, court_id, slot, status, guest_name, payment_status, booking_code")
    .overlaps("slot", dayRange)
    .in("status", ["pending", "confirmed"]);

  const { data: todaysCarWash } = await supabase
    .from("wash_bookings")
    .select("id, bay_id, slot, status, service, guest_name")
    .overlaps("slot", dayRange)
    .in("status", ["pending", "confirmed"]);

  // Everything the court map needs: the courts themselves, and each active
  // booking's full range (not just its start) so a 90-minute slot paints three
  // half-hour blocks rather than one.
  const { data: courtList } = await supabase
    .from("courts")
    .select("id, name, indoor")
    .eq("is_active", true)
    .order("sort_order");

  function parseRange(pgRange: string): { start: string; end: string } | null {
    const m = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
    return m ? { start: new Date(m[1]).toISOString(), end: new Date(m[2]).toISOString() } : null;
  }

  const gridBookings = ((todaysCourtBookings ?? []) as any[])
    .map((b) => {
      const r = parseRange(b.slot);
      return r
        ? {
            courtId: b.court_id,
            startIso: r.start,
            endIso: r.end,
            guest: b.guest_name,
            code: b.booking_code,
            status: b.status,
            paymentStatus: b.payment_status,
          }
        : null;
    })
    .filter(Boolean) as any[];

  return (
    <AdminDashboard
      courts={(courtList ?? []) as any}
      gridBookings={gridBookings}
      dateLabel={viewDate}
      isToday={viewDate === today}
      chartFrom={chartFrom}
      chartTo={chartTo}
      todayKey={today}
      adminName={profile.full_name ?? "Admin"}
      dailySummaries={summaries}
      courtBookingsToday={todaysCourtBookings ?? []}
      carWashBookingsToday={todaysCarWash ?? []}
    />
  );
}
