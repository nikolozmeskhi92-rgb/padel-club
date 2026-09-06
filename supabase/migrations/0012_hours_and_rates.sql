-- =============================================================================
-- The club's real hours and rates.
--
-- Open 10:00–24:00, every day. Peak is weekday evenings from 19:00 and weekends
-- from noon, both running to close. Court hire is 60 GEL off-peak, 80 GEL peak.
--
-- The weekend used to be a single all-day peak rule, which is why it only
-- needed one row per duration. It now has a quiet morning too, so weekends get
-- an off-peak window of their own rather than being special-cased in code.
--
-- Opening hours themselves live in lib/time/club.ts (OPEN_HOUR / CLOSE_HOUR);
-- these windows must sit inside them, or a slot could be offered at a price no
-- rule covers and the booking would fail with NO_PRICING_RULE_MATCHED.
-- =============================================================================

-- Weekdays: quiet until 19:00.
update pricing_rules set start_time = '10:00', end_time = '19:00', price_cents = 6000,
       label = 'Weekday Off-Peak 60' where id = 1;
update pricing_rules set start_time = '10:00', end_time = '19:00', price_cents = 9000,
       label = 'Weekday Off-Peak 90' where id = 2;

-- Weekday evenings.
update pricing_rules set start_time = '19:00', end_time = '24:00', price_cents = 8000,
       label = 'Weekday Peak 60' where id = 3;
update pricing_rules set start_time = '19:00', end_time = '24:00', price_cents = 12000,
       label = 'Weekday Peak 90' where id = 4;

-- Weekends: peak from noon.
update pricing_rules set start_time = '12:00', end_time = '24:00', price_cents = 8000,
       label = 'Weekend Peak 60' where id = 5;
update pricing_rules set start_time = '12:00', end_time = '24:00', price_cents = 12000,
       label = 'Weekend Peak 90' where id = 6;

-- ...and the two hours before it, which had no rule of their own.
insert into pricing_rules (scope, label, days_of_week, start_time, end_time, duration_minutes, price_cents, priority)
select 'court', 'Weekend Off-Peak 60', '{0,6}', '10:00', '12:00', 60, 6000, 3
where not exists (select 1 from pricing_rules where label = 'Weekend Off-Peak 60');

insert into pricing_rules (scope, label, days_of_week, start_time, end_time, duration_minutes, price_cents, priority)
select 'court', 'Weekend Off-Peak 90', '{0,6}', '10:00', '12:00', 90, 9000, 3
where not exists (select 1 from pricing_rules where label = 'Weekend Off-Peak 90');

-- The wash windows were aligned to the old 08:00 opening; move them with it so
-- a 10:00 wash still matches a rule.
update pricing_rules set start_time = '10:00', end_time = '24:00'
 where scope = 'car_wash';
