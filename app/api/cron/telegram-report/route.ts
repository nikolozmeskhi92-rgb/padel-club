import { NextRequest, NextResponse } from "next/server";
import { sendNightlyTelegramReport } from "@/lib/telegram/sendReport";

/**
 * Configure in vercel.json to run at 23:59 daily:
 * { "crons": [{ "path": "/api/cron/telegram-report", "schedule": "59 23 * * *" }] }
 *
 * Also callable manually from the Admin Dashboard's "Send report now" button —
 * in that case pass a bearer token for the logged-in admin instead of CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    // Fall back to admin-session check for the manual "Send report now" button.
    // (Wire this to your Supabase auth check / role lookup in production.)
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const dateParam = req.nextUrl.searchParams.get("date");
    const date = dateParam ? new Date(dateParam) : new Date();
    const { summary } = await sendNightlyTelegramReport(date);
    return NextResponse.json({ ok: true, summary });
  } catch (err: any) {
    console.error("Telegram report failed:", err);
    return NextResponse.json({ error: "REPORT_FAILED", message: err.message }, { status: 500 });
  }
}
