import { wordmarkParts } from "@/lib/club";

const wordmark = wordmarkParts();
import Link from "next/link";

const NAV = [
  { href: "/book", label: "Courts" },
  { href: "/car-wash", label: "Car wash" },
  { href: "/blog", label: "News" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="font-heading text-lg font-extrabold tracking-tight text-ink">
          {wordmark.lead} <span className="text-brand">{wordmark.accent}</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden text-sm text-ink-muted transition-colors hover:text-ink sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/book"
            className="rounded-court bg-brand px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            Book a court
          </Link>
        </div>
      </div>
    </header>
  );
}
