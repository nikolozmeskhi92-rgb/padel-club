import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Every way of arriving signed in ends up here.
 *
 * Three things land on this route and all of them have to leave with a session
 * cookie, which is why it cannot be a client component — cookies have to be
 * set on a real response:
 *
 *   - an OAuth provider, returning with `code`
 *   - the link in a confirm-your-email message
 *   - the link in a reset-your-password message, on its way to /reset-password
 *
 * The two email links can arrive in either of two shapes depending on what the
 * Supabase email templates are set to. `code` is the PKCE flow and is what the
 * default templates produce; `token_hash` + `type` is what a template using
 * {{ .TokenHash }} produces, and it is worth knowing that only the second one
 * survives being opened on a different device from the one that asked for it —
 * PKCE keeps its verifier in the browser that started the flow, so a link
 * opened on a phone after signing up on a laptop fails. Both are handled, so
 * the templates can be changed later without touching this file.
 *
 * Register this path in each OAuth provider as
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
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type") as EmailOtpType | null;

  if (!code && !(tokenHash && otpType)) {
    return NextResponse.redirect(`${origin}/login?error=No%20sign-in%20code%20was%20returned.`);
  }

  const supabase = await createServerSupabase();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: otpType!, token_hash: tokenHash! });

  if (error) {
    /*
      An expired or already-used link is the common case here, not a bug, and
      it deserves a way forward rather than a raw error string. Recovery links
      last an hour and work once; a confirmation link opened twice is the
      second click on the same email.
    */
    if (otpType === "recovery" || next === "/reset-password") {
      return NextResponse.redirect(`${origin}/forgot-password`);
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // A confirmed signup goes back to the sign-in page's success notice unless
  // it was told somewhere better to be, so the person sees that it worked.
  if (!next && (otpType === "signup" || otpType === "email")) {
    return NextResponse.redirect(`${origin}/account`);
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
