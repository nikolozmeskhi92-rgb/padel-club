"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Check,
  AlertCircle,
  Droplets,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  Home,
  X,
} from "lucide-react";
import { isPeakHour, formatMoney } from "@/lib/pricing";
import { cn } from "@/lib/utils/cn";
import {
  CLOSE_HOUR,
  OPEN_HOUR,
  buildSlotLabels,
  clubDateKey,
  clubHHMM,
  clubWallTimeToInstant,
  PUBLIC_HORIZON_DAYS,
} from "@/lib/time/club";
import type { WashRecommendationResult, WashSuggestion } from "@/lib/carwash/suggest";
import { CourtMap, type CourtMapBooking } from "@/components/courts/CourtMap";
import { useGuestIdentity } from "@/lib/hooks/useGuestIdentity";
import { MonthPicker } from "@/components/booking/MonthPicker";
import { CLUB_PHONE } from "@/lib/club";
import { FcGoogle } from "react-icons/fc";
import { createClient } from "@/lib/supabase/client";

type CourtRow = { id: number; name: string; indoor: boolean };
type BookedSlot = { court_id: number; slot: string; status: string };
type Equipment = { id: number; name: string; price_cents: number };

const COURTS: CourtRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  name: `Court ${i + 1}`,
  indoor: i >= 7,
}));

const EQUIPMENT: Equipment[] = [
  { id: 1, name: "Racket Rental", price_cents: 800 },
  { id: 2, name: "Ball Can (x3)", price_cents: 500 },
  { id: 3, name: "Grip Tape", price_cents: 300 },
];

// Opening hours and the slot grid come from lib/time/club, which the API and
// the wash page read too. They used to be redeclared here, and the wash page
// had its own 07:00-22:00 pair that disagreed with both this and the homepage.
const TIME_SLOTS = buildSlotLabels(30);

const CLOSE_MINUTES = CLOSE_HOUR * 60;

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(mins: number) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

/**
 * People arrive knowing when they want to play, not which court they want.
 * Grouping the day into three periods lets the page open on the part of the day
 * the customer is actually shopping for — previously the 18:00-23:00 block, the
 * busiest and most expensive hours, sat off the right edge of a wide table.
 */
const PERIODS = [
  { id: "morning", label: "Morning", sub: "10:00–12:00", from: 10 * 60, to: 12 * 60 },
  { id: "afternoon", label: "Afternoon", sub: "12:00–17:00", from: 12 * 60, to: 17 * 60 },
  { id: "evening", label: "Evening", sub: "17:00–24:00", from: 17 * 60, to: 24 * 60 },
] as const;

type PeriodId = (typeof PERIODS)[number]["id"];

type Step = "slot" | "extras" | "checkout" | "success";

/**
 * `horizonDays` is how far ahead this caller may book. The public gets a week
 * as a row of day chips; the desk gets a month as a calendar, because a caller
 * says "the 24th" and nobody wants to count chips. The server enforces the same
 * limit — this only decides what is offered.
 */
export function CourtBookingFlow({
  horizonDays = PUBLIC_HORIZON_DAYS,
  staffMode = false,
  initialDateKey,
  initialBookings,
}: {
  horizonDays?: number;
  staffMode?: boolean;
  /** Club day `initialBookings` describes, so a render that crosses midnight
   *  cannot show yesterday's grid as today's. */
  initialDateKey?: string;
  /** Availability fetched during the server render; null if that query failed. */
  initialBookings?: BookedSlot[] | null;
} = {}) {
  const [date, setDate] = useState(new Date());
  const [selectedCourt, setSelectedCourt] = useState<number | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<60 | 90>(60);
  const [booked, setBooked] = useState<BookedSlot[]>(initialBookings ?? []);
  /**
   * Starts true so the server and the first client render agree.
   *
   * Availability, "Passed" labels and the list of remaining slots all depend on
   * the current time, which differs between the server render and hydration —
   * that mismatch threw React #418/#423/#425 and made React discard and re-render
   * the whole tree. Rendering the skeleton until the browser has fetched real
   * availability keeps both passes identical, and there is nothing truthful to
   * show before that fetch anyway.
   */
  // False when the server already handed us today's grid: the first paint has
  // real times on it, so there is no spinner to show and nothing to swap out.
  const [loadingGrid, setLoadingGrid] = useState(
    !(initialDateKey && initialBookings && initialDateKey === clubDateKey(new Date()))
  );
  const [gridError, setGridError] = useState(false);
  const [gridReloadKey, setGridReloadKey] = useState(0);

  /**
   * Availability already fetched, by club date key.
   *
   * The endpoint takes 400-800ms — one hop for the rate-limit check and one for
   * the query — and the day strip invites people to tap along it. Without a
   * cache every tap paid that again, including tapping back to the day you were
   * just on. A cached day paints immediately and revalidates behind the scenes;
   * a booking made against a stale grid is still refused by the database's
   * exclusion constraint, so the worst case is the message it already shows.
   */
  const firstGridLoad = useRef(true);
  /**
   * Set when a selection has just been restored from the return URL.
   *
   * Restoring also sets the date, and the date is what the availability effect
   * keys on — so it re-ran and cleared the very selection that had just been
   * put back. The customer came home from Google to a checkout screen quoting
   * zero. This says: the next load is for a day we already know about, leave
   * the choice alone.
   */
  const preserveSelection = useRef(false);
  const availabilityCache = useRef<Map<string, BookedSlot[]>>(
    new Map(initialDateKey && initialBookings ? [[initialDateKey, initialBookings]] : [])
  );

  /**
   * Keeps whatever the customer is looking at where it is.
   *
   * Choosing a slot resizes the list above the map — a different period has a
   * different number of rows, opening one row inserts the court picker, closing
   * another removes it — and every one of those pushed the map up or down under
   * the finger mid-tap. Safari has no `overflow-anchor`, so the compensation is
   * done by hand: note where an element sits before the state change, and after
   * layout scroll by however far it moved.
   */
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  const anchorTo = (el: HTMLElement | null | undefined) => {
    if (el) anchor.current = { el, top: el.getBoundingClientRect().top };
  };

  // Heights of the two tall blocks, so a day change swaps content of the same
  // size instead of collapsing the page and dropping it back.
  const listBoxRef = useRef<HTMLDivElement>(null);
  const listHeight = useRef(0);
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const mapHeight = useRef(0);
  const [period, setPeriod] = useState<PeriodId>("evening");
  const [step, setStep] = useState<Step>("slot");
  const [oauthLoading, setOauthLoading] = useState(false);

  /**
   * The sheet is a screen, so the device's Back button has to treat it like one.
   *
   * Without this, Back from the checkout sheet leaves /book altogether and the
   * chosen slot goes with it — on a phone that is the most-pressed control on
   * the device, and it was throwing the booking away. Every step into the sheet
   * pushes one history entry; going back pops one and moves one screen back,
   * so Back reads as "up one level" rather than "abandon everything".
   *
   * The counter is what keeps the two in step. Closing from the UI zeroes it
   * *before* unwinding the entries, so the popstate events that unwinding
   * causes are ignored rather than stepping back a second time.
   */
  const sheetDepth = useRef(0);

  function openSheet(next: "extras" | "checkout") {
    if (typeof window !== "undefined") {
      window.history.pushState({ lukiSheet: next }, "");
      sheetDepth.current += 1;
    }
    setStep(next);
  }

  /** Leave the sheet entirely, taking its history entries with it. */
  function closeSheet() {
    const depth = sheetDepth.current;
    sheetDepth.current = 0;
    setStep("slot");
    if (depth > 0 && typeof window !== "undefined") window.history.go(-depth);
  }

  /** One screen back inside the sheet. Driven through history so Back agrees. */
  function sheetBack() {
    if (sheetDepth.current > 0 && typeof window !== "undefined") window.history.back();
    else setStep("extras");
  }

  useEffect(() => {
    function onPop() {
      // Zero means the sheet is already closed and this event is the tail of
      // our own unwinding — or a navigation that has nothing to do with us.
      if (sheetDepth.current === 0) return;
      sheetDepth.current -= 1;
      setStep((s) => (s === "checkout" ? "extras" : "slot"));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSheet();
    }
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The page behind a modal should not scroll. iOS ignores this on <body>, so
   * the sheet also sets overscroll-contain; between them a flick inside the
   * sheet stays inside the sheet. Deliberately not `position: fixed` on the
   * body — that locks scrolling properly but throws the page back to the top
   * when it is released, and losing your place in the day was the complaint
   * that got the scroll anchoring written in the first place.
   */
  useEffect(() => {
    const open = step === "extras" || step === "checkout";
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [step]);

  /**
   * Sign in from checkout without losing the booking.
   *
   * OAuth leaves the site entirely, so anything held only in React state is
   * gone by the time the customer comes back. The choice already made is
   * written into the return URL instead — day, time, court, length — and read
   * back on mount, landing them on the checkout step with the same slot and
   * their details now filled in from the account. Query parameters rather than
   * storage: they survive the round trip, they survive a cold tab, and you can
   * see what went wrong by reading the address bar.
   */
  useEffect(() => {
    if (staffMode || typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("resume") !== "1") return;
    const t = q.get("t");
    const c = Number(q.get("c"));
    const m = Number(q.get("m"));
    const d = q.get("d");
    if (d) {
      const [y, mo, day] = d.split("-").map(Number);
      if (y && mo && day) setDate(new Date(y, mo - 1, day, 12));
    }
    if (t) setSelectedTime(t);
    if (c) setSelectedCourt(c);
    if (m === 60 || m === 90) setDuration(m);
    // Leave the address bar clean so a refresh does not re-trigger this.
    window.history.replaceState(null, "", window.location.pathname);
    if (t && c) {
      preserveSelection.current = true;
      // Comes back straight into the sheet, so it needs the same history entry
      // a tap would have pushed — otherwise Back here leaves /book and undoes
      // the sign-in the customer just did.
      openSheet("checkout");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInFromCheckout() {
    if (!selectedTime || !selectedCourt) return;
    setOauthLoading(true);
    const back = new URL("/book", window.location.origin);
    back.searchParams.set("resume", "1");
    back.searchParams.set("d", clubDateKey(date));
    back.searchParams.set("t", selectedTime);
    back.searchParams.set("c", String(selectedCourt));
    back.searchParams.set("m", String(duration));

    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", back.pathname + back.search);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback.toString() },
    });
    if (error) setOauthLoading(false);
  }
  const [equipment, setEquipment] = useState<Record<number, number>>({});
  // Checkout fills itself: the account's email, and whatever name and phone
  // this person last gave us. See lib/hooks/useGuestIdentity.
  const { guest, setGuest, remember, signedIn } = useGuestIdentity({ enabled: !staffMode });
  // Nothing is charged online yet, so every booking is recorded as settled on
  // site. Restore a real selector when a payment provider is wired up.
  const paymentMethod = "cash" as const;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // --- Car wash cross-sell ---
  const [washResult, setWashResult] = useState<WashRecommendationResult | null>(null);
  const [loadingWash, setLoadingWash] = useState(false);
  // Was a boolean over a single recommended slot. The club sells three washes;
  // the customer now picks which one (or none), so this holds the choice itself.
  const [chosenWash, setChosenWash] = useState<WashSuggestion | null>(null);
  const [washAdded, setWashAdded] = useState(false); // reflected in the success screen
  const [washMissed, setWashMissed] = useState(false); // wanted a wash, lost the bay

  const dayChips = useMemo(
    () => Array.from({ length: horizonDays }, (_, i) => addDays(new Date(), i)),
    [horizonDays]
  );
  const lastBookableDay = useMemo(
    () => addDays(new Date(), horizonDays - 1),
    [horizonDays]
  );

  // A failed availability fetch used to fall back to an empty `booked` list,
  // which renders every slot as free — the customer picks an already-taken
  // court and only finds out at checkout. Failing loudly is the safer default.
  useEffect(() => {
    let cancelled = false;
    const key = clubDateKey(date);
    const cached = availabilityCache.current.get(key);

    // A day already seen paints at once and is checked again in the background,
    // so tapping back along the strip is instant instead of another round trip.
    if (cached) {
      setBooked(cached);
      setGridError(false);
      setLoadingGrid(false);
    } else {
      setLoadingGrid(true);
      setGridError(false);
    }
    // Only when the day actually changes. On the very first run this used to
    // wipe a selection that had just been restored from the return URL after a
    // Google sign-in, which is how the customer came back to a checkout screen
    // quoting zero.
    if (firstGridLoad.current) {
      // Mount. Nothing to clear, and clearing would undo a restore that has
      // already run — the effects above this one go first.
      firstGridLoad.current = false;
    } else if (preserveSelection.current) {
      // The day changed because a restore set it, not because anyone tapped
      // the strip. Spend the flag here, not on the mount run.
      preserveSelection.current = false;
    } else {
      setSelectedCourt(null);
      setSelectedTime(null);
    }

    const load = (dateKey: string, apply: boolean) =>
      fetch(`/api/bookings?date=${dateKey}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`availability ${r.status}`);
          return r.json();
        })
        .then((d) => {
          if (!Array.isArray(d?.bookings)) throw new Error("malformed availability payload");
          availabilityCache.current.set(dateKey, d.bookings);
          if (apply && !cancelled) setBooked(d.bookings);
        });

    load(key, true)
      .catch(() => {
        // A failed revalidation must not blank a grid that is already on screen
        // and correct as of a moment ago.
        if (cancelled || cached) return;
        setBooked([]);
        setGridError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingGrid(false);
        // Warm the neighbours the day strip most likely goes to next. Idle work
        // at 120 requests a minute of headroom, and it makes the next tap free.
        if (!cancelled) {
          for (const offset of [1, -1]) {
            const neighbour = clubDateKey(addDays(date, offset));
            if (!availabilityCache.current.has(neighbour)) load(neighbour, false).catch(() => {});
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clubDateKey(date), gridReloadKey]);

  /**
   * Undo whatever the last state change did to the scroll position.
   *
   * Runs after every render but only does something when a handler asked it to,
   * and before the browser paints — so the block the customer was touching is
   * already back where it was by the time the frame is drawn. "instant" matters:
   * the page sets scroll-behavior: smooth globally, and an animated correction
   * is the very lurch this exists to remove.
   */
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || !a.el.isConnected) return;
    const delta = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(delta) > 1) {
      window.scrollBy({ top: delta, left: 0, behavior: "instant" as ScrollBehavior });
    }
  });

  // Remember how tall each block was while it held real content, so the
  // placeholder that replaces it during a day change is the same size and the
  // page neither collapses nor springs back.
  useLayoutEffect(() => {
    if (loadingGrid) return;
    if (listBoxRef.current) listHeight.current = listBoxRef.current.offsetHeight;
    if (mapBoxRef.current) mapHeight.current = mapBoxRef.current.offsetHeight;
  });

  function isSlotTaken(courtId: number, time: string) {
    const slotStart = slotStartDate(time);
    return booked.some((b) => {
      if (b.court_id !== courtId) return false;
      const [rangeStart, rangeEnd] = parseRange(b.slot);
      return slotStart >= rangeStart && slotStart < rangeEnd;
    });
  }

  /**
   * The instant a "19:00" label refers to, on the CLUB's clock.
   * This used to be `new Date(date); d.setHours(h, m)`, i.e. the *visitor's*
   * clock — someone booking from Berlin picked 19:00 and reserved 21:00 in
   * Tbilisi. Everything downstream (the taken-slot check, pricing, the POST)
   * derives from this one function.
   */
  function slotStartDate(time: string) {
    return clubWallTimeToInstant(clubDateKey(date), time);
  }

  /**
   * A slot is bookable only if EVERY half-hour block it spans is free, it
   * finishes before the club closes, and it hasn't already started.
   *
   * The old grid checked only the starting block, so a 90-minute booking could
   * be selected on top of an existing one and a 22:30 start could run half an
   * hour past closing — both rejected by the server after the customer had
   * filled in the whole checkout form.
   */
  function isCourtFree(courtId: number, time: string, mins: number) {
    const start = toMinutes(time);
    if (start + mins > CLOSE_MINUTES) return false;
    for (let offset = 0; offset < mins; offset += 30) {
      if (isSlotTaken(courtId, toHHMM(start + offset))) return false;
    }
    return true;
  }

  function isPast(time: string) {
    return isSameDay(date, new Date()) && slotStartDate(time).getTime() <= Date.now();
  }

  /** Mirrors the pricing_rules seed data; the server always re-prices on submit. */
  function basePriceFor(time: string, mins: 60 | 90) {
    const d = slotStartDate(time);
    // Mirrors migration 0012: peak is weekday evenings from 19:00 and weekends
    // from noon. The server re-prices on submit, so this only has to agree with
    // the rules for the label to be honest — and when it didn't, the page
    // quoted ₾40 while the server charged ₾80.
    const peak = isPeakHour(d);
    return peak ? (mins === 60 ? 8000 : 12000) : mins === 60 ? 6000 : 9000;
  }

  /**
   * `booked` arrives as Postgres range literals; the map wants two instants.
   * Cancelled rows are filtered by the map itself so one rule covers both views.
   */
  const mapBookings: CourtMapBooking[] = useMemo(
    () =>
      booked.map((b) => {
        const [start, end] = parseRange(b.slot);
        return {
          courtId: b.court_id,
          startIso: start.toISOString(),
          endIso: end.toISOString(),
          status: b.status,
        };
      }),
    [booked]
  );

  /** Half-hours already gone — only meaningful when the chosen day is today. */
  const pastBeforeMinutes = useMemo(() => {
    if (!isSameDay(date, new Date())) return null;
    const now = clubHHMM(new Date());
    return toMinutes(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubDateKey(date), booked]);

  /** Times that can actually be booked today, with the courts free for each. */
  const availability = useMemo(() => {
    const map = new Map<string, CourtRow[]>();
    for (const t of TIME_SLOTS) {
      if (toMinutes(t) + duration > CLOSE_MINUTES) continue;
      if (isPast(t)) continue;
      map.set(t, COURTS.filter((c) => isCourtFree(c.id, t, duration)));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booked, duration, date]);

  /**
   * True when nothing in the period can still be booked today.
   *
   * This used to compare the clock against the period's nominal end, so between
   * the last bookable start and that end — 11:30 and 12:00 for the morning —
   * the label fell through to "Fully booked". That told the customer the courts
   * were taken when the morning was simply over. Ask the real question instead:
   * is there any slot left in this period that could still start?
   */
  function periodHasPassed(from: number, to: number) {
    if (!isSameDay(date, new Date())) return false;
    return !TIME_SLOTS.some((t) => {
      const m = toMinutes(t);
      return m >= from && m < to && m + duration <= CLOSE_MINUTES && !isPast(t);
    });
  }

  const freeByPeriod = useMemo(() => {
    const counts: Record<string, number> = { morning: 0, afternoon: 0, evening: 0 };
    for (const [t, courts] of availability) {
      if (courts.length === 0) continue;
      const m = toMinutes(t);
      const p = PERIODS.find((x) => m >= x.from && m < x.to);
      if (p) counts[p.id] += 1;
    }
    return counts;
  }, [availability]);

  /**
   * Land on a period that has something in it. Evening is the default because
   * that is when most people play, but on a Tuesday at 21:00 — or on a fully
   * booked evening — sending the customer to an empty list is worse than
   * showing them tomorrow morning's options.
   */
  useEffect(() => {
    if (loadingGrid || gridError) return;
    if (freeByPeriod[period] > 0) return;
    const fallback = PERIODS.find((p) => freeByPeriod[p.id] > 0);
    if (fallback) setPeriod(fallback.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeByPeriod, loadingGrid, gridError]);

  // Fetch the car-wash recommendation the moment the customer moves to the
  // extras step — this is when we know the exact court slot to check against.
  useEffect(() => {
    if (step !== "extras" || !selectedTime) return;
    let cancelled = false;
    setLoadingWash(true);
    const courtStart = slotStartDate(selectedTime);

    fetch(`/api/car-wash/suggestions?courtStart=${encodeURIComponent(courtStart.toISOString())}&durationMinutes=${duration}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.result) return;
        const raw = data.result;
        const reviveSuggestion = (s: any): WashSuggestion => ({
          ...s,
          start: new Date(s.start),
          end: new Date(s.end),
        });
        setWashResult({
          tier: raw.tier,
          best: raw.best ? reviveSuggestion(raw.best) : null,
          alternatives: (raw.alternatives ?? []).map(reviveSuggestion),
          perService: (raw.perService ?? []).map(reviveSuggestion),
        });
        // Always off by default. This used to switch itself on for a
        // "perfect_fit" match, which meant picking a court silently added GEL 8
        // to the total — the customer had to notice an extra they never asked
        // for and untick it. An upsell the buyer has to opt out of is the kind
        // of thing that turns into an argument at the desk. Recommend it
        // prominently, but let them choose it.
        setChosenWash(null);
      })
      .catch(() => setWashResult(null))
      .finally(() => !cancelled && setLoadingWash(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedTime, selectedCourt, duration]);

  const price = useMemo(() => {
    if (!selectedTime) return 0;
    const base = basePriceFor(selectedTime, duration);
    const equipTotal = Object.entries(equipment).reduce(
      (sum, [id, qty]) => sum + (EQUIPMENT.find((e) => e.id === Number(id))?.price_cents ?? 0) * qty,
      0
    );
    const washTotal = chosenWash ? chosenWash.service.priceCents : 0;
    return base + equipTotal + washTotal;
  }, [selectedTime, duration, equipment, date, chosenWash]);

  async function submitBooking() {
    if (!selectedCourt || !selectedTime) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId: selectedCourt,
          startTime: slotStartDate(selectedTime).toISOString(),
          durationMinutes: duration,
          guestName: guest.name,
          guestEmail: guest.email,
          guestPhone: guest.phone,
          paymentMethod,
          equipment: Object.entries(equipment)
            .filter(([, qty]) => qty > 0)
            .map(([equipmentId, quantity]) => ({ equipmentId: Number(equipmentId), quantity })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "SLOT_TAKEN") {
          setError("That slot was just taken by someone else — please pick another time.");
        } else if (data.error === "BEYOND_BOOKING_HORIZON") {
          setError(
            `We only take online bookings ${data.horizonDays} days ahead. Get in touch and we'll arrange a date further out.`
          );
        } else {
          setError("Something went wrong. Please try again.");
        }
        setSubmitting(false);
        return;
      }
      setBookingCode(data.booking.booking_code);
      setEmailSent(Boolean(data.emailSent));

      // Now that the booking is real, keep these details for next time — on the
      // account if they are signed in, in this browser if they are not. Doing it
      // here rather than on every keystroke means a half-typed number never
      // becomes the default.
      remember(guest);

      // Cross-sell: if the customer opted into the recommended wash slot,
      // book it now, linked to the court booking that just succeeded.
      // This never blocks the court confirmation — if the wash bay got
      // taken in the last few seconds, the court booking still stands.
      if (chosenWash) {
        try {
          const washRes = await fetch("/api/car-wash-bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bayId: chosenWash.bayId,
              startTime: chosenWash.start.toISOString(),
              service: chosenWash.service.id,
              durationMinutes: chosenWash.service.durationMinutes,
              guestName: guest.name,
              guestEmail: guest.email,
              paymentMethod,
              linkedCourtBookingId: data.booking.id,
            }),
          });
          if (washRes.ok) {
            setWashAdded(true);
          } else {
            // The bay was free when the panel loaded and is not now. The court
            // booking stands either way, but saying nothing would leave someone
            // handing over car keys at a bay that isn't expecting them.
            setWashMissed(true);
          }
        } catch {
          setWashMissed(true);
        }
      }

      // The booking is made, so the sheet's history entries are spent: drop
      // them, or Back from the confirmation would walk the customer through
      // checkout and extras again for a court they have already reserved.
      const depth = sheetDepth.current;
      sheetDepth.current = 0;
      setStep("success");
      if (depth > 0) window.history.go(-depth);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (step === "success" && bookingCode) {
    return (
      <SuccessPanel
        bookingCode={bookingCode}
        email={guest.email}
        washAdded={washAdded}
        washMissed={washMissed}
        emailSent={emailSent}
      />
    );
  }

  return (
    <div
      className={cn(
        "mx-auto max-w-5xl px-7 py-12 sm:px-8",
        // The summary bar is fixed to the bottom of the screen, so on a phone it
        // sat on top of the last rows of the court map: tapping a court down
        // there hit the bar instead of the block, and nothing happened. Give the
        // page the bar's height back so every block stays reachable.
        // Reserved for the whole step, not only while the bar is up: toggling
        // the padding moved the page every time a selection was made or
        // dropped, which is the jump you feel at the moment of tapping.
        step === "slot" && "pb-32"
      )}
    >
      <h1 className="font-heading text-3xl font-extrabold uppercase tracking-tight text-ink md:text-4xl">Book a court</h1>
      <p className="mt-2 text-ink-muted">Pick a day and a time — we&apos;ll show you which courts are free.</p>

      {/* Which day. A week of chips for the public, a calendar for the desk. */}
      {staffMode ? (
        <div className="mt-8 max-w-sm">
          <MonthPicker value={date} onChange={setDate} maxDate={lastBookableDay} />
        </div>
      ) : (
        <>
          <div className="-mx-7 mt-8 flex snap-x snap-mandatory gap-2 overflow-x-auto px-7 pb-2 sm:-mx-8 sm:px-8 [&>*]:snap-start">
            {dayChips.map((d) => (
              <button
                key={d.toISOString()}
                onClick={() => setDate(d)}
                className={cn(
                  "flex min-w-[64px] flex-col items-center rounded-court border px-3 py-2.5 transition-colors",
                  isSameDay(d, date)
                    ? "border-brand bg-brand-accent/10 text-brand"
                    : "border-line text-ink-muted hover:border-ink-muted/30"
                )}
              >
                <span className="text-xs">{format(d, "EEE")}</span>
                <span className="text-lg font-bold">{format(d, "d")}</span>
              </button>
            ))}
          </div>

          {/*
            Say where the window ends and what to do about it. Without this the
            strip simply stops at seven days and the customer is left to guess
            whether the club is closed, full, or not taking bookings.
          */}
          <p className="mt-2 text-xs text-ink-muted">
            Online booking runs to {format(lastBookableDay, "EEEE d MMM")}. For a court
            further out,{" "}
            {CLUB_PHONE ? (
              <a href={`tel:${CLUB_PHONE.replace(/\s/g, "")}`} className="font-semibold text-brand">
                call us on {CLUB_PHONE}
              </a>
            ) : (
              <a href="/directions" className="font-semibold text-brand">
                get in touch
              </a>
            )}{" "}
            and we&apos;ll arrange it.
          </p>
        </>
      )}

      {/* Duration toggle */}
      <div className="mt-6 flex items-center gap-3">
        <span className="text-sm text-ink-muted">Duration:</span>
        {[60, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDuration(d as 60 | 90)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors",
              duration === d
                ? "border-brand bg-brand text-white"
                : "border-line text-ink-muted"
            )}
          >
            {d} min
          </button>
        ))}
      </div>

      {/* Availability could not be loaded — offer nothing rather than slots we
          cannot vouch for. */}
      {gridError && !loadingGrid && (
        <div className="mt-8 rounded-court border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-6 w-6 text-red-500" />
          <p className="mt-3 text-sm font-semibold text-ink">
            We couldn&apos;t load live availability
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Rather than show you slots that might already be taken, we&apos;ve hidden them.
            Try again in a moment.
          </p>
          <button
            onClick={() => setGridReloadKey((k) => k + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-court bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      )}

      {!gridError && (
        <div className="mt-8">
          {/* Period tabs — the whole day in three taps instead of a 30-column scroll */}
          {/*
            A fixed three-up grid, not a wrapping row.

            The sub-label under each tab changes with the day — "13 slots open",
            "Fully booked", "Passed" — and a wider one was enough to push
            Evening onto a second line. The tab row grew by its own height, and
            everything under it, list and map included, dropped 66px. That was
            the whole of the day-switch jump. Three equal columns cannot reflow,
            and equal thumb-sized targets are the better phone layout anyway.
          */}
          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Time of day">
            {PERIODS.map((p) => {
              const count = freeByPeriod[p.id];
              const active = period === p.id;
              return (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={active}
                  disabled={!loadingGrid && count === 0}
                  onClick={(e) => {
                    anchorTo(e.currentTarget.closest("div"));
                    setPeriod(p.id);
                    setSelectedTime(null);
                    setSelectedCourt(null);
                  }}
                  className={cn(
                    "flex flex-col items-start rounded-court border px-3 py-2.5 text-left transition-colors sm:px-4",
                    active
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-surface-base text-ink hover:border-ink-muted/40",
                    !loadingGrid && count === 0 && "cursor-not-allowed opacity-45"
                  )}
                >
                  <span className="text-sm font-semibold">{p.label}</span>
                  <span className={cn("text-xs", active ? "text-white/75" : "text-ink-muted")}>
                    {loadingGrid
                      ? p.sub
                      : count > 0
                      ? `${count} slot${count === 1 ? "" : "s"} open`
                      : periodHasPassed(p.from, p.to)
                      ? "Passed"
                      : "Fully booked"}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Six skeleton rows stood in for anything from four to thirteen real
              ones, so the page grew or shrank by hundreds of pixels the moment
              a day finished loading. The placeholder now holds the height the
              list had a moment ago. */}
          <div
            ref={listBoxRef}
            className="mt-5"
            style={loadingGrid && listHeight.current ? { minHeight: listHeight.current } : undefined}
          >
          {loadingGrid ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-court bg-surface-muted" />
              ))}
            </div>
          ) : (
            <TimeList
              period={period}
              availability={availability}
              duration={duration}
              selectedTime={selectedTime}
              selectedCourt={selectedCourt}
              priceFor={basePriceFor}
              isPeak={(t) => isPeakHour(slotStartDate(t))}
              onBeforeToggle={anchorTo}
              onPickTime={(t) => {
                if (selectedTime === t) {
                  setSelectedTime(null);
                  setSelectedCourt(null);
                  return;
                }
                setSelectedTime(t);
                // Keep the court if it is free at the new time as well.
                //
                // Clearing it unconditionally is what made this take two taps:
                // picking another time dropped the court, the summary bar slid
                // away, and the booking had to be rebuilt from a court chip
                // before Continue came back. Moving an existing choice an hour
                // later is one tap now, and only a court that genuinely cannot
                // take the new slot is given up.
                setSelectedCourt((court) =>
                  court !== null && isCourtFree(court, t, duration) ? court : null
                );
              }}
              onPickCourt={setSelectedCourt}
            />
          )}
          </div>

          {/* The same grid the desk looks at. The list above answers "what can I
              book at seven"; this answers "when is anything free at all", which
              is the question people actually arrive with. Clicking a free block
              picks it, so seeing the gap and taking it is one gesture. */}
          {/* The map used to be unmounted entirely while a day loaded, taking
              ~500px out of the page and putting it back a moment later. It
              keeps its footprint now. */}
          <div ref={mapBoxRef} className="mt-8">
          {loadingGrid ? (
            <div
              className="animate-pulse rounded-court border border-line bg-surface-base"
              style={{ height: mapHeight.current || 420 }}
              aria-busy="true"
            />
          ) : (
            <CourtMap
              title="Live court map"
              courts={COURTS}
              bookings={mapBookings}
              dateLabel={format(date, "EEE d MMM")}
              variant="public"
              pastBeforeMinutes={pastBeforeMinutes}
              // The map asks the flow the same question the flow asks itself,
              // so a block can never look bookable and then refuse the tap.
              isSelectable={(courtId, time) =>
                isCourtFree(courtId, time, duration) && !isPast(time)
              }
              durationMinutes={duration}
              selected={
                selectedCourt && selectedTime
                  ? {
                      courtId: selectedCourt,
                      minutes: toMinutes(selectedTime),
                      spanMinutes: duration,
                    }
                  : null
              }
              onSelect={(courtId, time) => {
                // Only offer what the flow itself would accept: a full free run
                // of `duration`, inside opening hours, not already gone.
                if (!isCourtFree(courtId, time, duration) || isPast(time)) return;
                // Deliberately does NOT move the list above to the matching
                // period. Doing so resized it, which shoved the map — the thing
                // under the finger — and a tap that starts on one element and
                // ends on another is a tap the browser throws away. Nothing
                // needs the two to agree: the choice is shown on the map itself
                // and spelled out in the bar at the bottom of the screen.
                setSelectedTime(time);
                setSelectedCourt(courtId);
              }}
            />
          )}
          </div>
        </div>
      )}


      {/*
        The action bar is always here, never animated, never blurred.

        It used to mount on selection and slide up 80px, over a backdrop blur.
        On iOS that is two well-known ways to lose a tap: Safari can keep
        hit-testing an element at the position it animated *from* until the next
        repaint, and a backdrop-filter on a fixed layer composites separately
        from the layer that receives touches. Either way the first press on
        Continue went nowhere and the second one worked — which is exactly what
        it did.

        A bar that is present for the whole step cannot have a stale hit rect,
        because it never moves. Before a slot is chosen it says what to do and
        the button is disabled, which is also the clearer state to be in: the
        action is visible from the start instead of appearing once you have
        guessed the right gesture. The page already reserves its height, so
        nothing shifts either way.
      */}
      {step === "slot" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-base pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-7 py-3.5 sm:px-8 sm:py-4">
            {selectedCourt && selectedTime ? (
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  Court {selectedCourt} · {format(date, "EEE MMM d")} · {selectedTime}
                </p>
                <p className="text-xs text-ink-muted/80">{duration} min · {formatMoney(price)}</p>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">
                Pick a time to continue
              </p>
            )}
            <button
              type="button"
              disabled={!selectedCourt || !selectedTime}
              onClick={() => openSheet("extras")}
              className={cn(
                "shrink-0 rounded-court px-5 py-3 text-sm font-semibold transition-colors",
                selectedCourt && selectedTime
                  ? "bg-brand text-white active:bg-brand-hover"
                  : "cursor-not-allowed bg-line text-ink-muted/60"
              )}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/*
        The extras / checkout sheet.

        It used to be a panel with no way out. Tapping the dark area behind it
        closed it, but on a phone there was barely any dark area to tap: the
        sheet was `85vh`, and on iOS `vh` is measured with the browser toolbars
        hidden, so 85vh is very nearly the whole visible screen once they are
        showing. The result was a full-screen panel with no close button, no
        back arrow, and a hardware Back that left the booking page entirely.

        What it does now is what a sheet is expected to do:
          - a visible ✕ that closes it, and a ‹ back arrow on checkout that
            returns to extras rather than throwing the whole thing away
          - the grabber, so it reads as something you can dismiss
          - the device's own Back button steps back through it, one screen at a
            time, instead of leaving /book and losing the slot
          - Escape on a keyboard, and the dark area still closes it
          - 85svh, the *small* viewport unit, so a strip of the page behind is
            always visible — that strip is what tells you this is a layer over
            something, not a new page

        Header and body are separate boxes: the header stays put while the body
        scrolls, so the way out never scrolls off the top.
      */}
      <AnimatePresence>
        {(step === "extras" || step === "checkout") && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            /*
              No backdrop-blur. A backdrop-filter on a fixed layer composites
              separately from the layer that receives touches on iOS, which is
              half of why the Continue button used to need two taps. The scrim
              is a plain colour for the same reason.
            */
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center"
            onClick={closeSheet}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="sheet-title"
              /*
                Opacity only, no slide. The same AnimatePresence transform on a
                fixed overlay is what left Safari hit-testing the action bar at
                the position it animated from, so the first tap went nowhere. A
                sheet that fades in is a small loss; a sheet whose buttons eat
                the first tap is the bug we already fixed once.
              */
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[85svh] w-full max-w-lg flex-col rounded-t-court border border-line bg-surface-base shadow-card sm:max-h-[85vh] sm:rounded-court"
            >
              {/* Grabber — the phone's shorthand for "this can be dismissed". */}
              <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden="true">
                <span className="h-1 w-9 rounded-full bg-line" />
              </div>

              <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-2 sm:px-3">
                {step === "checkout" ? (
                  <button
                    type="button"
                    onClick={sheetBack}
                    aria-label="Back to extras"
                    className="flex h-11 w-11 items-center justify-center rounded-court text-ink-muted active:bg-surface-muted"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                ) : (
                  /* Keeps the title centred when there is nothing to go back to. */
                  <span className="h-11 w-11 shrink-0" aria-hidden="true" />
                )}

                <h2
                  id="sheet-title"
                  className="min-w-0 flex-1 truncate text-center font-heading text-base font-bold text-ink"
                >
                  {step === "extras" ? "Anything else?" : "Checkout"}
                </h2>

                <button
                  type="button"
                  onClick={closeSheet}
                  aria-label="Close"
                  className="flex h-11 w-11 items-center justify-center rounded-court text-ink-muted active:bg-surface-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/*
                overscroll-contain stops a flick at the end of this list from
                scrolling the page underneath, which is what makes a sheet feel
                attached to the screen rather than floating over a moving page.
                min-h-0 is what lets it actually scroll inside a flex column.
              */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {step === "extras" && (
                <>
                  <p className="text-sm text-ink-muted/80">Optional — skip if you're all set.</p>
                  <div className="mt-5 space-y-3">
                    {EQUIPMENT.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-court border border-line p-3">
                        <div>
                          <p className="text-sm font-medium text-ink">{item.name}</p>
                          <p className="text-xs text-ink-muted/80">{formatMoney(item.price_cents)}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              setEquipment((prev) => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] ?? 0) - 1) }))
                            }
                            className="h-7 w-7 rounded-full border border-line text-ink"
                          >
                            −
                          </button>
                          <span className="w-4 text-center text-sm">{equipment[item.id] ?? 0}</span>
                          <button
                            onClick={() => setEquipment((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }))}
                            className="h-7 w-7 rounded-full border border-line text-ink"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 border-t border-line pt-5">
                    <WashCrossSell
                      loading={loadingWash}
                      result={washResult}
                      chosen={chosenWash}
                      onChoose={setChosenWash}
                    />
                  </div>

                  <button
                    onClick={() => openSheet("checkout")}
                    className="mt-6 w-full rounded-court bg-brand py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-hover"
                  >
                    Continue to checkout · {formatMoney(price)}
                  </button>
                </>
              )}

              {step === "checkout" && (
                <>
                  {/*
                    Offered here rather than only on a sign-in page, because
                    this is the moment it saves work: three fields already
                    typed, or one tap. A guest booking still goes through
                    untouched below — the club would rather take the booking
                    than insist on an account, so this is a shortcut, not a gate.
                  */}
                  {!signedIn && (
                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={signInFromCheckout}
                        disabled={oauthLoading}
                        className="relative flex w-full items-center justify-center rounded-court border border-line bg-surface-base py-3 text-sm font-semibold text-ink transition-colors hover:border-ink-muted/40 disabled:opacity-50"
                      >
                        <span className="absolute left-4 flex h-5 w-5 items-center justify-center">
                          {oauthLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FcGoogle className="h-5 w-5" />
                          )}
                        </span>
                        Continue with Google
                      </button>
                      <p className="mt-2 text-center text-[11px] text-ink-muted">
                        Fills your details in and keeps this booking in your account.
                        We&apos;ll bring you straight back here.
                      </p>
                      <div className="my-4 flex items-center gap-3">
                        <span className="h-px flex-1 bg-line" />
                        <span className="text-[11px] uppercase tracking-wide text-ink-muted">
                          or book as a guest
                        </span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    </div>
                  )}

                  <div className="mt-5 space-y-3">
                    <input
                      placeholder="Full name"
                      value={guest.name}
                      onChange={(e) => setGuest({ ...guest, name: e.target.value })}
                      className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
                    />
                    <input
                      placeholder="Email"
                      type="email"
                      value={guest.email}
                      readOnly={signedIn}
                      onChange={(e) => setGuest({ ...guest, email: e.target.value })}
                      className={cn(
                        "w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand",
                        signedIn && "cursor-not-allowed text-ink-muted"
                      )}
                    />
                    {signedIn && (
                      <p className="-mt-1 text-[11px] text-ink-muted">
                        Booking as {guest.email} — the confirmation goes to your account.
                      </p>
                    )}
                    <input
                      placeholder="Phone"
                      value={guest.phone}
                      onChange={(e) => setGuest({ ...guest, phone: e.target.value })}
                      className="w-full rounded-court border border-line bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-brand"
                    />

                    {/*
                      BOG / TBC / PayPal buttons used to sit here and charged
                      nothing — no /api/checkout route exists, so the booking
                      was stored `unpaid` while the customer believed they had
                      paid. Hidden until a provider is really wired up.
                    */}
                    <p className="mt-2 rounded-court bg-surface-muted px-4 py-3 text-xs text-ink-muted">
                      Pay at the club when you arrive. We&apos;ll hold the court for you.
                    </p>
                  </div>

                  {error && (
                    <div className="mt-4 flex items-center gap-2 rounded-court border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                      <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                    </div>
                  )}

                  <button
                    disabled={submitting || !guest.name || !guest.email || !guest.phone}
                    onClick={submitBooking}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-court bg-brand py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    Reserve · {formatMoney(price)}
                  </button>
                  <p className="mt-2 text-center text-[11px] text-ink-muted/70">
                    Sandbox mode — no real charge will be made.
                  </p>
                </>
              )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One row per bookable start time: the time, what it costs, and how much of the
 * club is still free. Expanding a row reveals the courts, so choosing a
 * specific court is still one tap away for anyone who cares — but nobody has to
 * scan a 10x30 matrix to find out whether 19:00 is available.
 */
function TimeList({
  period,
  availability,
  duration,
  selectedTime,
  selectedCourt,
  priceFor,
  isPeak,
  onPickTime,
  onPickCourt,
  onBeforeToggle,
}: {
  period: PeriodId;
  availability: Map<string, CourtRow[]>;
  duration: 60 | 90;
  selectedTime: string | null;
  selectedCourt: number | null;
  priceFor: (time: string, mins: 60 | 90) => number;
  isPeak: (time: string) => boolean;
  onPickTime: (time: string) => void;
  onPickCourt: (courtId: number) => void;
  /** Called with the row about to move, so the page can hold it still. */
  onBeforeToggle?: (el: HTMLElement | null) => void;
}) {
  const bounds = PERIODS.find((p) => p.id === period)!;
  const times = Array.from(availability.keys()).filter((t) => {
    const m = toMinutes(t);
    return m >= bounds.from && m < bounds.to;
  });

  if (times.length === 0) {
    return (
      <p className="rounded-court border border-line bg-surface-base px-5 py-8 text-center text-sm text-ink-muted">
        Nothing left this {bounds.label.toLowerCase()} — try another part of the day, or
        pick tomorrow above.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-court border border-line bg-surface-base">
      {times.map((time) => {
        const free = availability.get(time) ?? [];
        const soldOut = free.length === 0;
        const open = selectedTime === time;
        const peak = isPeak(time);

        return (
          <li key={time}>
            <button
              disabled={soldOut}
              aria-expanded={open}
              onClick={(e) => {
                // Opening this row inserts the court picker and closes whichever
                // row was open — which, if that row was above this one, dragged
                // this one out from under the finger. Anchor it first.
                onBeforeToggle?.(e.currentTarget.closest("li"));
                onPickTime(time);
              }}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors sm:gap-5 sm:px-5",
                soldOut ? "cursor-not-allowed opacity-50" : "hover:bg-surface-muted",
                open && "bg-surface-muted"
              )}
            >
              <span className="w-14 shrink-0 font-heading text-lg font-bold tabular-nums text-ink">
                {time}
              </span>

              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                <span className="font-heading text-sm font-bold text-ink">
                  {formatMoney(priceFor(time, duration))}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    peak ? "bg-peak/15 text-peak" : "bg-brand-accent/10 text-brand-accent"
                  )}
                >
                  {peak ? "Peak" : "Off-peak"}
                </span>
              </span>

              <span
                className={cn(
                  "shrink-0 text-xs font-medium sm:text-sm",
                  soldOut ? "text-ink-muted" : free.length <= 2 ? "text-peak" : "text-ink-muted"
                )}
              >
                {soldOut
                  ? "Fully booked"
                  : free.length <= 2
                  ? `Only ${free.length} left`
                  : `${free.length} of ${COURTS.length} free`}
              </span>

              {!soldOut && (
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-ink-muted transition-transform",
                    open && "rotate-180"
                  )}
                />
              )}
            </button>

            {open && !soldOut && (
              <div className="border-t border-line bg-surface-muted px-4 py-4 sm:px-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Choose a court
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {free.map((court) => {
                    const chosen = selectedCourt === court.id;
                    return (
                      <button
                        key={court.id}
                        onClick={() => onPickCourt(court.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-court border px-3.5 py-2 text-sm font-semibold transition-colors",
                          chosen
                            ? "border-brand bg-brand text-white"
                            : "border-line bg-surface-base text-ink hover:border-brand/50"
                        )}
                      >
                        {court.name}
                        {court.indoor && (
                          <span
                            className={cn(
                              "flex items-center gap-1 text-[10px] font-medium uppercase",
                              chosen ? "text-white/75" : "text-ink-muted"
                            )}
                          >
                            <Home className="h-3 w-3" /> Indoor
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}


function parseRange(pgRange: string): [Date, Date] {
  // Postgres tstzrange comes back like: ["2026-09-05 18:00:00+00","2026-09-05 19:00:00+00")
  const match = pgRange.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);
  if (!match) return [new Date(0), new Date(0)];
  return [new Date(match[1]), new Date(match[2])];
}

function SuccessPanel({
  bookingCode,
  email,
  washAdded,
  washMissed,
  emailSent,
}: {
  bookingCode: string;
  email: string;
  washAdded: boolean;
  washMissed: boolean;
  emailSent: boolean;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-7 sm:px-8 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/10">
        <Check className="h-8 w-8 text-brand-accent" />
      </div>
      <h1 className="mt-6 font-heading text-2xl font-extrabold text-ink">Booking confirmed</h1>
      {/*
        This used to promise the email unconditionally. With no RESEND_API_KEY
        nothing is sent, so the customer was told to check an inbox that would
        stay empty — and the booking code on this screen is the only copy they
        have. Say which of the two actually happened.
      */}
      <p className="mt-2 text-ink-muted">
        Code <span className="font-mono text-brand">{bookingCode}</span>
        {emailSent ? (
          <> — a confirmation with your QR check-in code was sent to {email}.</>
        ) : (
          <> — write this down, it is what you check in with.</>
        )}
      </p>
      <p className="mt-3 rounded-court bg-surface-muted px-4 py-2.5 text-sm text-ink-muted">
        Pay at the club when you arrive.
      </p>
      {/* This screen is the only copy of the code for a guest who isn't signed
          in, and it disappears the moment they close the tab. Tell them how to
          get it back before they need to. */}
      <p className="mt-3 text-xs text-ink-muted">
        Lost it later?{" "}
        <a href="/find" className="font-semibold text-brand">
          Find your booking
        </a>{" "}
        with this code and your email.
      </p>
      {washAdded && (
        <p className="mt-4 flex items-center gap-2 rounded-court border border-line bg-brand-accent/5 px-4 py-2.5 text-sm text-ink">
          <Droplets className="h-4 w-4 text-brand-accent" />
          Your car wash is booked too — drop your keys at the bay before you head to the court.
        </p>
      )}
      {washMissed && (
        <p className="mt-4 flex items-center gap-2 rounded-court border border-peak/40 bg-peak/10 px-4 py-2.5 text-sm text-ink">
          <AlertCircle className="h-4 w-4 shrink-0 text-peak" />
          Your court is booked, but the wash bay was taken while you were checking
          out — nothing was charged for it. Ask at the desk when you arrive.
        </p>
      )}
    </div>
  );
}

/**
 * The cross-sell panel, driven entirely by the recommendation engine.
 *
 * Only a wash that actually lines up with the match may be added here. A slot
 * three hours after the customer has driven home is not an add-on, it is a
 * separate errand — offering it as a tick-box is how someone ends up paying for
 * a wash they cannot collect. When nothing fits, the panel says so plainly
 * rather than going quiet.
 */
function WashCrossSell({
  loading,
  result,
  chosen,
  onChoose,
}: {
  loading: boolean;
  result: WashRecommendationResult | null;
  chosen: WashSuggestion | null;
  onChoose: (v: WashSuggestion | null) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking car wash availability…
      </div>
    );
  }

  const all = result?.perService ?? [];
  const bookable = all.filter((o) => o.tier !== "court_only");
  const nearest = all.find((o) => o.tier === "court_only");

  if (all.length === 0) {
    return (
      <div className="rounded-court border border-line bg-surface-muted p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Droplets className="h-4 w-4 text-ink-muted" /> Car wash is fully booked today
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Every bay is taken for the rest of the day, so a wash can&apos;t be added to
          this booking. Your court is unaffected.
        </p>
      </div>
    );
  }

  if (bookable.length === 0) {
    return (
      <div className="rounded-court border border-line bg-surface-muted p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ink">
          <Droplets className="h-4 w-4 text-ink-muted" /> No wash bay is free during your
          match
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          All four bays are busy while you&apos;re playing, so a wash can&apos;t be added
          to this booking.
        </p>
        {nearest && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
            <Clock className="h-3.5 w-3.5" />
            Nearest free slot: Bay {nearest.bayId}, {nearest.service.label},{" "}
            {format(nearest.start, "HH:mm")}–{format(nearest.end, "HH:mm")}
          </p>
        )}
        <a href="/car-wash" className="mt-2 inline-block text-xs font-semibold text-brand">
          Book a wash separately →
        </a>
      </div>
    );
  }

  const notFitting = all.filter((o) => o.tier === "court_only");

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <Droplets className="h-4 w-4 text-brand-accent" />
        Wash your car while you play?
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Drop your keys at the bay — these are the washes that fit around your match.
      </p>

      <div className="mt-3 space-y-2">
        {bookable.map((option) => {
          const picked = chosen?.service.id === option.service.id;
          return (
            <label
              key={option.service.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-court border p-3 transition-colors",
                picked ? "border-brand bg-brand-accent/5" : "border-line bg-surface-muted"
              )}
            >
              <input
                type="radio"
                name="wash-service"
                checked={picked}
                onChange={() => onChoose(option)}
                className="mt-0.5 h-4 w-4 accent-[#0066CC]"
              />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  {option.service.label}
                  <span className="text-ink-muted">{formatMoney(option.service.priceCents)}</span>
                  {option.tier === "perfect_fit" && (
                    <span className="rounded-full bg-brand-accent/10 px-2 py-0.5 text-[10px] font-semibold text-brand-accent">
                      Fits your match
                    </span>
                  )}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-muted">
                  <Clock className="h-3.5 w-3.5" />
                  Bay {option.bayId} &middot; {format(option.start, "HH:mm")}–
                  {format(option.end, "HH:mm")} &middot; {option.service.durationMinutes} min
                </p>
                {/* The engine's own words for why this slot is what it is —
                    "ready 10 min before you finish" is worth more than a badge. */}
                <p className="mt-0.5 text-xs font-medium text-brand-accent">{option.note}</p>
              </div>
            </label>
          );
        })}

        {/* A service whose only free bay falls outside the match still gets
            named, so "where's the full detail?" has an answer on the page. */}
        {notFitting.length > 0 && (
          <p className="px-1 text-[11px] text-ink-muted">
            {notFitting.map((o) => o.service.label).join(", ")}{" "}
            {notFitting.length === 1 ? "has" : "have"} no bay free during your match —
            book separately if you want one.
          </p>
        )}

        <button
          type="button"
          onClick={() => onChoose(null)}
          className={cn(
            "w-full rounded-court border p-3 text-left text-sm transition-colors",
            chosen === null
              ? "border-brand bg-brand-accent/5 font-medium text-ink"
              : "border-line text-ink-muted hover:border-ink-muted/40"
          )}
        >
          No wash this time
        </button>
      </div>
    </div>
  );
}
