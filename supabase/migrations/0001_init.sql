-- =========================================================
-- PADEL CLUB — CORE SCHEMA
-- Run in Supabase SQL editor or via `supabase db push`
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists btree_gist; -- needed for EXCLUDE constraints on ranges

-- ---------- ENUMS ----------
create type booking_status as enum ('pending', 'confirmed', 'cancelled', 'completed', 'no_show');
create type payment_method as enum ('tbc', 'bog', 'paypal', 'cash', 'comp');
create type payment_status as enum ('unpaid', 'paid', 'refunded', 'failed');
create type wash_service as enum ('quick_wash', 'full_detail', 'express_rinse');
create type slot_status as enum ('open', 'maintenance', 'blocked');

-- ---------- PROFILES (extends auth.users) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  created_at timestamptz not null default now()
);

-- ---------- COURTS ----------
create table courts (
  id serial primary key,
  name text not null unique,          -- "Court 1" ... "Court 10"
  surface text not null default 'panoramic glass',
  indoor boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null
);

insert into courts (name, sort_order, indoor)
select 'Court ' || i, i, (i > 7) -- courts 8-10 indoor, purely illustrative
from generate_series(1, 10) as i;

-- ---------- CAR WASH BAYS ----------
create table wash_bays (
  id serial primary key,
  name text not null unique,          -- "Bay 1" ... "Bay 4"
  is_active boolean not null default true,
  sort_order int not null
);

insert into wash_bays (name, sort_order)
select 'Bay ' || i, i from generate_series(1, 4) as i;

-- ---------- PRICING RULES ----------
-- Flexible rule table so peak/off-peak/weekend pricing can change without a deploy.
create table pricing_rules (
  id serial primary key,
  scope text not null check (scope in ('court', 'car_wash')),
  label text not null,                         -- "Peak", "Off-Peak", "Weekend"
  days_of_week int[] not null,                  -- 0=Sun .. 6=Sat
  start_time time not null,
  end_time time not null,
  duration_minutes int not null,                -- 60 / 90 for courts, 30/60 for car wash
  price_cents int not null,
  priority int not null default 0               -- higher priority wins on overlap
);

-- Court pricing: 60 & 90 min, weekday off-peak (08:00-18:00) vs peak (18:00-23:00) vs weekends
insert into pricing_rules (scope, label, days_of_week, start_time, end_time, duration_minutes, price_cents, priority) values
('court', 'Weekday Off-Peak 60', '{1,2,3,4,5}', '08:00', '18:00', 60, 2500, 1),
('court', 'Weekday Off-Peak 90', '{1,2,3,4,5}', '08:00', '18:00', 90, 3600, 1),
('court', 'Weekday Peak 60',     '{1,2,3,4,5}', '18:00', '23:00', 60, 4000, 2),
('court', 'Weekday Peak 90',     '{1,2,3,4,5}', '18:00', '23:00', 90, 5800, 2),
('court', 'Weekend 60',          '{0,6}',       '08:00', '23:00', 60, 4500, 3),
('court', 'Weekend 90',          '{0,6}',       '08:00', '23:00', 90, 6400, 3);

-- Car wash pricing
insert into pricing_rules (scope, label, days_of_week, start_time, end_time, duration_minutes, price_cents, priority) values
('car_wash', 'Quick Wash 30',   '{0,1,2,3,4,5,6}', '07:00', '22:00', 30, 800,  1),
('car_wash', 'Full Detail 60',   '{0,1,2,3,4,5,6}', '07:00', '22:00', 60, 1500, 1),
('car_wash', 'Express Rinse 30', '{0,1,2,3,4,5,6}', '07:00', '22:00', 30, 1200, 1);

-- ---------- EQUIPMENT (add-ons) ----------
create table equipment_items (
  id serial primary key,
  name text not null,               -- "Racket Rental", "Ball Can (x3)"
  price_cents int not null,
  stock int not null default 50,
  is_active boolean not null default true
);

insert into equipment_items (name, price_cents, stock) values
('Racket Rental', 800, 40),
('Ball Can (x3)', 500, 100),
('Grip Tape', 300, 60),
('Towel', 200, 80);

-- ---------- COURT BOOKINGS ----------
-- tstzrange + EXCLUDE constraint = the atomic double-booking guard at the DB level.
create table court_bookings (
  id uuid primary key default uuid_generate_v4(),
  court_id int not null references courts(id),
  user_id uuid references profiles(id),
  guest_name text,
  guest_email text,
  guest_phone text,
  slot tstzrange not null,                 -- e.g. '[2026-09-05 18:00+00, 2026-09-05 19:00+00)'
  duration_minutes int not null check (duration_minutes in (60, 90)),
  status booking_status not null default 'pending',
  price_cents int not null,
  payment_method payment_method,
  payment_status payment_status not null default 'unpaid',
  booking_code text not null unique default upper(substr(md5(random()::text), 1, 8)),
  created_at timestamptz not null default now(),

  -- Prevents ANY overlapping active booking on the same court, race-condition-proof.
  exclude using gist (
    court_id with =,
    slot with &&
  ) where (status in ('pending', 'confirmed'))
);

create index idx_court_bookings_slot on court_bookings using gist (slot);
create index idx_court_bookings_court_date on court_bookings (court_id, (lower(slot)));

-- ---------- CAR WASH BOOKINGS ----------
create table wash_bookings (
  id uuid primary key default uuid_generate_v4(),
  bay_id int not null references wash_bays(id),
  user_id uuid references profiles(id),
  guest_name text,
  guest_email text,
  linked_court_booking_id uuid references court_bookings(id), -- cross-sell link
  service wash_service not null,
  slot tstzrange not null,             -- includes the buffer time already baked in
  status booking_status not null default 'pending',
  price_cents int not null,
  payment_method payment_method,
  payment_status payment_status not null default 'unpaid',
  booking_code text not null unique default upper(substr(md5(random()::text), 1, 8)),
  created_at timestamptz not null default now(),

  exclude using gist (
    bay_id with =,
    slot with &&
  ) where (status in ('pending', 'confirmed'))
);

create index idx_wash_bookings_slot on wash_bookings using gist (slot);

-- ---------- BOOKING EQUIPMENT (line items) ----------
create table booking_equipment (
  id uuid primary key default uuid_generate_v4(),
  court_booking_id uuid references court_bookings(id) on delete cascade,
  equipment_id int not null references equipment_items(id),
  quantity int not null default 1,
  price_cents int not null
);

-- ---------- PAYMENTS ----------
create table payments (
  id uuid primary key default uuid_generate_v4(),
  court_booking_id uuid references court_bookings(id),
  car_wash_booking_id uuid references wash_bookings(id),
  method payment_method not null,
  amount_cents int not null,
  status payment_status not null default 'unpaid',
  provider_ref text,                 -- PayPal order id / BOG/TBC transaction id
  created_at timestamptz not null default now(),
  check (court_booking_id is not null or car_wash_booking_id is not null)
);

-- ---------- COURT/BOX MAINTENANCE OVERRIDES (admin manual lock) ----------
create table availability_overrides (
  id uuid primary key default uuid_generate_v4(),
  resource_type text not null check (resource_type in ('court', 'wash_bay')),
  resource_id int not null,
  range tstzrange not null,
  reason text,
  status slot_status not null default 'maintenance',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- ATOMIC BOOKING RPCs
-- The EXCLUDE constraints above make double-booking impossible even under
-- concurrent requests; these functions wrap insert + payment + equipment
-- into one transaction so the API can call a single RPC.
-- =========================================================

create or replace function create_court_booking(
  p_court_id int,
  p_start timestamptz,
  p_duration_minutes int,
  p_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_price_cents int,
  p_payment_method payment_method,
  p_equipment jsonb default '[]'::jsonb -- [{"equipment_id":1,"quantity":2,"price_cents":800}]
) returns court_bookings
language plpgsql
as $$
declare
  v_booking court_bookings;
  v_item jsonb;
begin
  insert into court_bookings (
    court_id, slot, duration_minutes, user_id, guest_name, guest_email, guest_phone,
    price_cents, payment_method, status, payment_status
  ) values (
    p_court_id,
    tstzrange(p_start, p_start + (p_duration_minutes || ' minutes')::interval, '[)'),
    p_duration_minutes, p_user_id, p_guest_name, p_guest_email, p_guest_phone,
    p_price_cents, p_payment_method, 'pending', 'unpaid'
  ) returning * into v_booking;

  for v_item in select * from jsonb_array_elements(p_equipment) loop
    insert into booking_equipment (court_booking_id, equipment_id, quantity, price_cents)
    values (
      v_booking.id,
      (v_item->>'equipment_id')::int,
      (v_item->>'quantity')::int,
      (v_item->>'price_cents')::int
    );
  end loop;

  return v_booking;
exception
  when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
end;
$$;

create or replace function create_wash_booking(
  p_bay_id int,
  p_start timestamptz,
  p_service wash_service,
  p_duration_minutes int,
  p_buffer_minutes int,
  p_user_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_price_cents int,
  p_payment_method payment_method,
  p_linked_court_booking_id uuid default null
) returns wash_bookings
language plpgsql
as $$
declare
  v_booking wash_bookings;
begin
  insert into wash_bookings (
    bay_id, slot, service, user_id, guest_name, guest_email,
    linked_court_booking_id, price_cents, payment_method, status, payment_status
  ) values (
    p_bay_id,
    -- buffer time is baked directly into the reserved range so the next booking can't start early
    tstzrange(p_start, p_start + ((p_duration_minutes + p_buffer_minutes) || ' minutes')::interval, '[)'),
    p_service, p_user_id, p_guest_name, p_guest_email,
    p_linked_court_booking_id, p_price_cents, p_payment_method, 'pending', 'unpaid'
  ) returning * into v_booking;

  return v_booking;
exception
  when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
end;
$$;

-- Confirm booking after payment succeeds (called from webhook / checkout confirm route)
create or replace function confirm_booking(
  p_booking_type text, -- 'court' | 'car_wash'
  p_booking_id uuid,
  p_payment_method payment_method,
  p_provider_ref text
) returns void
language plpgsql
as $$
begin
  if p_booking_type = 'court' then
    update court_bookings set status = 'confirmed', payment_status = 'paid' where id = p_booking_id;
    insert into payments (court_booking_id, method, amount_cents, status, provider_ref)
    select id, p_payment_method, price_cents, 'paid', p_provider_ref from court_bookings where id = p_booking_id;
  elsif p_booking_type = 'car_wash' then
    update wash_bookings set status = 'confirmed', payment_status = 'paid' where id = p_booking_id;
    insert into payments (car_wash_booking_id, method, amount_cents, status, provider_ref)
    select id, p_payment_method, price_cents, 'paid', p_provider_ref from wash_bookings where id = p_booking_id;
  end if;
end;
$$;

-- =========================================================
-- DAILY FINANCIAL SUMMARY (used by Telegram nightly report)
-- =========================================================
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
as $$
  with court as (
    select
      coalesce(sum(price_cents), 0) as revenue,
      coalesce(sum(duration_minutes), 0) / 60.0 as hours
    from court_bookings
    where status = 'confirmed' and lower(slot)::date = p_date
  ),
  extras as (
    select coalesce(sum(be.price_cents * be.quantity), 0) as revenue
    from booking_equipment be
    join court_bookings cb on cb.id = be.court_booking_id
    where cb.status = 'confirmed' and lower(cb.slot)::date = p_date
  ),
  car_wash as (
    select
      coalesce(sum(price_cents), 0) as revenue,
      count(*) as cycles
    from wash_bookings
    where status = 'confirmed' and lower(slot)::date = p_date
  ),
  methods as (
    select
      coalesce(sum(amount_cents) filter (where method = 'tbc'), 0) as tbc,
      coalesce(sum(amount_cents) filter (where method = 'bog'), 0) as bog,
      coalesce(sum(amount_cents) filter (where method = 'paypal'), 0) as paypal
    from payments
    where created_at::date = p_date
  )
  select
    court.revenue,
    car_wash.revenue,
    extras.revenue,
    court.revenue + car_wash.revenue + extras.revenue,
    court.hours,
    round((court.hours / (10 * 15.0)) * 100, 1),   -- 10 courts * 15 bookable hours/day (08:00-23:00)
    car_wash.cycles,
    round((car_wash.cycles / (4 * 30.0)) * 100, 1), -- 4 bays * ~30 30-min cycles/day
    methods.tbc,
    methods.bog,
    methods.paypal
  from court, extras, car_wash, methods;
$$;

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table profiles enable row level security;
alter table court_bookings enable row level security;
alter table wash_bookings enable row level security;
alter table booking_equipment enable row level security;
alter table payments enable row level security;
alter table availability_overrides enable row level security;

create policy "profiles: read own" on profiles for select using (auth.uid() = id);
create policy "profiles: update own" on profiles for update using (auth.uid() = id);

create policy "court_bookings: read own or staff" on court_bookings for select
  using (
    auth.uid() = user_id
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin'))
  );
create policy "court_bookings: insert own" on court_bookings for insert
  with check (auth.uid() = user_id or user_id is null);
create policy "court_bookings: staff manage" on court_bookings for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin')));

create policy "wash_bookings: read own or staff" on wash_bookings for select
  using (
    auth.uid() = user_id
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin'))
  );
create policy "wash_bookings: insert own" on wash_bookings for insert
  with check (auth.uid() = user_id or user_id is null);
create policy "wash_bookings: staff manage" on wash_bookings for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin')));

create policy "payments: staff read" on payments for select
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin')));

create policy "overrides: staff manage" on availability_overrides for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin')));

-- Public (anon) read access to reference/catalog tables — safe, non-sensitive
alter table courts enable row level security;
alter table wash_bays enable row level security;
alter table pricing_rules enable row level security;
alter table equipment_items enable row level security;
create policy "public read courts" on courts for select using (true);
create policy "public read wash_bays" on wash_bays for select using (true);
create policy "public read pricing_rules" on pricing_rules for select using (true);
create policy "public read equipment_items" on equipment_items for select using (true);
