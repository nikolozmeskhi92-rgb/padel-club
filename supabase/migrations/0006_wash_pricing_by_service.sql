-- =============================================================================
-- Car wash pricing was resolved by duration alone, and priced a day that no
-- longer matches the club's opening hours.
--
-- 1. Two 30-minute wash services exist — Quick Wash (₾8) and Express Rinse
--    (₾12) — and `resolvePrice()` matched on scope + duration + day + window,
--    which both of them satisfy. With equal priority the tie-break picked the
--    cheaper row, so a customer who chose Express Rinse saw ₾12.00 in the UI
--    and was charged ₾8.00. The service the customer picked was passed to
--    `create_wash_booking` but never used to price it.
--
--    `service` is added to pricing_rules so a wash rule names the service it
--    prices. Court rules leave it null and keep matching on duration.
--
-- 2. The wash rules ran 07:00-22:00 while the club opens 08:00-23:00. The
--    booking UI now offers the club's full day, so 22:00-22:59 matched no rule
--    and came back as NO_PRICING_RULE_MATCHED; 07:00-07:59 was priced but is
--    before opening. Both ends realigned.
-- =============================================================================

alter table pricing_rules
  add column if not exists service text;

-- Only wash rules carry a service; the check keeps court rules honest.
alter table pricing_rules
  drop constraint if exists pricing_rules_service_scope_ck;
alter table pricing_rules
  add constraint pricing_rules_service_scope_ck check (
    (scope = 'car_wash' and service is not null)
    or (scope = 'court' and service is null)
  ) not valid;

update pricing_rules set service = 'quick_wash'   where scope = 'car_wash' and label = 'Quick Wash 30';
update pricing_rules set service = 'full_detail'  where scope = 'car_wash' and label = 'Full Detail 60';
update pricing_rules set service = 'express_rinse' where scope = 'car_wash' and label = 'Express Rinse 30';

-- Any wash rule added before this migration that we don't recognise would break
-- the constraint, so fail loudly here rather than at the next insert.
do $$
declare unnamed int;
begin
  select count(*) into unnamed from pricing_rules where scope = 'car_wash' and service is null;
  if unnamed > 0 then
    raise exception 'pricing_rules has % car_wash row(s) with no service set', unnamed;
  end if;
end $$;

alter table pricing_rules validate constraint pricing_rules_service_scope_ck;

-- Align the wash trading day with the club's actual opening hours (08:00-23:00).
update pricing_rules
   set start_time = '08:00', end_time = '23:00'
 where scope = 'car_wash';

-- One rule per (scope, service, duration, day-set, window) — this is what stops
-- a second 30-minute wash rule silently out-competing an existing one again.
create unique index if not exists pricing_rules_wash_service_uq
  on pricing_rules (service, duration_minutes, start_time, end_time, days_of_week)
  where scope = 'car_wash';
