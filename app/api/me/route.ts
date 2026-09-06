import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The signed-in visitor's own contact details, and nothing else.
 *
 * Checkout used to start blank for everyone, including people who had just
 * signed in with Google — we already knew their email and their name and asked
 * for them anyway. This endpoint is what lets the form fill itself.
 *
 * It reads the SESSION client, not the service-role client, so it can only
 * ever return the caller's own row: there is no id parameter to tamper with.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ signedIn: false, email: "", name: "", phone: "" });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, phone")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.json({
    signedIn: true,
    email: user.email ?? "",
    // The provider's name is a decent first guess, but whatever the customer
    // last typed at checkout wins — it is the one they chose to be called.
    name: profile?.full_name ?? (user.user_metadata?.full_name as string) ?? "",
    phone: profile?.phone ?? "",
  });
}

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(6).max(40).optional(),
});

/**
 * Remember what the customer typed, so the next booking doesn't ask again.
 * Email is deliberately not writable here — it is the identity the account was
 * created with, and changing it belongs to the auth provider, not a booking form.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Not an error worth shouting about: guests remember their details in the
    // browser instead, and the caller treats this as "nothing to save".
    return NextResponse.json({ saved: false }, { status: 200 });
  }

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

  const patch: Record<string, string> = {};
  if (parsed.data.name) patch.full_name = parsed.data.name;
  if (parsed.data.phone) patch.phone = parsed.data.phone;
  if (Object.keys(patch).length === 0) return NextResponse.json({ saved: false });

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) {
    console.error("profile update failed:", error);
    return NextResponse.json({ error: "SAVE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ saved: true });
}
