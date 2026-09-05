-- =========================================================
-- Teach get_daily_summary() about cancellations.
--
-- 0004 introduced late cancellations that keep the customer's money (they get
-- club credit instead of cash). That re-broke the reconciliation 0002 fixed:
--
--   revenue CTEs counted only status = 'confirmed'  -> cancelled booking drops out
--   the payment split counted payments.status = 'paid' -> its payment stays in
--
-- so a late cancellation showed as ₾0 revenue against ₾45 of card takings.
--
-- The club did keep that money, so it belongs in revenue. But nobody played, so
-- it must NOT count toward court hours or utilization -- otherwise a day of
-- cancellations would look like a busy day.
--
-- Adds `retained_cents` to the return so the report can show how much of the
-- day's revenue came from courts that went unused.
-- =========================================================

drop function if exists get_daily_summary(date);

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
  paypal_cents bigint,
  retained_cents bigint          -- paid, then cancelled too late for a refund
)
language sql
stable
as $$
  with court as (
    select
      -- Money the club kept: played bookings, plus late cancellations whose
      -- payment was not refunded.
      coalesce(sum(price_cents) filter (
        where status = 'confirmed'
           or (status = 'cancelled' and payment_status = 'paid')
      ), 0) as gross,
      -- Court time actually used: confirmed only.
      coalesce(sum(duration_minutes) filter (where status = 'confirmed'), 0) / 60.0 as hours,
      coalesce(sum(price_cents) filter (
        where status = 'cancelled' and payment_status = 'paid'
      ), 0) as retained
    from court_bookings
    where (lower(slot) at time zone club_timezone())::date = p_date
  ),
  extras as (
    select coalesce(sum(be.price_cents * be.quantity), 0) as revenue
    from booking_equipment be
    join court_bookings cb on cb.id = be.court_booking_id
    where (lower(cb.slot) at time zone club_timezone())::date = p_date
      and (cb.status = 'confirmed'
           or (cb.status = 'cancelled' and cb.payment_status = 'paid'))
  ),
  car_wash as (
    select
      coalesce(sum(price_cents) filter (
        where status = 'confirmed'
           or (status = 'cancelled' and payment_status = 'paid')
      ), 0) as revenue,
      count(*) filter (where status = 'confirmed') as cycles,
      coalesce(sum(price_cents) filter (
        where status = 'cancelled' and payment_status = 'paid'
      ), 0) as retained
    from wash_bookings
    where (lower(slot) at time zone club_timezone())::date = p_date
  ),
  methods as (
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
    court.gross - extras.revenue,
    car_wash.revenue,
    extras.revenue,
    court.gross + car_wash.revenue,
    court.hours,
    round((court.hours / (10 * 15.0)) * 100, 1),
    car_wash.cycles::int,
    round((car_wash.cycles / (4 * 30.0)) * 100, 1),
    methods.tbc,
    methods.bog,
    methods.paypal,
    court.retained + car_wash.retained
  from court, extras, car_wash, methods;
$$;
