import { CLUB_NAME } from "@/lib/club";
export function SiteFooter() {
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-ink-muted/80 sm:flex-row">
        <p>© {new Date().getFullYear()} {CLUB_NAME}. All rights reserved.</p>
        <div className="flex gap-6">
          <a href="/directions" className="hover:text-ink-muted">Directions</a>
          <a href="/blog" className="hover:text-ink-muted">News</a>
          <a href="/admin" className="hover:text-ink-muted">Staff login</a>
        </div>
      </div>
    </footer>
  );
}
