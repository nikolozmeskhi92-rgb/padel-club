import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const metadata = { title: "Admin Dashboard — Nexus Padel Club" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = createServerSupabase();
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

  // Last 14 days of aggregated revenue for the chart (server-side RPC call, one per day
  // kept simple here — in production wrap this in a single SQL view for efficiency).
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });

  const summaries = await Promise.all(
    days.map(async (date) => {
      const { data } = await supabase.rpc("get_daily_summary", { p_date: date }).single();
      return { date, ...(data as any) };
    })
  );

  const { data: todaysCourtBookings } = await supabase
    .from("court_bookings")
    .select("id, court_id, slot, status, guest_name, payment_status")
    .gte("slot", new Date().toISOString().slice(0, 10))
    .in("status", ["pending", "confirmed"]);

  const { data: todaysCarWash } = await supabase
    .from("wash_bookings")
    .select("id, bay_id, slot, status, service, guest_name")
    .gte("slot", new Date().toISOString().slice(0, 10))
    .in("status", ["pending", "confirmed"]);

  return (
    <AdminDashboard
      adminName={profile.full_name ?? "Admin"}
      dailySummaries={summaries}
      courtBookingsToday={todaysCourtBookings ?? []}
      carWashBookingsToday={todaysCarWash ?? []}
    />
  );
}
