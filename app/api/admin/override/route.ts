import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase, createServiceRoleClient } from "@/lib/supabase/server";

const OverrideSchema = z.object({
  resourceType: z.enum(["court", "wash_bay"]),
  resourceId: z.number().int(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  reason: z.string().min(2),
  status: z.enum(["maintenance", "blocked"]).default("maintenance"),
});

export async function POST(req: NextRequest) {
  const sessionClient = createServerSupabase();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const { data: profile } = await sessionClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["staff", "admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const parsed = OverrideSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  const { resourceType, resourceId, startTime, endTime, reason, status } = parsed.data;

  // Use the service-role client to also block the underlying court_bookings /
  // wash_bookings tables for the same window, so the public booking grid
  // reflects the lock immediately (a "maintenance" pseudo-booking).
  const supabase = createServiceRoleClient();

  const { error: overrideError } = await supabase.from("availability_overrides").insert({
    resource_type: resourceType,
    resource_id: resourceId,
    range: `[${startTime},${endTime})`,
    reason,
    status,
    created_by: user.id,
  });

  if (overrideError) {
    return NextResponse.json({ error: "OVERRIDE_FAILED", details: overrideError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
