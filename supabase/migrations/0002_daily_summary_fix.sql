-- =========================================================
-- FIX: nightly financial report never reconciled
--
-- In 0001, get_daily_summary() computed revenue/utilization from the BOOKING
-- date (lower(slot)::date) but the payment-method split from the PAYMENT date
-- (payments.created_at::date). Since almost every booking is paid for before
-- the day it is played, the two halves of the report described different days:
--
--   get_daily_summary('2026-09-10') -> total 6400, tbc 0,    bog 0
--   get_daily_summary('2026-09-05') -> total 0,    tbc 4000, bog 800
--
-- so "Total" and "Payment methods" in the Telegram report could never add up.
-- Both halves now key off the day of play.
--
-- Three further corrections:
--
--   * EQUIPMENT WAS COUNTED TWICE. The booking API sets
--     court_bookings.price_cents to court time + equipment (it is the amount
--     actually charged, and what confirm_booking writes to payments), while
--     `extras` summed the same equipment again out of booking_equipment.
--     A booking charged 5600 (4000 court + 1600 rackets) reported as 7200.
--     `court_revenue_cents` is now court time alone -- the gross minus its own
--     add-ons -- so the three revenue lines sum to what the customer paid.
--
--   * refunded / failed / unpaid rows in `payments` were counted as income;
--     only `status = 'paid'` counts now.
--
--   * `::date` was evaluated in the server's timezone (UTC on Vercel). The
--     club's day is now converted explicitly to local time, so p_date always
--     means a local calendar day regardless of where this runs.
-- =========================================================

-- Single place to change the club's timezone. IMMUTABLE so it can be used in
-- indexes later if the booking tables ever need a date-keyed index.
create or replace function club_timezone() returns text
language sql immutable parallel safe
as $$ select 'Asia/Tbilisi'::text $$;

create or replace function get_daily_summary(p_date date)
returns table (
  court_revenue_cents bigint,
  car_wash_revenue_cents bigint,
  extras_revenue_cents bigint,
  total_revenue_cents bigint,
  court_hours_booked numeric,
  court_utilization_pct numeric,
  wash_cycles int,
  wash_utilization_pct numeric,
  tbc_cents bigint,
  bog_cents bigint,
  paypal_cents bigint
)
language sql
stable
as $$
  with court as (
    -- `gross` is the full amount charged for court bookings (court time plus any
    -- equipment add-ons), matching what confirm_booking writes into payments.
    select
      coalesce(sum(price_cents), 0) as gross,
      coalesce(sum(duration_minutes), 0) / 60.0 as hours
    from court_bookings
    where status = 'confirmed'
      and (lower(slot) at time zone club_timezone())::date = p_date
  ),
  extras as (
    select coalesce(sum(be.price_cents * be.quantity), 0) as revenue
    from booking_equipment be
    join court_bookings cb on cb.id = be.court_booking_id
    where cb.status = 'confirmed'
      and (lower(cb.slot) at time zone club_timezone())::date = p_date
  ),
  car_wash as (
    select
      coalesce(sum(price_cents), 0) as revenue,
      count(*) as cycles
    from wash_bookings
    where status = 'confirmed'
      and (lower(slot) at time zone club_timezone())::date = p_date
  ),
  methods as (
    -- Keyed off the booking that was played on p_date, not off when the card
    -- was charged, so this section reconciles against Total above.
    select
      coalesce(sum(p.amount_cents) filter (where p.method = 'tbc'), 0) as tbc,
      coalesce(sum(p.amount_cents) filter (where p.method = 'bog'), 0) as bog,
      coalesce(sum(p.amount_cents) filter (where p.method = 'paypal'), 0) as paypal
    from payments p
    left join court_bookings cb on cb.id = p.court_booking_id
    left join wash_bookings wb on wb.id = p.car_wash_booking_id
    where p.status = 'paid'
      and (
        (lower(cb.slot) at time zone club_timezone())::date = p_date
        or (lower(wb.slot) at time zone club_timezone())::date = p_date
      )
  )
  select
    court.gross - extras.revenue,          -- court time only; add-ons broken out below
    car_wash.revenue,
    extras.revenue,
    court.gross + car_wash.revenue,        -- = the sum of the three lines above
    court.hours,
    round((court.hours / (10 * 15.0)) * 100, 1),    -- 10 courts x 15 bookable hours (08:00-23:00)
    car_wash.cycles::int,
    round((car_wash.cycles / (4 * 30.0)) * 100, 1), -- 4 bays x ~30 half-hour cycles
    methods.tbc,
    methods.bog,
    methods.paypal
  from court, extras, car_wash, methods;
$$;
