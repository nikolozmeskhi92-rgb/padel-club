-- =============================================================================
-- A wash reserves exactly the time it was sold.
--
-- The changeover between cars used to be added to the reserved range, so a
-- 30-minute wash held the bay for 40. Wash slots are offered on the half hour,
-- and 40 minutes spills into the next one — a single 30-minute wash swallowed
-- both 10:00 and 10:30, and the bay could not be sold again until 11:00.
--
-- Across a 90-minute court booking that is one wash where the bay can
-- physically do three. The club noticed: "the bay shows as busy for 90 minutes
-- when the wash is 30".
--
-- Turnaround has not gone away — it is inside the advertised duration now, which
-- is how the desk actually runs the bays: car in at 10:00, gone by 10:30. The
-- parameter stays in the signature so a deployment mid-flight cannot break on an
-- argument that has disappeared; it is simply no longer added to the range.
--
-- Rows written before this keep their wider ranges. That is conservative rather
-- than wrong — those bays are merely held ten minutes longer than they need to
-- be — and they age out with the day.
-- =============================================================================

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
    -- Exactly what was sold. p_buffer_minutes is honoured if a caller still
    -- passes one, so the desk could hold a bay longer on purpose, but the app
    -- sends 0 and the turnaround lives inside p_duration_minutes.
    -- Default bounds are '[)', which is what we want. Written without the
    -- explicit literal because the Supabase SQL editor auto-closes brackets and
    -- turns '[)' into a syntax error when this is pasted in by hand.
    tstzrange(
      p_start,
      p_start + ((p_duration_minutes + coalesce(p_buffer_minutes, 0)) || ' minutes')::interval
    ),
    p_service, p_user_id, p_guest_name, p_guest_email,
    p_linked_court_booking_id, p_price_cents, p_payment_method, 'pending', 'unpaid'
  ) returning * into v_booking;

  return v_booking;
exception
  when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
end;
$$;
