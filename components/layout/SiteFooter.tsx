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
    <footer className="border-t border-line py-10 text-center sm:text-left">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-7 sm:px-8 text-sm text-ink-muted/80 sm:flex-row">
        <p>© {new Date().getFullYear()} {CLUB_NAME}. All rights reserved.</p>

        <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row sm:gap-6">
          {/*
            Six links in one un-wrapping row is wider than any phone. The row
            was centred, so it overflowed at both ends and the first and last
            links — "Find your booking" and "Staff login", the two people
            actually go looking for — were the ones sliced off. Wrapping costs a
            line on a phone and nothing at all above sm, where they still fit.
          */}
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 sm:flex-nowrap sm:gap-6">
            <a href="/find" className="py-1 hover:text-ink-muted">Find your booking</a>
            <a href="/directions" className="py-1 hover:text-ink-muted">Directions</a>
            <a href="/blog" className="py-1 hover:text-ink-muted">News</a>
            <a href="/privacy" className="py-1 hover:text-ink-muted">Privacy</a>
            <a href="/terms" className="py-1 hover:text-ink-muted">Terms</a>
            <a href="/admin" className="py-1 hover:text-ink-muted">Staff login</a>
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
