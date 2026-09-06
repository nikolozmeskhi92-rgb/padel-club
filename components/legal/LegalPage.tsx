import Link from "next/link";
import { CLUB_NAME } from "@/lib/club";

/**
 * Shared shell for the two legal pages.
 *
 * Plain prose on purpose. These are the pages someone opens when they are
 * already slightly uneasy about handing over a phone number, so hedged,
 * lawyerly language is exactly the wrong tone: it reads as something to hide
 * behind. Short sentences, and every claim one the club can actually keep.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-7 sm:px-8 py-14">
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">Last updated {updated}</p>

      <div className="mt-8 space-y-8 text-sm leading-relaxed text-ink-muted [&_a]:font-semibold [&_a]:text-brand [&_h2]:mb-1 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_li]:mt-1.5 [&_p]:mt-2 [&_strong]:text-ink [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>

      <div className="mt-12 border-t border-line pt-6 text-sm">
        <Link href="/" className="font-semibold text-brand">
          &larr; Back to {CLUB_NAME}
        </Link>
      </div>
    </div>
  );
}
