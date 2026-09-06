-- =============================================================================
-- Who at the club hears about a new booking.
--
-- Until now nothing told the club a booking had happened: the customer got an
-- email and the desk found out by looking at the dashboard. That works while
-- one person watches the screen and fails the first evening nobody does.
--
-- A table rather than an environment variable, because the list changes — a new
-- manager starts, someone leaves, the owner wants their personal address on it
-- for a week — and none of those should need a redeploy.
-- =============================================================================

create table if not exists notification_recipients (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  label text,                                   -- "Front desk", "Nika", whatever the club calls them
  -- Switching someone off is not the same as removing them: a manager on
  -- holiday comes back, and re-typing an address is how a typo gets in.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One row per address, case-insensitively: adding Nika@ and nika@ would send
-- two copies of every alert to the same inbox.
create unique index if not exists idx_notification_recipients_email
  on notification_recipients (lower(email));

alter table notification_recipients enable row level security;

-- Staff only, and only through a session. The API routes use the service role
-- and gate on getStaffUser(), so this policy exists to make sure the table is
-- not readable by a signed-in customer poking at PostgREST — the list is a set
-- of the club's private addresses.
drop policy if exists "notification_recipients: staff only" on notification_recipients;
create policy "notification_recipients: staff only" on notification_recipients
  for all
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('staff','admin')));
