import Link from "next/link";
import { pageTitle } from "@/lib/club";
import { requireStaff } from "@/lib/auth/staff";
import { isEmailConfigured } from "@/lib/email/send";
import { NotificationRecipients } from "@/components/admin/NotificationRecipients";

export const metadata = { title: pageTitle("Booking Alerts") };
export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  await requireStaff("/admin/notifications");

  // Whether an email would actually go out is a server-side fact; the panel
  // says so rather than letting a full-looking list imply it is working.
  // One definition of "configured", shared with the code that actually sends,
  // so the panel can never say one thing while the sender does another.
  const emailConfigured = isEmailConfigured();

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
