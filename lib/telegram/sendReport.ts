import { format } from "date-fns";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { formatMoneyPlain } from "@/lib/currency";

type DailySummary = {
  court_revenue_cents: number;
  car_wash_revenue_cents: number;
  extras_revenue_cents: number;
  total_revenue_cents: number;
  court_hours_booked: number;
  court_utilization_pct: number;
  wash_cycles: number;
  wash_utilization_pct: number;
  tbc_cents: number;
  bog_cents: number;
  paypal_cents: number;
  retained_cents: number;
};

const money = formatMoneyPlain;

function bar(pct: number, width = 10) {
  const filled = Math.round((Math.min(pct, 100) / 100) * width);
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export function buildReportMessage(date: Date, s: DailySummary) {
  const dateLabel = format(date, "EEEE, MMM d yyyy");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://example.com";

  // Telegram HTML parse mode — keep tags minimal & well-formed.
  return `🎾 <b>Nightly Report — ${dateLabel}</b>

<b>💰 Revenue</b>
Courts:   ${money(s.court_revenue_cents)}
Car Wash: ${money(s.car_wash_revenue_cents)}
Extras:   ${money(s.extras_revenue_cents)}
<b>Total:    ${money(s.total_revenue_cents)}</b>

<b>📊 Utilization</b>
Courts  ${bar(s.court_utilization_pct)} ${s.court_utilization_pct}% (${s.court_hours_booked}h / 150h)
Car Wash ${bar(s.wash_utilization_pct)} ${s.wash_utilization_pct}% (${s.wash_cycles} cycles)

${
  s.retained_cents > 0
    ? `<i>Includes ${money(s.retained_cents)} kept from late cancellations — those courts went unused.</i>\n\n`
    : ""
}<b>💳 Payment methods</b>
TBC:     ${money(s.tbc_cents)}
BOG:     ${money(s.bog_cents)}
PayPal:  ${money(s.paypal_cents)}

<a href="${siteUrl}/admin">Open Admin Dashboard →</a>`;
}

export async function sendNightlyTelegramReport(date: Date = new Date()) {
  const supabase = createServiceRoleClient();
  const dateStr = format(date, "yyyy-MM-dd");

  const { data, error } = await supabase
    .rpc("get_daily_summary", { p_date: dateStr })
    .single();

  if (error || !data) {
    throw new Error(`Failed to compute daily summary: ${error?.message}`);
  }

  const message = buildReportMessage(date, data as DailySummary);
  await sendTelegramMessage(message);
  return { message, summary: data };
}

export async function sendTelegramMessage(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not configured");
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API error (${res.status}): ${body}`);
  }
}
