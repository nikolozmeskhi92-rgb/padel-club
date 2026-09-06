import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Where an OAuth provider sends the browser back to.
 *
 * Supabase redirects here with a `code`; that code is exchanged for a session
 * and written into cookies by the server client. Until that exchange happens
 * the user is not signed in, which is why this cannot be a client component —
 * the cookies have to be set on a real response.
 *
 * Register this path in each provider as
 * `https://<project-ref>.supabase.co/auth/v1/callback` — the provider talks to
 * Supabase, and Supabase forwards here.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // Behind a proxy (Vercel) the request's own host is internal, so prefer the
  // forwarded one; otherwise the redirect would leave the public domain.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : url.origin;

  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");

  // Providers report refusals here too — a declined consent screen arrives as
  // `error`, not as a missing code, and silently bouncing to the login page
  // with no reason is how you get "it just doesn't work" bug reports.
  const providerError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`
    );
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=No%20sign-in%20code%20was%20returned.`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // An explicit `next` wins. Otherwise send staff to the dashboard and everyone
  // else home — a customer who lands on /admin only to be redirected away has
  // been told, confusingly, that signing in didn't work.
  if (next) return NextResponse.redirect(`${origin}${next}`);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (profile && ["staff", "admin"].includes(profile.role)) {
      return NextResponse.redirect(`${origin}/admin`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
