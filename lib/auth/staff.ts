import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export type StaffUser = {
  id: string;
  email: string | null;
  fullName: string;
  role: "staff" | "admin";
};

/**
 * The one place that decides who counts as staff.
 *
 * /admin did this inline, and every new admin page would have copied it —
 * which is how one of them eventually ends up checking `role === 'admin'` and
 * silently locking out the staff, or forgetting the check altogether. Pages
 * call this; API routes call `getStaffUser` and answer 403 themselves rather
 * than redirecting, since a fetch has nowhere to redirect to.
 */
export async function getStaffUser(): Promise<StaffUser | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !["staff", "admin"].includes(profile.role)) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    fullName: profile.full_name ?? user.email ?? "Staff",
    role: profile.role as "staff" | "admin",
  };
}

/** For pages: sends the signed-out to /login and the merely-signed-in home. */
export async function requireStaff(returnTo: string): Promise<StaffUser> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);

  const staff = await getStaffUser();
  // Signed in but not staff: send them home rather than to the login page,
  // which would suggest their sign-in had failed when it plainly worked.
  if (!staff) redirect("/");
  return staff;
}
