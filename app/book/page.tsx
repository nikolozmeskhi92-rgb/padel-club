import { pageTitle } from "@/lib/club";
import { CourtBookingFlow } from "@/components/booking/CourtBookingFlow";
import { getDayBookings } from "@/lib/availability";
import { clubDateKey } from "@/lib/time/club";

export const metadata = { title: pageTitle("Book a Court") };

/**
 * Today's availability is fetched here, on the server, and handed to the flow.
 *
 * It used to be fetched by the browser after hydration: the page painted a
 * skeleton, then waited on a request that takes 400-800ms of its own before a
 * single bookable time appeared. This route already renders dynamically — the
 * header reads the session — so the query rides along with a render that was
 * happening anyway, and the first screen arrives with the times on it.
 *
 * A failure here is not fatal: the flow falls back to fetching for itself, and
 * shows its own "couldn't load availability" panel if that fails too. A booking
 * page that will not render at all because one query was slow is worse than one
 * that takes a moment longer to fill in.
 */
export default async function BookPage() {
  const dateKey = clubDateKey(new Date());
  let initialBookings = null;
  try {
    initialBookings = await getDayBookings(dateKey);
  } catch {
    initialBookings = null;
  }

  return <CourtBookingFlow initialDateKey={dateKey} initialBookings={initialBookings} />;
}
