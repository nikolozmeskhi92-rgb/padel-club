-- =============================================================================
-- Peak court hour goes to GEL 80.
--
-- Peak (weekday 18:00-23:00) and the whole weekend now cost the same GEL 80 an
-- hour; weekday daytime stays at GEL 25. The 90-minute rates follow at 1.5x, so
-- the per-hour price a customer is quoted is the same whichever length they
-- pick — a 90-minute slot cheaper per hour than a 60 would just teach everyone
-- to book 90 and leave early.
--
-- Prices live in this table precisely so they can change without a deploy;
-- the resolver reads them at request time.
-- =============================================================================

update pricing_rules set price_cents =  8000 where scope = 'court' and label = 'Weekday Peak 60';
update pricing_rules set price_cents = 12000 where scope = 'court' and label = 'Weekday Peak 90';
update pricing_rules set price_cents =  8000 where scope = 'court' and label = 'Weekend 60';
update pricing_rules set price_cents = 12000 where scope = 'court' and label = 'Weekend 90';

-- Fail loudly if a label ever gets renamed and these updates quietly hit nothing.
do $$
declare wrong int;
begin
  select count(*) into wrong
  from pricing_rules
  where scope = 'court'
    and ((label like '%Peak 60' or label like 'Weekend 60') and price_cents <> 8000
      or (label like '%Peak 90' or label like 'Weekend 90') and price_cents <> 12000);
  if wrong > 0 then
    raise exception 'court peak pricing did not apply to % row(s)', wrong;
  end if;
end $$;
