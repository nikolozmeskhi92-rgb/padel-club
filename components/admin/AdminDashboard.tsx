"use client";

import Link from "next/link";
import { CourtMap, type CourtMapBooking } from "@/components/courts/CourtMap";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { format } from "date-fns";
import { Send, Download, Lock, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, parseISO } from "date-fns";
import { formatMoney } from "@/lib/pricing";

type DailySummary = {
  date: string;
  court_revenue_cents: number;
  car_wash_revenue_cents: number;
  extras_revenue_cents: number;
  total_revenue_cents: number;
  court_utilization_pct: number;
  wash_utilization_pct: number;
};

type CourtBooking = {
  id: string;
  court_id: number;
  slot: string;
  status: string;
  guest_name: string;
  payment_status: string;
};

type CarWashBooking = {
  id: string;
  bay_id: number;
  slot: string;
  status: string;
  service: string;
  guest_name: string;
};

export function AdminDashboard({
  adminName,
  dailySummaries,
  courtBookingsToday,
  carWashBookingsToday,
  courts,
  gridBookings,
  dateLabel,
  isToday,
}: {
  adminName: string;
  dailySummaries: DailySummary[];
  courtBookingsToday: CourtBooking[];
  carWashBookingsToday: CarWashBooking[];
  courts: { id: number; name: string; indoor: boolean }[];
  gridBookings: CourtMapBooking[];
  dateLabel: string;
  isToday: boolean;
}) {
  const router = useRouter();
  const [sendingReport, setSendingReport] = useState(false);
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  const chartData = dailySummaries.map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    Courts: d.court_revenue_cents / 100,
    "Car wash": d.car_wash_revenue_cents / 100,
    Extras: d.extras_revenue_cents / 100,
  }));

  const occupancyData = dailySummaries.map((d) => ({
    date: format(new Date(d.date), "MMM d"),
    Courts: d.court_utilization_pct,
    "Car wash": d.wash_utilization_pct,
  }));

  const todayTotal = dailySummaries[dailySummaries.length - 1]?.total_revenue_cents ?? 0;

  /** Step the court map a day at a time, staying on the club's calendar. */
  function goToDay(delta: number) {
    const next = addDays(parseISO(dateLabel), delta);
    const key = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(
      next.getDate()
    ).padStart(2, "0")}`;
    router.push(`/admin?date=${key}`);
  }

  async function sendReportNow() {
    setSendingReport(true);
    setReportMsg(null);
    try {
      const res = await fetch("/api/admin/telegram-report-now", { method: "POST" });
      setReportMsg(res.ok ? "Report sent to Telegram ✅" : "Failed to send report.");
    } catch {
      setReportMsg("Failed to send report.");
    } finally {
      setSendingReport(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Date", "Court Revenue", "Car Wash Revenue", "Extras Revenue", "Total"],
      ...dailySummaries.map((d) => [
        d.date,
        (d.court_revenue_cents / 100).toFixed(2),
        (d.car_wash_revenue_cents / 100).toFixed(2),
        (d.extras_revenue_cents / 100).toFixed(2),
        (d.total_revenue_cents / 100).toFixed(2),
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revenue-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted/80">Welcome back, {adminName}</p>
          <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink">Admin Dashboard</h1>
          <Link
            href="/admin/bookings"
            className="mt-3 inline-block rounded-court bg-brand px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
          >
            Manage bookings
          </Link>
        </div>
        <div className="flex gap-3">
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 rounded-court border border-line px-4 py-2 text-sm text-ink-muted hover:border-ink-muted/40"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button
            onClick={sendReportNow}
            disabled={sendingReport}
            className="flex items-center gap-2 rounded-court bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {sendingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Telegram report now
          </button>
        </div>
      </div>
      {reportMsg && <p className="mt-2 text-sm text-brand">{reportMsg}</p>}

      {/* Stat cards */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Today's revenue" value={formatMoney(todayTotal)} />
        <StatCard
          label="Court utilization"
          value={`${dailySummaries[dailySummaries.length - 1]?.court_utilization_pct ?? 0}%`}
        />
        <StatCard
          label="Car wash utilization"
          value={`${dailySummaries[dailySummaries.length - 1]?.wash_utilization_pct ?? 0}%`}
        />
      </div>

      {/* Revenue chart */}
      <div className="mt-8 rounded-court border border-line bg-surface-base shadow-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Revenue — last 14 days</h2>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="courts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0066CC" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#0066CC" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" stroke="#4A5568" fontSize={12} />
            <YAxis stroke="#4A5568" fontSize={12} tickFormatter={(v) => `$${v}`} />
            <Tooltip
              contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10 }}
              labelStyle={{ color: "#001A33" }}
            />
            <Legend />
            <Area type="monotone" dataKey="Courts" stroke="#0066CC" fill="url(#courts)" strokeWidth={2} />
            <Area type="monotone" dataKey="Car wash" stroke="#00BFA5" fillOpacity={0.08} fill="#00BFA5" strokeWidth={2} />
            <Area type="monotone" dataKey="Extras" stroke="#F59E0B" fillOpacity={0.06} fill="#F59E0B" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Occupancy chart */}
      <div className="mt-8 rounded-court border border-line bg-surface-base shadow-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold text-ink">Occupancy rate</h2>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={occupancyData}>
            <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" stroke="#4A5568" fontSize={12} />
            <YAxis stroke="#4A5568" fontSize={12} unit="%" />
            <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #E2E8F0", borderRadius: 10 }} />
            <Legend />
            <Bar dataKey="Courts" fill="#0066CC" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Car wash" fill="#00BFA5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-6">
        <div>
          {/* Any day, not just this one. "Is the 24th busy?" is asked at the
              counter constantly, and the answer used to require the database. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => goToDay(-1)}
              className="rounded-court border border-line bg-surface-base p-1.5 text-ink-muted hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={dateLabel}
              onChange={(e) => e.target.value && router.push(`/admin?date=${e.target.value}`)}
              className="rounded-court border border-line bg-surface-base px-3 py-1.5 text-sm text-ink"
            />
            <button
              type="button"
              aria-label="Next day"
              onClick={() => goToDay(1)}
              className="rounded-court border border-line bg-surface-base p-1.5 text-ink-muted hover:text-ink"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {!isToday && (
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="rounded-court border border-line bg-surface-base px-3 py-1.5 text-sm font-medium text-brand"
              >
                Back to today
              </button>
            )}
            <Link
              href="/admin/notifications"
              className="ml-auto rounded-court border border-line bg-surface-base px-4 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
            >
              Booking alerts
            </Link>
            <Link
              href="/admin/new-booking"
              className="rounded-court bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              New booking
            </Link>
          </div>
          <CourtMap
            title={isToday ? "Court map — today" : "Court map"}
            courts={courts}
            bookings={gridBookings}
            dateLabel={dateLabel}
          />
        </div>
      </div>

      {/* Today's grid + car wash queue */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-court border border-line bg-surface-base shadow-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-ink">
              {isToday ? "Today's courts" : `Courts — ${dateLabel}`}
            </h2>
            <button className="flex items-center gap-1.5 text-xs text-ink-muted/80 hover:text-ink">
              <Lock className="h-3.5 w-3.5" /> Lock a court
            </button>
          </div>
          <div className="space-y-2">
            {courtBookingsToday.length === 0 && (
              <p className="text-sm text-ink-muted/70">No bookings yet today.</p>
            )}
            {courtBookingsToday.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-court border border-line px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">Court {b.court_id} · {b.guest_name}</span>
                <span
                  className={
                    b.status === "confirmed" ? "text-brand" : "text-peak"
                  }
                >
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-court border border-line bg-surface-base shadow-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold text-ink">
            {isToday ? "Car wash queue" : `Car wash — ${dateLabel}`}
          </h2>
          <div className="space-y-2">
            {carWashBookingsToday.length === 0 && (
              <p className="text-sm text-ink-muted/70">No car wash cycles yet today.</p>
            )}
            {carWashBookingsToday.map((b) => (
              <div key={b.id} className="flex items-center justify-between rounded-court border border-line px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">Bay {b.bay_id} · {b.service.replace("_", " ")}</span>
                <span className="text-ink-muted/80">{b.guest_name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-court border border-line bg-surface-base shadow-card p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted/70">{label}</p>
      <p className="mt-2 font-heading text-2xl font-extrabold text-ink">{value}</p>
    </div>
  );
}
