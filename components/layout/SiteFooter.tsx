import { FaInstagram, FaFacebookF, FaYoutube } from "react-icons/fa6";
import { CLUB_NAME, SOCIAL_LINKS } from "@/lib/club";

/**
 * Brand marks come from react-icons, which ships the official glyphs, rather
 * than being drawn by hand — a redrawn logo is both inaccurate and not ours to
 * redraw. They inherit the footer's own muted colour and lift to the same hover
 * tone as the text links beside them, so the row reads as one set rather than
 * three brands shouting their own colours at the bottom of the page.
 */
const SOCIALS = [
  { key: "instagram", label: "Instagram", href: SOCIAL_LINKS.instagram, Icon: FaInstagram },
  { key: "facebook", label: "Facebook", href: SOCIAL_LINKS.facebook, Icon: FaFacebookF },
  { key: "youtube", label: "YouTube", href: SOCIAL_LINKS.youtube, Icon: FaYoutube },
] as const;

export function SiteFooter() {
  // An icon with no address behind it is worse than no icon: someone taps it,
  // nothing happens, and the club looks broken. Show only what is set.
  const socials = SOCIALS.filter((s) => s.href);

  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-ink-muted/80 sm:flex-row">
        <p>© {new Date().getFullYear()} {CLUB_NAME}. All rights reserved.</p>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
          <div className="flex gap-6">
            <a href="/find" className="hover:text-ink-muted">Find your booking</a>
            <a href="/directions" className="hover:text-ink-muted">Directions</a>
            <a href="/blog" className="hover:text-ink-muted">News</a>
            <a href="/admin" className="hover:text-ink-muted">Staff login</a>
          </div>

          {socials.length > 0 && (
            <div className="flex items-center gap-4 sm:border-l sm:border-line sm:pl-6">
              {socials.map(({ key, label, href, Icon }) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  title={label}
                  className="text-ink-muted/80 transition-colors hover:text-brand"
                >
                  <Icon className="h-[18px] w-[18px]" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
