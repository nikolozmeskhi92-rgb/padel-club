import { pageTitle } from "@/lib/club";
import { CourtBookingFlow } from "@/components/booking/CourtBookingFlow";

export const metadata = { title: pageTitle("Book a Court") };

export default function BookPage() {
  return <CourtBookingFlow />;
}
