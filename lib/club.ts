/**
 * The club's identity, in one place.
 *
 * The name used to be typed out in eleven files — every page's metadata, the
 * header, the footer, the email template, the blog author — while
 * NEXT_PUBLIC_CLUB_NAME sat in the environment being read by almost nothing.
 * Renaming the club meant finding all eleven and missing at least one.
 *
 * Set NEXT_PUBLIC_CLUB_NAME / NEXT_PUBLIC_CLUB_ADDRESS in .env.local; these are
 * the fallbacks.
 */
export const CLUB_NAME = process.env.NEXT_PUBLIC_CLUB_NAME || "Luki Padel";
export const CLUB_ADDRESS = process.env.NEXT_PUBLIC_CLUB_ADDRESS || "Tbilisi";

/**
 * The number the club answers. Deliberately empty by default: a page that
 * shows an invented phone number is worse than one that says "get in touch",
 * because someone will dial it. Set NEXT_PUBLIC_CLUB_PHONE and the "book
 * further ahead" notice becomes a tap-to-call link.
 */
export const CLUB_PHONE = process.env.NEXT_PUBLIC_CLUB_PHONE || "";

/**
 * The club's social accounts.
 *
 * Env-driven and empty by default. An icon with no address behind it is worse
 * than no icon — someone taps it, nothing happens, and the club looks broken —
 * so the footer shows a link only once its URL is set. Fill these in
 * .env.local and they appear:
 *
 *   NEXT_PUBLIC_INSTAGRAM_URL=https://instagram.com/...
 *   NEXT_PUBLIC_FACEBOOK_URL=https://facebook.com/...
 *   NEXT_PUBLIC_YOUTUBE_URL=https://youtube.com/@...
 */
export const SOCIAL_LINKS = {
  instagram: process.env.NEXT_PUBLIC_INSTAGRAM_URL || "",
  facebook: process.env.NEXT_PUBLIC_FACEBOOK_URL || "",
  youtube: process.env.NEXT_PUBLIC_YOUTUBE_URL || "",
} as const;

/** "<page> — Luki Padel", so every tab title is built the same way. */
export function pageTitle(page: string): string {
  return `${page} — ${CLUB_NAME}`;
}

/**
 * The wordmark is set in two weights: everything but the last word, then the
 * last word in the brand colour ("LUKI **PADEL**"). Splitting on the final
 * space keeps that treatment working whatever the club is called.
 */
export function wordmarkParts(): { lead: string; accent: string } {
  const words = CLUB_NAME.trim().split(/\s+/);
  if (words.length === 1) return { lead: "", accent: words[0] };
  return { lead: words.slice(0, -1).join(" "), accent: words[words.length - 1] };
}
