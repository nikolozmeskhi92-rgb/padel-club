import Link from "next/link";
import { pageTitle } from "@/lib/club";
import { requireStaff } from "@/lib/auth/staff";
import { NotificationRecipients } from "@/components/admin/NotificationRecipients";

export const metadata = { title: pageTitle("Booking Alerts") };
export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  await requireStaff("/admin/notifications");

  // Whether an email would actually go out is a server-side fact; the panel
  // says so rather than letting a full-looking list imply it is working.
  // A placeholder key is a non-empty string, so "is it set?" is not the
  // question — .env.local ships with `re_xxxxxxxxxxxx` and checking only for
  // presence is exactly how the site once told customers an email had been sent
  // when none had.
  const key = process.env.RESEND_API_KEY ?? "";
  const emailConfigured =
    key.startsWith("re_") && key.length > 20 && !/^re_x+$/i.test(key);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink">
          Booking alerts
        </h1>
        <Link href="/admin" className="text-sm text-ink-muted hover:text-ink">
          &larr; Dashboard
        </Link>
      </div>

      <div className="mt-6">
        <NotificationRecipients emailConfigured={emailConfigured} />
      </div>
    </div>
  );
}
