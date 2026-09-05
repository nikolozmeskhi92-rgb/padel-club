-- =========================================================
-- RATE LIMITING
--
-- The public booking endpoints had no throttle: anyone could hammer
-- POST /api/bookings and fill the calendar with unpaid 'pending' rows, which
-- the EXCLUDE constraint would then dutifully protect from anyone else.
--
-- The counter lives in Postgres rather than in process memory because the app
-- runs on serverless functions -- each instance has its own heap, so an
-- in-memory limiter is really N limiters with N times the intended budget.
-- =========================================================

create table if not exists rate_limits (
  bucket text primary key,              -- e.g. 'book:203.0.113.9'
  window_start timestamptz not null,
  count int not null
);

create index if not exists idx_rate_limits_window on rate_limits (window_start);

-- Fixed-window counter. One statement does the read, the window roll and the
-- increment, so concurrent requests cannot both see a stale count.
create or replace function rate_limit_hit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, remaining int, retry_after_seconds int)
language plpgsql
as $$
declare
  v_now      timestamptz := now();
  v_window   interval := (p_window_seconds || ' seconds')::interval;
  v_start    timestamptz;
  v_count    int;
begin
  insert into rate_limits as rl (bucket, window_start, count)
  values (p_bucket, v_now, 1)
  on conflict (bucket) do update
    set count = case when rl.window_start + v_window <= v_now then 1 else rl.count + 1 end,
        window_start = case when rl.window_start + v_window <= v_now then v_now else rl.window_start end
  returning rl.window_start, rl.count into v_start, v_count;

  return query select
    v_count <= p_limit,
    greatest(p_limit - v_count, 0),
    greatest(ceil(extract(epoch from (v_start + v_window - v_now)))::int, 0);
end;
$$;

-- Housekeeping: drop buckets nothing has touched in a day. Call from the
-- nightly cron, or schedule with pg_cron if the project has it enabled.
create or replace function prune_rate_limits()
returns int
language plpgsql
as $$
declare
  v_deleted int;
begin
  delete from rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Only the service role touches this table; the app calls it through the
-- server-side client, never from the browser.
alter table rate_limits enable row level security;
