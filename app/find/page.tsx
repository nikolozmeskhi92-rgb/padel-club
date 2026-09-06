import { pageTitle } from "@/lib/club";
import { FindBooking } from "@/components/booking/FindBooking";

export const metadata = { title: pageTitle("Find Your Booking") };

export default function FindBookingPage() {
  return <FindBooking />;
}
