import { createServiceRoleClient } from "@/lib/supabase/server";
import { clubDayBounds } from "@/lib/time/club";

export type DayBooking = {
  id: string;
  court_id: number;
  slot: string;
  status: string;
};

/**
 * Every live court booking touching one club-local day.
 *
 * Shared by `GET /api/bookings` and by the booking page's server render, so the
 * grid the server paints and the grid the client refetches can never disagree
 * about what "this day" means.
 *
 * `slot` is a tstzrange, so it has to be matched with the range OVERLAP
 * operator. Comparing it to a timestamp made Postgres try to read the timestamp
 * as a range and fail with `malformed range literal`, which this endpoint
 * returned as a 500 and the page read as "couldn't load availability". Overlap
 * is also the right question: show bookings that touch this day, not only the
 * ones that start inside it.
 *
 * The day's UTC bounds are not midnight-to-midnight Z — asking for
 * `${date}T00:00:00Z`..`T23:59:59Z` shifts the window by the club's offset and
 * clips both ends of the day.
 */
export async function getDayBookings(dateKey: string): Promise<DayBooking[]> {
  const supabase = createServiceRoleClient();
  const { start, end } = clubDayBounds(dateKey);

  const { data, error } = await supabase
    .from("court_bookings")
    .select("id, court_id, slot, status")
    .in("status", ["pending", "confirmed"])
    .overlaps("slot", `[${start.toISOString()},${end.toISOString()})`);

  if (error) throw new Error(`availability query failed: ${error.message}`);
  return (data ?? []) as DayBooking[];
}
