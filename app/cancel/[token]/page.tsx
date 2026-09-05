import { CancelBookingFlow } from "@/components/booking/CancelBookingFlow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cancel your booking",
  robots: { index: false, follow: false },
};

export default function CancelPage({ params }: { params: { token: string } }) {
  return <CancelBookingFlow token={params.token} />;
}
