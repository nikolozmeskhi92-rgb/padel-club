import { CLUB_NAME } from "@/lib/club";
import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";


export const metadata: Metadata = {
  title: `${CLUB_NAME} — Book Courts & Car Wash`,
  description:
    "Book padel courts and a car wash in seconds. Real-time availability, instant confirmation, 10 courts, 4 wash bays.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          The two faces the first screen actually paints with: the extrabold
          heading and the regular body text. Without this the browser only
          discovers them after it has parsed the CSS and laid out the text that
          needs them, which is a whole round trip too late — long enough to see
          the headline redrawn. Preloading starts both downloads alongside the
          HTML. The rest of the weights are not preloaded on purpose; they load
          behind the metric-matched fallbacks and arrive without moving anything.
        */}
        <link
          rel="preload"
          href="/fonts/plus-jakarta-sans-latin-800-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/inter-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <SiteHeader />
        <main className="min-h-screen">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
