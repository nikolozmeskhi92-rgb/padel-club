-- =========================================================
-- CANCELLATIONS, REFUNDS AND CREDIT NOTES
--
-- Policy (all knobs live in `cancellation_policy`, one row, editable without a
-- deploy):
--
--   * Cancel at least `free_cancellation_hours` before the start  -> cash refund.
--   * Cancel inside that window                                   -> credit note
--     worth `late_credit_pct` of what was paid, redeemable against a future
--     booking. The club keeps the cash; the customer keeps the value.
--   * Unpaid ('pending') bookings just release the slot; nothing to return.
--
-- Credit is issued as a codeable note tied to the customer's email rather than
-- to an account balance, because checkout is guest-first -- most customers
-- never create a login.
--
-- Cancelling sets status = 'cancelled', which the partial EXCLUDE constraints
-- in 0001 already treat as "slot is free again", so the court goes straight
-- back on sale with no extra bookkeeping.
-- =========================================================

-- ---------- POLICY ----------
create table if not exists cancellation_policy (
  id int primary key default 1 check (id = 1),      -- single-row table
  free_cancellation_hours int not null default 24,
  late_credit_pct int not null default 100 check (late_credit_pct between 0 and 100),
  credit_valid_days int not null default 180,
  updated_at timestamptz not null default now()
);

insert into cancellation_policy (id) values (1) on conflict (id) do nothing;

-- ---------- CANCEL TOKENS ----------
-- A dedicated unguessable token per booking. booking_code is deliberately short
-- (8 hex chars) because staff read it aloud at the desk and it is displayed on
-- the public /checkin page -- it is an identifier, not a capability. The cancel
-- link needs a real secret, so it gets its own.
alter table court_bookings add column if not exists cancel_token uuid not null default gen_random_uuid();
alter table wash_bookings  add column if not exists cancel_token uuid not null default gen_random_uuid();

create unique index if not exists idx_court_bookings_cancel_token on court_bookings (cancel_token);
create unique index if not exists idx_wash_bookings_cancel_token  on wash_bookings (cancel_token);

-- ---------- CREDIT NOTES ----------
create table if not exists credit_notes (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique default upper(substr(md5(random()::text), 1, 10)),
  email text not null,
  amount_cents int not null check (amount_cents > 0),
  remaining_cents int not null check (remaining_cents >= 0),
  reason text,
  source_court_booking_id uuid references court_bookings(id),
  source_wash_booking_id uuid references wash_bookings(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (remaining_cents <= amount_cents)
);

create index if not exists idx_credit_notes_email on credit_notes (lower(email));

-- ---------- AUDIT ----------
-- Who cancelled what, when, and what they got back. Kept separate from the
-- booking row so a cancellation is never silently overwritten.
create table if not exists booking_cancellations (
  id uuid primary key default uuid_generate_v4(),
  court_booking_id uuid references court_bookings(id),
  wash_booking_id uuid references wash_bookings(id),
  actor text not null check (actor in ('customer', 'staff', 'system')),
  actor_user_id uuid references profiles(id),
  reason text,
  hours_before_start numeric,
  refund_cents int not null default 0,
  credit_cents int not null default 0,
  credit_note_id uuid references credit_notes(id),
  created_at timestamptz not null default now(),
  check (court_booking_id is not null or wash_booking_id is not null)
);

-- =========================================================
-- cancel_booking() — the whole decision in one transaction.
--
-- Returns the outcome so the caller can tell the customer exactly what
-- happened without re-deriving the policy in TypeScript.
-- =========================================================
create or replace function cancel_booking(
  p_booking_type text,              -- 'court' | 'car_wash'
  p_booking_id uuid,
  p_actor text default 'customer',  -- 'customer' | 'staff' | 'system'
  p_actor_user_id uuid default null,
  p_reason text default null
)
returns table (
  outcome text,                     -- 'refunded' | 'credited' | 'released'
  refund_cents int,
  credit_cents int,
  credit_code text,
  credit_expires_at timestamptz,
  hours_before_start numeric
)
language plpgsql
as $$
declare
  v_policy       cancellation_policy;
  v_status       booking_status;
  v_pay_status   payment_status;
  v_price        int;
  v_email        text;
  v_start        timestamptz;
  v_hours        numeric;
  v_refund       int := 0;
  v_credit       int := 0;
  v_note         credit_notes;
  v_outcome      text;
begin
  if p_booking_type not in ('court', 'car_wash') then
    raise exception 'UNKNOWN_BOOKING_TYPE';
  end if;

  select * into v_policy from cancellation_policy where id = 1;

  -- Lock the row so two clicks on the same cancel link cannot both issue credit.
  if p_booking_type = 'court' then
    select status, payment_status, price_cents, guest_email, lower(slot)
      into v_status, v_pay_status, v_price, v_email, v_start
    from court_bookings where id = p_booking_id for update;
  else
    select status, payment_status, price_cents, guest_email, lower(slot)
      into v_status, v_pay_status, v_price, v_email, v_start
    from wash_bookings where id = p_booking_id for update;
  end if;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if v_status = 'cancelled' then
    raise exception 'ALREADY_CANCELLED';
  end if;

  if v_status in ('completed', 'no_show') then
    raise exception 'NOT_CANCELLABLE';
  end if;

  v_hours := round(extract(epoch from (v_start - now())) / 3600.0, 2);

  -- Customers cannot cancel a booking that has already started; staff can
  -- (someone has to be able to clear a no-show).
  if v_hours <= 0 and p_actor = 'customer' then
    raise exception 'ALREADY_STARTED';
  end if;

  if v_pay_status = 'paid' then
    if v_hours >= v_policy.free_cancellation_hours then
      v_refund := v_price;
      v_outcome := 'refunded';
    else
      v_credit := (v_price * v_policy.late_credit_pct) / 100;
      v_outcome := case when v_credit > 0 then 'credited' else 'released' end;
    end if;
  else
    -- Never paid: just hand the slot back.
    v_outcome := 'released';
  end if;

  -- Apply
  if p_booking_type = 'court' then
    update court_bookings
      set status = 'cancelled',
          payment_status = case when v_refund > 0 then 'refunded'::payment_status else payment_status end
      where id = p_booking_id;
    update payments set status = 'refunded'
      where court_booking_id = p_booking_id and v_refund > 0;
  else
    update wash_bookings
      set status = 'cancelled',
          payment_status = case when v_refund > 0 then 'refunded'::payment_status else payment_status end
      where id = p_booking_id;
    update payments set status = 'refunded'
      where car_wash_booking_id = p_booking_id and v_refund > 0;
  end if;

  if v_credit > 0 then
    insert into credit_notes (
      email, amount_cents, remaining_cents, reason,
      source_court_booking_id, source_wash_booking_id, expires_at
    ) values (
      coalesce(v_email, 'unknown@invalid'),
      v_credit, v_credit,
      coalesce(p_reason, 'Late cancellation'),
      case when p_booking_type = 'court' then p_booking_id end,
      case when p_booking_type = 'car_wash' then p_booking_id end,
      now() + (v_policy.credit_valid_days || ' days')::interval
    )
    returning * into v_note;
  end if;

  insert into booking_cancellations (
    court_booking_id, wash_booking_id, actor, actor_user_id, reason,
    hours_before_start, refund_cents, credit_cents, credit_note_id
  ) values (
    case when p_booking_type = 'court' then p_booking_id end,
    case when p_booking_type = 'car_wash' then p_booking_id end,
    p_actor, p_actor_user_id, p_reason,
    v_hours, v_refund, v_credit, v_note.id
  );

  return query select
    v_outcome, v_refund, v_credit,
    v_note.code, v_note.expires_at, v_hours;
end;
$$;

-- =========================================================
-- redeem_credit() — apply a note to a new booking's price.
-- Returns how much was actually applied; partial use leaves the remainder on
-- the note.
-- =========================================================
create or replace function redeem_credit(
  p_code text,
  p_email text,
  p_amount_cents int
)
returns table (applied_cents int, remaining_cents int)
language plpgsql
as $$
declare
  v_note credit_notes;
  v_apply int;
begin
  select * into v_note from credit_notes
    where upper(code) = upper(p_code) for update;

  if not found then
    raise exception 'CREDIT_NOT_FOUND';
  end if;
  if lower(v_note.email) <> lower(p_email) then
    raise exception 'CREDIT_EMAIL_MISMATCH';
  end if;
  if v_note.expires_at < now() then
    raise exception 'CREDIT_EXPIRED';
  end if;
  if v_note.remaining_cents <= 0 then
    raise exception 'CREDIT_EXHAUSTED';
  end if;

  v_apply := least(v_note.remaining_cents, p_amount_cents);

  -- Alias the table: the bare column name would collide with this function's
  -- `remaining_cents` OUT parameter.
  update credit_notes cn set remaining_cents = cn.remaining_cents - v_apply
    where cn.id = v_note.id;

  return query select v_apply, v_note.remaining_cents - v_apply;
end;
$$;

-- ---------- RLS ----------
-- Both tables are reached only through the server-side service-role client;
-- no policy is added, so nothing is readable from the browser.
alter table credit_notes enable row level security;
alter table booking_cancellations enable row level security;
alter table cancellation_policy enable row level security;
create policy "public read cancellation policy" on cancellation_policy for select using (true);
