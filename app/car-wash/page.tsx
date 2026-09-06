import { pageTitle } from "@/lib/club";
import { CarWashBookingFlow } from "@/components/carwash/CarWashBookingFlow";

export const metadata = { title: pageTitle("Book a Car Wash") };

export default function CarWashPage() {
  return <CarWashBookingFlow />;
}
