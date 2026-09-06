-- =============================================================================
-- Every signed-in user needs a `profiles` row.
--
-- `profiles` was only ever populated by hand (the README tells you to INSERT
-- one after creating a user in the dashboard). That works for a single admin
-- typed in at setup time, but it breaks the moment anyone signs up on their
-- own — an OAuth sign-in creates the `auth.users` row and nothing else, so
-- every role check reads NULL and the person is bounced out of /admin with no
-- explanation, while RLS treats them as having no role at all.
--
-- The row is now created by a trigger on auth.users, defaulting to 'customer'.
-- Promoting someone to staff/admin stays a deliberate act:
--
--   update profiles set role = 'admin' where id = '<auth-user-uuid>';
--
-- `full_name` is taken from whatever the provider gave us. Google sends
-- `name`, Facebook sends `name`, email sign-ups usually send nothing — hence
-- the coalesce chain rather than a single key.
-- =============================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    'customer'
  )
  on conflict (id) do nothing;   -- re-running the trigger must never fail a signup
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill anyone who signed up before this trigger existed.
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    split_part(u.email, '@', 1)
  ),
  'customer'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- A signed-in customer should be able to see the bookings attached to their
-- account. The existing policies already allow this via `auth.uid() = user_id`;
-- what was missing is that guests booking while signed in never had their
-- user_id recorded. That is an application change, not a schema one.
