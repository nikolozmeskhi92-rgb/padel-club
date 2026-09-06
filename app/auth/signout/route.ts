import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Sign out. A POST, not a link: a GET would let any page on the internet log
 * the user out with an <img src>, and browsers pre-fetching links would do it
 * by accident.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : new URL(req.url).origin;

  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
