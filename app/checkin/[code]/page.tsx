import { createServiceRoleClient } from "@/lib/supabase/server";
import { format } from "date-fns";
import { CheckCircle2, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CheckinPage({ params }: { params: { code: string } }) {
  const supabase = createServiceRoleClient();

  const { data: courtBooking } = await supabase
    .from("court_bookings")
    .select("*, courts(name)")
    .eq("booking_code", params.code)
    .maybeSingle();

  const { data: washBooking } = courtBooking
    ? { data: null }
    : await supabase
        .from("wash_bookings")
        .select("*, wash_bays(name)")
        .eq("booking_code", params.code)
        .maybeSingle();

  const booking = courtBooking ?? washBooking;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 text-center">
      {booking ? (
        <>
          <CheckCircle2 className="h-12 w-12 text-brand-accent" />
          <h1 className="mt-4 font-heading text-2xl font-extrabold text-ink">
            {courtBooking ? courtBooking.courts?.name : washBooking?.wash_bays?.name}
          </h1>
          <p className="mt-2 text-ink-muted">
            {booking.guest_name} · {format(new Date(booking.slot?.split(",")[0]?.replace(/[[("]/g, "")), "MMM d, HH:mm")}
          </p>
          <p className="mt-1 text-sm capitalize text-ink-muted/80">
            Status: {booking.status} · Payment: {booking.payment_status}
          </p>
        </>
      ) : (
        <>
          <XCircle className="h-12 w-12 text-red-400" />
          <h1 className="mt-4 font-heading text-2xl font-extrabold text-ink">Booking not found</h1>
          <p className="mt-2 text-ink-muted">Code {params.code} doesn't match any booking.</p>
        </>
      )}
    </div>
  );
}
