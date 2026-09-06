-- =============================================================================
-- Two things the desk could not do: take money, and move a booking.
--
-- Both are written as functions rather than left to the API because both have
-- guards that must hold whoever is calling, and because both must be a single
-- atomic step. Rescheduling in particular: the overlap check and the write have
-- to be one operation, or two people moving into the same slot at the same
-- moment both succeed. Postgres already refuses that via the EXCLUDE constraint
-- on court_bookings — this function just makes the failure legible.
-- =============================================================================

-- ---------- 'card' as a way to pay ----------
-- The enum was written for online providers plus cash and comp. The club takes
-- a card at the desk like any other business, and recording that as 'cash'
-- would quietly corrupt the takings breakdown the nightly report is built on.
alter type payment_method add value if not exists 'card';

-- ---------- SETTLING ----------
-- Pay-on-site means every booking is created 'unpaid' and stays that way. There
-- was no path to mark one settled, so the paid/unpaid distinction on the court
-- map carried no information and the revenue figure counted money nobody had
-- handed over yet.
--
-- confirm_booking() already does the write, but it is the checkout path: it
-- assumes the booking is new and inserts a payment unconditionally, so calling
-- it twice records the same money twice. This refuses instead.
create or replace function settle_booking(
  p_booking_type text,             -- 'court' | 'car_wash'
  p_booking_id uuid,
  p_method payment_method,
  p_actor_user_id uuid default null
) returns table (booking_code text, amount_cents int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status booking_status;
  v_payment payment_status;
  v_price int;
  v_code text;
  v_ref text;
begin
  v_ref := case when p_actor_user_id is null then 'desk' else 'desk:' || p_actor_user_id::text end;
  if p_booking_type = 'court' then
    -- Columns are alias-qualified because this function's OUT parameters are
    -- called booking_code and amount_cents: an unqualified `booking_code` in
    -- the select list resolves to the variable, not the column, and plpgsql
    -- rejects it as ambiguous.
    select cb.status, cb.payment_status, cb.price_cents, cb.booking_code
      into v_status, v_payment, v_price, v_code
      from court_bookings cb where cb.id = p_booking_id for update;
  elsif p_booking_type = 'car_wash' then
    select wb.status, wb.payment_status, wb.price_cents, wb.booking_code
      into v_status, v_payment, v_price, v_code
      from wash_bookings wb where wb.id = p_booking_id for update;
  else
    raise exception 'UNKNOWN_BOOKING_TYPE';
  end if;

  if v_code is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  if v_payment = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;
  -- A cancelled booking is not a debt. Settling one would put money against a
  -- slot the club sold to somebody else.
  if v_status = 'cancelled' then
    raise exception 'NOT_SETTLEABLE';
  end if;

  if p_booking_type = 'court' then
    update court_bookings
       set payment_status = 'paid',
           status = case when status = 'pending' then 'confirmed' else status end
     where id = p_booking_id;
    insert into payments (court_booking_id, method, amount_cents, status, provider_ref)
    values (p_booking_id, p_method, v_price, 'paid', v_ref);
  else
    update wash_bookings
       set payment_status = 'paid',
           status = case when status = 'pending' then 'confirmed' else status end
     where id = p_booking_id;
    insert into payments (car_wash_booking_id, method, amount_cents, status, provider_ref)
    values (p_booking_id, p_method, v_price, 'paid', v_ref);
  end if;

  booking_code := v_code;
  amount_cents := v_price;
  return next;
end;
$$;

-- ---------- RESCHEDULING ----------
-- Moving a court booking to another court, time or length. The new price is
-- resolved by the caller (the same pricing rules the booking page uses) and
-- passed in, so there is exactly one pricing implementation rather than a
-- second one drifting inside the database.
--
-- The EXCLUDE constraint does the work that matters: if the destination
-- overlaps a live booking, this UPDATE raises 23P01 and nothing moves. There is
-- no window between "is it free?" and "take it".
create or replace function reschedule_court_booking(
  p_booking_id uuid,
  p_court_id int,
  p_start timestamptz,
  p_duration_minutes int,
  p_price_cents int
) returns table (
  booking_code text,
  old_price_cents int,
  new_price_cents int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status booking_status;
  v_old_price int;
  v_code text;
begin
  select cb.status, cb.price_cents, cb.booking_code
    into v_status, v_old_price, v_code
    from court_bookings cb where cb.id = p_booking_id for update;

  if v_code is null then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  -- A cancelled booking has released its slot and may have issued a refund or a
  -- credit note; moving it would resurrect it without any of that being undone.
  if v_status in ('cancelled', 'completed', 'no_show') then
    raise exception 'NOT_RESCHEDULABLE';
  end if;

  update court_bookings
     set court_id = p_court_id,
         -- tstzrange's default bounds are '[)', which is what every other slot in
         -- this schema uses: inclusive start, exclusive end, so 19:00-20:00 and
         -- 20:00-21:00 sit back to back without overlapping.
         slot = tstzrange(p_start, p_start + make_interval(mins => p_duration_minutes)),
         duration_minutes = p_duration_minutes,
         price_cents = p_price_cents
   where id = p_booking_id;

  booking_code := v_code;
  old_price_cents := v_old_price;
  new_price_cents := p_price_cents;
  return next;
end;
$$;

-- Only the service role: both are staff actions, gated by getStaffUser() in
-- the API route rather than by whoever happens to hold a session.
grant execute on function settle_booking(text, uuid, payment_method, uuid) to service_role;
grant execute on function reschedule_court_booking(uuid, int, timestamptz, int, int) to service_role;
