import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendNightlyTelegramReport } from "@/lib/telegram/sendReport";

export async function POST() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["staff", "admin"].includes(profile.role)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const { summary } = await sendNightlyTelegramReport(new Date());
    return NextResponse.json({ ok: true, summary });
  } catch (err: any) {
    console.error("Manual Telegram report failed:", err);
    return NextResponse.json({ error: "REPORT_FAILED" }, { status: 500 });
  }
}
