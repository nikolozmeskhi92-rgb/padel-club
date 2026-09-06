-- =============================================================================
-- A window of days in one round trip.
--
-- The dashboard asked get_daily_summary() once per day in a loop: fine for a
-- fortnight, silly for a month, and worse every time the window grows. This
-- wraps the same function in a set-returning one, so the shape of the numbers
-- is defined in exactly one place and the page makes a single call.
--
-- The window deliberately runs into the future. Past days are money taken;
-- future days are money booked. Both are worth seeing on the same axis — the
-- question "how does next week look?" is the one an owner actually asks — and
-- the chart marks today so the two halves are never confused.
-- =============================================================================

create or replace function get_summary_range(p_from date, p_to date)
returns table (
  day date,
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
as $fn$
  select
    g::date,
    s.court_revenue_cents, s.car_wash_revenue_cents, s.extras_revenue_cents,
    s.total_revenue_cents, s.court_hours_booked, s.court_utilization_pct,
    s.wash_cycles, s.wash_utilization_pct, s.tbc_cents, s.bog_cents, s.paypal_cents
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g,
       lateral get_daily_summary(g::date) s;
$fn$;

grant execute on function get_summary_range(date, date) to service_role, authenticated;
