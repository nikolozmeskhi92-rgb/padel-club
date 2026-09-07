/**
 * Turning what Supabase says into something a customer can act on.
 *
 * The club reported that sign-up "sent one email and then stopped sending".
 * It had: the second attempt came back 429 `over_email_send_rate_limit`, and
 * the page printed Supabase's own words — "email rate limit exceeded" — which
 * tells a customer nothing about what to do and reads like the site is broken.
 *
 * The cause is not in this codebase. Supabase's built-in email sender allows
 * **two messages an hour** across the whole project; it exists for development
 * and the docs say so. Configuring custom SMTP (Authentication → Emails → SMTP
 * Settings) replaces it and the limit becomes the provider's. Until that is
 * done, every third person to sign up in an hour hits this, so the message has
 * to be honest about the wait rather than pretending something failed.
 */

type SupabaseLikeError = { message?: string; code?: string; status?: number } | null | undefined;

export const RATE_LIMITED_MESSAGE =
  "We can't send another email just yet — too many have gone out in the last hour. Try again in a few minutes.";

/**
 * Whether this failure is the mail quota rather than anything the person did.
 *
 * Matched on the error code first and the message second: the code is the
 * stable contract, the wording is not, and older releases sent only the
 * sentence.
 */
export function isEmailRateLimit(error: SupabaseLikeError): boolean {
  if (!error) return false;
  if (error.code === "over_email_send_rate_limit") return true;
  if (error.status === 429) return true;
  return /rate limit/i.test(error.message ?? "");
}

/**
 * What to show the person. Falls back to Supabase's own sentence, because a
 * vague "something went wrong" is worse than a specific message we did not
 * anticipate — but the cases we know about are worth translating.
 */
export function authErrorMessage(error: SupabaseLikeError): string {
  if (!error) return "Something went wrong. Please try again.";

  if (isEmailRateLimit(error)) return RATE_LIMITED_MESSAGE;

  const message = error.message ?? "";

  // "For security purposes, you can only request this after 51 seconds."
  // Supabase's per-address cooldown. Its own wording is already clear and
  // carries the number, so it is passed through rather than flattened.
  if (/only request this after/i.test(message)) return message;

  if (/password.*(short|least)/i.test(message)) {
    return "That password is too short for this site's minimum.";
  }
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match an account.";
  }
  if (/email.*not confirmed/i.test(message)) {
    return "This account hasn't been confirmed yet. Open the link in your email first.";
  }
  if (/user already registered/i.test(message)) {
    // Should not reach a customer — the sign-up page deliberately shows the
    // same screen either way — but if it ever does, it must not confirm that
    // the address is registered here.
    return "We couldn't complete that. Try signing in instead.";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }

  return message || "Something went wrong. Please try again.";
}
