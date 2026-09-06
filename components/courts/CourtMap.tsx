"use client";

import { useMemo, useState } from "react";
import { CLUB_TIMEZONE, OPEN_HOUR, CLOSE_HOUR } from "@/lib/time/club";
import { cn } from "@/lib/utils/cn";

export type CourtMapBooking = {
  courtId: number;
  startIso: string;
  endIso: string;
  status: string;
  /** Staff view only. Never passed on the public map. */
  guest?: string | null;
  code?: string;
  paymentStatus?: string;
};

export type CourtMapCourt = { id: number; name: string; indoor: boolean };

/**
 * The whole club on one screen: courts down the side, the trading day across.
 *
 * A list of bookings answers "who booked what". It does not answer the question
 * both the desk and the customer actually ask — "is anything free at seven?" —
 * because that means holding ten courts and thirty half-hours in your head at
 * once. A grid answers it at a glance, and the gaps are the point.
 *
 * One component serves both audiences, because two implementations of the same
 * grid drift and then the customer and the desk disagree about what is free.
 * The `variant` decides what a cell is allowed to say: staff see the guest, the
 * code and whether it is paid; the public sees only busy or free.
 */
export function CourtMap({
  courts,
  bookings,
  dateLabel,
  variant = "staff",
  title,
  selected = null,
  onSelect,
  isSelectable,
  durationMinutes,
  pastBeforeMinutes = null,
  className,
}: {
  courts: CourtMapCourt[];
  bookings: CourtMapBooking[];
  dateLabel: string;
  variant?: "staff" | "public";
  title?: string;
  /** Highlighted cell, e.g. the slot the customer has picked in the flow. */
  selected?: { courtId: number; minutes: number; spanMinutes: number } | null;
  /** Public variant only: clicking a free cell hands back the court and "HH:MM". */
  onSelect?: (courtId: number, time: string) => void;
  /**
   * Public variant only: can a booking actually START here?
   *
   * A half-hour being empty is not the same as being bookable. A 60-minute
   * booking needs the next block free too, a 90-minute one the next two, and
   * neither may run past closing. Without this the map painted 17% of its free
   * blocks as clickable and then silently swallowed the tap — you could sit
   * there pressing 18:30 in front of a 19:00 booking and nothing would ever
   * happen. The map now shows those blocks as free but unavailable and says
   * why, instead of pretending and then refusing.
   */
  isSelectable?: (courtId: number, time: string) => boolean;
  /** Shown in the legend so "why is this one grey" has an answer on screen. */
  durationMinutes?: number;
  /** Minutes-since-midnight before which today has already gone. Null for other days. */
  pastBeforeMinutes?: number | null;
  className?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const isPublic = variant === "public";

  // Half-hour columns from opening to closing.
  const slots = useMemo(() => {
    const out: { minutes: number; label: string }[] = [];
    for (let m = OPEN_HOUR * 60; m < CLOSE_HOUR * 60; m += 30) {
      out.push({
        minutes: m,
        label: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
      });
    }
    return out;
  }, []);

  const clubMinutes = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: CLUB_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return (iso: string) => {
      const [h, m] = fmt.format(new Date(iso)).split(":").map(Number);
      return h * 60 + m;
    };
  }, []);

  /** Which booking, if any, covers this court at this half-hour. */
  const cellFor = useMemo(() => {
    const map = new Map<string, CourtMapBooking>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.status === "expired") continue;
      const from = clubMinutes(b.startIso);
      const to = clubMinutes(b.endIso);
      // A booking that ran past midnight would wrap; the club shuts at 23:00,
      // so treat a smaller end as end-of-day rather than silently covering the
      // whole row.
      const end = to > from ? to : CLOSE_HOUR * 60;
      for (let m = from; m < end; m += 30) {
        map.set(`${b.courtId}:${m}`, b);
      }
    }
    return map;
  }, [bookings, clubMinutes]);

  const total = courts.length * slots.length;
  const freeCount = total - cellFor.size;

  function isSelected(courtId: number, minutes: number) {
    if (!selected || selected.courtId !== courtId) return false;
    return minutes >= selected.minutes && minutes < selected.minutes + selected.spanMinutes;
  }

  return (
    <section
      className={cn(
        "rounded-court border border-line bg-surface-base p-5 shadow-card",
        className
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg font-bold text-ink">
          {title ?? "Court map"} — {dateLabel}
        </h2>
        <p className="text-xs text-ink-muted">
          {isPublic
            ? `${freeCount} free half-hours of ${total}`
            : `${freeCount} free half-hours of ${total} · club time`}
        </p>
      </div>

      {/*
        The court names are pinned to the left edge. A phone can only show about
        half the trading day at once, so the names scrolled away with it and you
        were left tapping an unlabelled grid, guessing which row was which court.
      */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[720px] sm:min-w-[900px]">
          {/* Hour ruler. Only whole hours are labelled — a label every half hour
              is unreadable at this width. */}
          <div className="flex">
            <div className="sticky left-0 z-10 w-[4.75rem] shrink-0 bg-surface-base sm:w-24" />
            {slots.map((s) => (
              <div key={s.minutes} className="flex-1 pb-1 text-center text-[10px] text-ink-muted">
                {s.minutes % 60 === 0 ? s.label : ""}
              </div>
            ))}
          </div>

          {courts.map((court) => (
            <div key={court.id} className="flex items-stretch">
              <div className="sticky left-0 z-10 flex w-[4.75rem] shrink-0 items-center gap-1 whitespace-nowrap bg-surface-base py-0.5 pr-2 text-[11px] sm:w-24 sm:gap-1.5 sm:text-xs">
                <span className="font-semibold text-ink">{court.name}</span>
                {court.indoor && (
                  <span className="rounded bg-surface-muted px-1 text-[8px] uppercase text-ink-muted sm:text-[9px]">
                    in
                  </span>
                )}
              </div>

              {slots.map((s) => {
                const key = `${court.id}:${s.minutes}`;
                const b = cellFor.get(key);
                const past = pastBeforeMinutes !== null && s.minutes < pastBeforeMinutes;
                const picked = isSelected(court.id, s.minutes);
                const isHovered = b && b.code && hovered === b.code;
                // Free, but a booking of the chosen length cannot start here.
                const tooShort =
                  isPublic && !b && !past && Boolean(onSelect) && isSelectable
                    ? !isSelectable(court.id, s.label)
                    : false;
                const clickable = isPublic && !b && !past && !tooShort && Boolean(onSelect);

                const label = past
                  ? `${court.name} ${s.label} — gone`
                  : b
                    ? isPublic
                      ? `${court.name} ${s.label} — booked`
                      : `${court.name} ${s.label} — ${b.guest ?? "guest"} (${b.code}, ${b.paymentStatus})`
                    : tooShort
                      ? `${court.name} ${s.label} — free, but not enough room for ${
                          durationMinutes ?? 60
                        } minutes`
                      : `${court.name} ${s.label} — free`;

                const cellClass = cn(
                  "m-[1px] h-7 flex-1 rounded-[3px] border transition-colors",
                  past
                    ? "border-dashed border-line/70 bg-transparent"
                    : b
                      ? isPublic
                        ? "border-ink/20 bg-ink/30"
                        : b.paymentStatus === "paid"
                          ? "border-brand/30 bg-brand/70"
                          : "border-peak/30 bg-peak/60"
                      : tooShort
                        ? "slot-unavailable border-line/70"
                        : "border-line bg-surface-muted/60 hover:bg-brand/10",
                  picked && "border-brand bg-brand ring-2 ring-brand/40",
                  isHovered && "ring-2 ring-ink/40",
                  clickable && "cursor-pointer"
                );

                if (clickable) {
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={label}
                      title={label}
                      onClick={() => onSelect?.(court.id, s.label)}
                      className={cellClass}
                    />
                  );
                }

                return (
                  <div
                    key={key}
                    onMouseEnter={() => setHovered(b?.code ?? null)}
                    onMouseLeave={() => setHovered(null)}
                    title={label}
                    className={cellClass}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-5 rounded-[3px] border border-line bg-surface-muted/60" /> free
        </span>
        {isPublic ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-5 rounded-[3px] border border-ink/20 bg-ink/30" /> booked
            </span>
            {isSelectable && (
              <span className="flex items-center gap-1.5">
                <span className="slot-unavailable h-3 w-5 rounded-[3px] border border-line/70" /> free, too
                short for {durationMinutes ?? 60} min
              </span>
            )}
            {pastBeforeMinutes !== null && (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-5 rounded-[3px] border border-dashed border-line/70" />{" "}
                already gone
              </span>
            )}
            {onSelect && <span>Tap a free block to pick it.</span>}
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-5 rounded-[3px] border border-peak/30 bg-peak/60" /> booked,
              unpaid
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-5 rounded-[3px] border border-brand/30 bg-brand/70" /> booked,
              paid
            </span>
            <span>Hover a block for the guest and code.</span>
          </>
        )}
      </div>
    </section>
  );
}
