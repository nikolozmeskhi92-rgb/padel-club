import { CancelBookingFlow } from "@/components/booking/CancelBookingFlow";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cancel your booking",
  robots: { index: false, follow: false },
};

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CancelBookingFlow token={token} />;
}
