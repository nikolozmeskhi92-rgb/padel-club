import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";


export const metadata: Metadata = {
  title: "Nexus Padel Club — Book Courts & Car Wash",
  description:
    "Book padel courts and a car wash in seconds. Real-time availability, instant confirmation, 10 courts, 4 wash bays.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main className="min-h-screen">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
