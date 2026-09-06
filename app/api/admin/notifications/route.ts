import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getStaffUser } from "@/lib/auth/staff";

/**
 * Who gets told about new bookings.
 *
 * The list lives in the database rather than the environment because it
 * changes — a manager starts, someone leaves, the owner wants their personal
 * address on it for a week — and none of that should need a redeploy.
 *
 * Every method is staff-only: these are the club's private addresses.
 */

const AddSchema = z.object({
  email: z.string().trim().email().max(200),
  label: z.string().trim().max(80).optional(),
});

const PatchSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export async function GET() {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .select("id, email, label, active, created_at")
    .order("created_at");

  if (error) {
    console.error("recipients read failed:", error);
    return NextResponse.json({ error: "READ_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ recipients: data ?? [] });
}

export async function POST(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .insert({
      // Stored lowercase so the unique index and the human eye agree about
      // whether Nika@ and nika@ are the same inbox.
      email: parsed.data.email.toLowerCase(),
      label: parsed.data.label || null,
    })
    .select("id, email, label, active, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "ALREADY_ON_LIST" }, { status: 409 });
    }
    console.error("recipient insert failed:", error);
    return NextResponse.json({ error: "ADD_FAILED" }, { status: 500 });
  }
  return NextResponse.json({ recipient: data }, { status: 201 });
}

/** Switch an address on or off without losing it — holidays end. */
export async function PATCH(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .update({ active: parsed.data.active })
    .eq("id", parsed.data.id)
    .select("id, email, label, active")
    .maybeSingle();

  if (error) {
    console.error("recipient update failed:", error);
    return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ recipient: data });
}

export async function DELETE(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("notification_recipients")
    .delete()
    .eq("id", id)
    .select("email")
    .maybeSingle();

  if (error) {
    console.error("recipient delete failed:", error);
    return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ removed: data.email });
}
