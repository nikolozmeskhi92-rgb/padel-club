#!/usr/bin/env bash
# =============================================================================
# Spin up a throwaway Postgres, apply the migrations, and run the schema tests
# — including a real concurrency test against the double-booking guard.
#
#   ./scripts/db-test.sh
#
# Needs a local Postgres 14+ installation (initdb/pg_ctl/psql on PATH, or under
# /usr/lib/postgresql/*/bin). Nothing touches your Supabase project.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT="${PGPORT:-5433}"
PGDATA="$(mktemp -d)/pgdata"
SOCKET_DIR="$(mktemp -d)"
DB=padel_test
RACERS="${RACERS:-40}"

for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
  [ -d "$d" ] && PATH="$PATH:$d"
done
command -v initdb >/dev/null || { echo "initdb not found — install Postgres first."; exit 1; }

cleanup() { pg_ctl -D "$PGDATA" stop -m immediate >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> starting a throwaway Postgres on port $PGPORT"
initdb -D "$PGDATA" -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PGPORT -k $SOCKET_DIR" start >/dev/null
export PGHOST="$SOCKET_DIR" PGPORT PGUSER="${PGUSER:-$(whoami)}"
psql -d postgres -qc "create database $DB;"

echo "==> applying Supabase compatibility shim"
psql -d "$DB" -q -v ON_ERROR_STOP=1 <<'SHIM'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
SHIM

echo "==> applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> schema tests"
psql -d "$DB" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/schema_test.sql" > /dev/null

echo ""
echo "==> concurrency test: $RACERS simultaneous bookings of one slot"
psql -d "$DB" -qtAc "truncate payments, booking_equipment, wash_bookings, court_bookings cascade;"
TMP="$(mktemp -d)"
for i in $(seq 1 "$RACERS"); do
  psql -d "$DB" -tAc "select create_court_booking(5, '2027-02-01 19:00+04'::timestamptz, 90, null,
    'Racer $i', 'r$i@e.com', '+995', 5800, 'cash', '[]'::jsonb);" > "$TMP/r$i.out" 2>&1 &
done
wait

WON=$(grep -L "ERROR" "$TMP"/r*.out 2>/dev/null | wc -l | tr -d ' ')
TAKEN=$(grep -l "SLOT_TAKEN" "$TMP"/r*.out 2>/dev/null | wc -l | tr -d ' ')
OTHER=$(cat "$TMP"/r*.out 2>/dev/null | grep "ERROR" | grep -vc "SLOT_TAKEN" || true)
ROWS=$(psql -d "$DB" -tAc "select count(*) from court_bookings where court_id = 5;")

echo "    winners:             $WON"
echo "    rejected SLOT_TAKEN: $TAKEN"
echo "    unexpected errors:   $OTHER"
echo "    rows in table:       $ROWS"

if [ "$ROWS" != "1" ] || [ "$OTHER" != "0" ]; then
  echo ""
  echo "CONCURRENCY TEST FAILED — expected exactly 1 row and 0 unexpected errors."
  exit 1
fi

echo ""
echo "==> concurrency test: $RACERS simultaneous requests against a limit of 10"
psql -d "$DB" -qtAc "delete from rate_limits where bucket = 'race:limiter';"
RL="$(mktemp -d)"
for i in $(seq 1 "$RACERS"); do
  psql -d "$DB" -tAc "select allowed from rate_limit_hit('race:limiter', 10, 60);" > "$RL/l$i.out" 2>&1 &
done
wait
ALLOWED=$(cat "$RL"/l*.out | grep -c "^t$" || true)
echo "    allowed: $ALLOWED (expected exactly 10)"
if [ "$ALLOWED" != "10" ]; then
  echo ""
  echo "RATE LIMIT TEST FAILED — the counter is not atomic under concurrency."
  exit 1
fi

echo ""
echo "ALL TESTS PASSED ($RACERS concurrent attempts, exactly 1 booking committed)"
