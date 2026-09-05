-- =========================================================
-- SCHEMA REGRESSION TESTS
--
-- Run against a scratch database that has had 0001_init.sql and
-- 0002_daily_summary_fix.sql applied:
--
--     ./scripts/db-test.sh
--
-- Every check raises an exception on failure, so the script exits non-zero and
-- prints which assertion broke. Concurrency is exercised separately by
-- db-test.sh, which needs real parallel connections.
-- =========================================================

\set ON_ERROR_STOP on

create or replace function assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice '  ok  %', label;
end $$;

create or replace function assert_raises(sql_text text, expected_message text, label text)
returns void language plpgsql as $$
begin
  begin
    execute sql_text;
  exception when others then
    if position(expected_message in SQLERRM) = 0 then
      raise exception 'FAIL % — expected error containing %, got %', label, expected_message, SQLERRM;
    end if;
    raise notice '  ok  %', label;
    return;
  end;
  raise exception 'FAIL % — expected an error, statement succeeded', label;
end $$;

-- Clean slate
truncate payments, booking_equipment, wash_bookings, court_bookings restart identity cascade;

\warn ''
\warn 'seed data'
select assert_eq((select count(*)::int from courts), 10, '10 courts seeded');
select assert_eq((select count(*)::int from wash_bays), 4, '4 wash bays seeded');
select assert_eq((select count(*)::int from pricing_rules where scope='court'), 6, '6 court pricing rules');
select assert_eq((select count(*)::int from equipment_items), 4, '4 equipment items');

\warn ''
\warn 'court booking + double-booking guard'
select create_court_booking(1, '2027-01-04 18:00+04'::timestamptz, 60, null,
  'A', 'a@e.com', '+995', 4000, 'cash', '[]'::jsonb);

select assert_raises(
  $q$ select create_court_booking(1, '2027-01-04 18:30+04'::timestamptz, 60, null,
        'B', 'b@e.com', '+995', 4000, 'cash', '[]'::jsonb) $q$,
  'SLOT_TAKEN', 'overlapping booking on the same court is rejected');

select assert_eq(
  (select count(*)::int from create_court_booking(2, '2027-01-04 18:00+04'::timestamptz, 60, null,
     'C', 'c@e.com', '+995', 4000, 'cash', '[]'::jsonb)),
  1, 'same time on a different court is allowed');

select assert_eq(
  (select count(*)::int from create_court_booking(1, '2027-01-04 19:00+04'::timestamptz, 60, null,
     'D', 'd@e.com', '+995', 4000, 'cash', '[]'::jsonb)),
  1, 'back-to-back booking on the same court is allowed (ranges are half-open)');

-- A cancelled booking must free its slot: the EXCLUDE constraint is partial.
update court_bookings set status = 'cancelled'
where court_id = 1 and lower(slot) = '2027-01-04 18:00+04'::timestamptz;
select assert_eq(
  (select count(*)::int from create_court_booking(1, '2027-01-04 18:00+04'::timestamptz, 60, null,
     'E', 'e@e.com', '+995', 4000, 'cash', '[]'::jsonb)),
  1, 'cancelling a booking frees the slot for rebooking');

\warn ''
\warn 'wash booking + changeover buffer'
select create_wash_booking(1, '2027-01-04 18:00+04'::timestamptz, 'quick_wash', 30, 10,
  null, 'W', 'w@e.com', 800, 'cash', null);

select assert_eq(
  (select (upper(slot) - lower(slot)) from wash_bookings where guest_name = 'W'),
  interval '40 minutes', 'the 10-minute changeover buffer is inside the reserved range');

select assert_raises(
  $q$ select create_wash_booking(1, '2027-01-04 18:30+04'::timestamptz, 'quick_wash', 30, 10,
        null, 'X', 'x@e.com', 800, 'cash', null) $q$,
  'SLOT_TAKEN', 'next car cannot start inside the buffer');

select assert_eq(
  (select count(*)::int from create_wash_booking(1, '2027-01-04 18:40+04'::timestamptz, 'quick_wash', 30, 10,
     null, 'Y', 'y@e.com', 800, 'cash', null)),
  1, 'next car can start once the buffer has elapsed');

\warn ''
\warn 'daily summary reconciles with what was charged'
truncate payments, booking_equipment, wash_bookings, court_bookings restart identity cascade;

-- Mirrors app/api/bookings/route.ts: p_price_cents is court time + equipment.
select create_court_booking(3, '2027-01-05 18:00+04'::timestamptz, 60, null,
  'Payer', 'p@e.com', '+995',
  5600,                                   -- 4000 court + 1600 equipment
  'tbc',
  '[{"equipment_id":1,"quantity":2,"price_cents":800}]'::jsonb);
select confirm_booking('court', (select id from court_bookings where guest_name='Payer'), 'tbc', 'TX-1');

select create_wash_booking(2, '2027-01-05 12:00+04'::timestamptz, 'full_detail', 60, 10,
  null, 'Washer', 'w2@e.com', 1500, 'bog', null);
select confirm_booking('car_wash', (select id from wash_bookings where guest_name='Washer'), 'bog', 'TX-2');

select assert_eq((select court_revenue_cents from get_daily_summary('2027-01-05')),
  4000::bigint, 'court revenue excludes equipment (no double count)');
select assert_eq((select extras_revenue_cents from get_daily_summary('2027-01-05')),
  1600::bigint, 'extras reported separately');
select assert_eq((select car_wash_revenue_cents from get_daily_summary('2027-01-05')),
  1500::bigint, 'car wash revenue');
select assert_eq((select total_revenue_cents from get_daily_summary('2027-01-05')),
  7100::bigint, 'total equals the sum of the three lines');
select assert_eq(
  (select total_revenue_cents from get_daily_summary('2027-01-05')),
  (select coalesce(sum(amount_cents), 0) from payments where status = 'paid'),
  'total equals what the customers were actually charged');
select assert_eq((select tbc_cents from get_daily_summary('2027-01-05')),
  5600::bigint, 'TBC split keys off the day of play, not the day of payment');
select assert_eq((select bog_cents from get_daily_summary('2027-01-05')),
  1500::bigint, 'BOG split keys off the day of play');

-- A refund must leave the payment-method split.
update payments set status = 'refunded' where provider_ref = 'TX-2';
select assert_eq((select bog_cents from get_daily_summary('2027-01-05')),
  0::bigint, 'refunded payments are excluded from the method split');

\warn ''
\warn 'utilization'
select assert_eq((select court_hours_booked from get_daily_summary('2027-01-05')),
  1.0::numeric, 'one 60-minute booking is 1.0 court hour');
select assert_eq((select court_utilization_pct from get_daily_summary('2027-01-05')),
  0.7::numeric, '1h of 150 bookable court-hours is 0.7%');

\warn ''
\warn 'timezone'
-- 00:30 local on Jan 6 is 20:30 UTC on Jan 5. It must report on Jan 6, the local day.
truncate payments, booking_equipment, wash_bookings, court_bookings restart identity cascade;
select create_court_booking(4, '2027-01-06 00:30+04'::timestamptz, 60, null,
  'LateNight', 'l@e.com', '+995', 4000, 'cash', '[]'::jsonb);
select confirm_booking('court', (select id from court_bookings where guest_name='LateNight'), 'cash', 'TX-3');
select assert_eq((select court_revenue_cents from get_daily_summary('2027-01-06')),
  4000::bigint, 'a booking after local midnight lands on the local day, not the UTC day');
select assert_eq((select court_revenue_cents from get_daily_summary('2027-01-05')),
  0::bigint, 'and not on the previous UTC day');

\warn ''
\warn 'rate limiting'
delete from rate_limits where bucket like 'test:%';
select assert_eq((select allowed from rate_limit_hit('test:a', 3, 60)), true,  'hit 1 of 3 allowed');
select assert_eq((select allowed from rate_limit_hit('test:a', 3, 60)), true,  'hit 2 of 3 allowed');
select assert_eq((select remaining from rate_limit_hit('test:a', 3, 60)), 0,   'hit 3 of 3 allowed, none remaining');
select assert_eq((select allowed from rate_limit_hit('test:a', 3, 60)), false, 'hit 4 is blocked');
select assert_eq((select allowed from rate_limit_hit('test:b', 3, 60)), true,  'a different client has its own budget');

-- Backdate the window to prove it rolls over rather than blocking forever.
update rate_limits set window_start = now() - interval '2 minutes' where bucket = 'test:a';
select assert_eq((select allowed from rate_limit_hit('test:a', 3, 60)), true, 'budget resets once the window expires');

update rate_limits set window_start = now() - interval '2 days' where bucket = 'test:b';
select assert_eq(prune_rate_limits() >= 1, true, 'prune_rate_limits clears stale buckets');
delete from rate_limits where bucket like 'test:%';

truncate payments, booking_equipment, wash_bookings, court_bookings restart identity cascade;
drop function assert_eq(anyelement, anyelement, text);
drop function assert_raises(text, text, text);

\warn ''
\warn 'ALL SCHEMA TESTS PASSED'
