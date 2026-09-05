import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";

const interBody = Inter({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-body" });
const jakartaHeading = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Nexus Padel Club — Book Courts & Car Wash",
  description:
    "Book padel courts and a car wash in seconds. Real-time availability, instant confirmation, 10 courts, 4 wash bays.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interBody.variable} ${jakartaHeading.variable}`}>
      <body>
        <SiteHeader />
        <main className="min-h-screen">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
