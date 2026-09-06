import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getStaffUser } from "@/lib/auth/staff";
import { clubDateKey, clubDayBounds, CLUB_TIMEZONE } from "@/lib/time/club";

/**
 * The club's records, as a file it owns.
 *
 * Everything here already exists in Postgres, but "it's in the database" is not
 * the same as the club having it: a hosting account lapses, a project is
 * deleted by accident, a migration goes wrong. A CSV on someone's laptop is the
 * copy that survives all of those, so this exports the rows themselves —
 * cancelled bookings included — rather than only the chart's daily totals.
 *
 * Deliberately server-side. The dashboard used to build its CSV in the browser
 * from whatever the chart happened to be showing, which meant the export could
 * only ever contain what was already on screen.
 */

const DATASETS = ["summary", "bookings", "payments"] as const;
type Dataset = (typeof DATASETS)[number];

/** RFC 4180: quote everything, double the quotes inside. Booking names contain
 *  commas and the occasional quote mark, and one unescaped comma silently
 *  shifts every column after it. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toCsv(header: string[], rows: unknown[][]): string {
  // A BOM so Excel opens UTF-8 correctly — without it Georgian names arrive as
  // mojibake on a Windows machine, which is where this file is going.
  return (
    "﻿" +
    [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

function parseRange(pgRange: string | null): [string, string] {
  if (!pgRange) return ["", ""];
  const m = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
  return m ? [new Date(m[1]).toISOString(), new Date(m[2]).toISOString()] : ["", ""];
}

export async function GET(req: NextRequest) {
  const staff = await getStaffUser();
  if (!staff) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const dataset = (searchParams.get("dataset") ?? "summary") as Dataset;
  if (!DATASETS.includes(dataset)) {
    return NextResponse.json({ error: "UNKNOWN_DATASET" }, { status: 400 });
  }

  const isKey = (v: string | null) => v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isKey(searchParams.get("from")) ? searchParams.get("from")! : null;
  const to = isKey(searchParams.get("to")) ? searchParams.get("to")! : null;
  // No range means everything. That is the point of a backup.
  const all = !from || !to;

  const supabase = createServiceRoleClient();
  let header: string[] = [];
  let rows: unknown[][] = [];
  let name = dataset;

  if (dataset === "summary") {
    if (all) {
      return NextResponse.json({ error: "RANGE_REQUIRED" }, { status: 400 });
    }
    const { data, error } = await supabase.rpc("get_summary_range", {
      p_from: from,
      p_to: to,
    });
    if (error) {
      console.error("summary export failed:", error);
      return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
    }
    header = [
      "Date",
      "Court revenue",
      "Car wash revenue",
      "Extras revenue",
      "Total revenue",
      "Court hours booked",
      "Court utilisation %",
      "Wash cycles",
      "Wash utilisation %",
    ];
    rows = ((data ?? []) as any[]).map((d) => [
      d.day,
      (d.court_revenue_cents / 100).toFixed(2),
      (d.car_wash_revenue_cents / 100).toFixed(2),
      (d.extras_revenue_cents / 100).toFixed(2),
      (d.total_revenue_cents / 100).toFixed(2),
      d.court_hours_booked,
      d.court_utilization_pct,
      d.wash_cycles,
      d.wash_utilization_pct,
    ]);
    name = `summary-${from}_to_${to}`;
  }

  if (dataset === "bookings") {
    const window = all
      ? null
      : `[${clubDayBounds(from!).start.toISOString()},${clubDayBounds(to!).end.toISOString()})`;

    let courtQuery = supabase
      .from("court_bookings")
      .select(
        "booking_code, court_id, slot, duration_minutes, status, payment_status, price_cents, payment_method, guest_name, guest_email, guest_phone, user_id, created_at"
      );
    let washQuery = supabase
      .from("wash_bookings")
      .select(
        "booking_code, bay_id, service, slot, status, payment_status, price_cents, payment_method, guest_name, guest_email, user_id, created_at"
      );
    if (window) {
      courtQuery = courtQuery.overlaps("slot", window);
      washQuery = washQuery.overlaps("slot", window);
    }

    const [{ data: courts, error: cErr }, { data: washes, error: wErr }] = await Promise.all([
      courtQuery,
      washQuery,
    ]);
    if (cErr || wErr) {
      console.error("bookings export failed:", cErr ?? wErr);
      return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
    }

    header = [
      "Kind",
      "Code",
      "Resource",
      "Start",
      "End",
      "Minutes",
      "Status",
      "Payment",
      "Method",
      "Price",
      "Guest",
      "Email",
      "Phone",
      "Has account",
      "Created",
    ];
    // Cancelled rows are included on purpose: an export that quietly drops them
    // cannot answer "what did we refund last month?".
    rows = [
      ...((courts ?? []) as any[]).map((b) => {
        const [start, end] = parseRange(b.slot);
        return [
          "Court",
          b.booking_code,
          `Court ${b.court_id}`,
          start,
          end,
          b.duration_minutes,
          b.status,
          b.payment_status,
          b.payment_method,
          (b.price_cents / 100).toFixed(2),
          b.guest_name,
          b.guest_email,
          b.guest_phone,
          b.user_id ? "yes" : "no",
          b.created_at,
        ];
      }),
      ...((washes ?? []) as any[]).map((b) => {
        const [start, end] = parseRange(b.slot);
        return [
          "Car wash",
          b.booking_code,
          `Bay ${b.bay_id} ${String(b.service).replace(/_/g, " ")}`,
          start,
          end,
          "",
          b.status,
          b.payment_status,
          b.payment_method,
          (b.price_cents / 100).toFixed(2),
          b.guest_name,
          b.guest_email,
          "",
          b.user_id ? "yes" : "no",
          b.created_at,
        ];
      }),
    ].sort((a, b) => String(a[3]).localeCompare(String(b[3])));

    name = all ? "bookings-all" : `bookings-${from}_to_${to}`;
  }

  if (dataset === "payments") {
    let q = supabase
      .from("payments")
      .select("created_at, method, amount_cents, status, provider_ref, court_booking_id, car_wash_booking_id")
      .order("created_at");
    if (!all) {
      q = q
        .gte("created_at", clubDayBounds(from!).start.toISOString())
        .lt("created_at", clubDayBounds(to!).end.toISOString());
    }
    const { data, error } = await q;
    if (error) {
      console.error("payments export failed:", error);
      return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
    }
    header = ["Taken at", "Method", "Amount", "Status", "Reference", "Court booking", "Wash booking"];
    rows = ((data ?? []) as any[]).map((p) => [
      p.created_at,
      p.method,
      (p.amount_cents / 100).toFixed(2),
      p.status,
      p.provider_ref,
      p.court_booking_id,
      p.car_wash_booking_id,
    ]);
    name = all ? "payments-all" : `payments-${from}_to_${to}`;
  }

  const csv = toCsv(header, rows);
  const stamp = clubDateKey(new Date());

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="luki-${name}-exported-${stamp}.csv"`,
      // The club's own data, and it changes by the minute.
      "Cache-Control": "no-store",
      "X-Club-Timezone": CLUB_TIMEZONE,
    },
  });
}
