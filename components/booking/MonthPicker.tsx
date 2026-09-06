"use client";

import { useMemo, useState } from "react";
import { addDays, addMonths, format, isSameDay, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A month at a time, for the desk.
 *
 * A row of seven day-buttons works for a customer choosing "this week"; it
 * stops working the moment the horizon is thirty days, because a caller says
 * "the 24th" and nobody wants to count chips. A calendar answers "the 24th"
 * directly, and shows the shape of the month — which weekends are still ahead —
 * that a strip cannot.
 */
export function MonthPicker({
  value,
  onChange,
  maxDate,
}: {
  value: Date;
  onChange: (d: Date) => void;
  /** Last bookable day, inclusive. Days past it are shown but not selectable. */
  maxDate: Date;
}) {
  const [month, setMonth] = useState(() => startOfMonth(value));
  const today = useMemo(() => new Date(), []);

  // Six weeks always, starting on the Monday on or before the 1st, so the grid
  // never changes height as you page through months.
  const days = useMemo(() => {
    const first = startOfMonth(month);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const gridStart = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [month]);

  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const lastDay = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());

  return (
    <div className="rounded-court border border-line bg-surface-base p-4 shadow-card">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          className="rounded-court border border-line p-1.5 text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="font-heading text-sm font-bold text-ink">{format(month, "MMMM yyyy")}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          className="rounded-court border border-line p-1.5 text-ink-muted hover:text-ink"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-ink-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const outsideMonth = d.getMonth() !== month.getMonth();
          const bookable = d >= startOfToday && d <= lastDay;
          const selected = isSameDay(d, value);
          return (
            <button
              key={d.toISOString()}
              type="button"
              disabled={!bookable}
              onClick={() => onChange(d)}
              className={cn(
                "aspect-square rounded-court border text-sm transition-colors",
                selected
                  ? "border-brand bg-brand font-bold text-white"
                  : bookable
                    ? "border-line text-ink hover:border-brand/50 hover:bg-brand-accent/5"
                    : "border-transparent text-ink-muted/35",
                outsideMonth && !selected && "opacity-50"
              )}
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-ink-muted">
        Bookable through {format(lastDay, "EEE d MMM")}.
      </p>
    </div>
  );
}
