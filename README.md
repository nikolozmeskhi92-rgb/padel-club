# Luki Padel — Booking Platform

A production-shaped booking platform for a padel club: 10 courts + 4 car wash
bays, atomic double-booking prevention, a recommendation engine that cross-sells
the wash bay against your court time, Resend email confirmations, and a nightly
Telegram financial report to the admin group.

## Stack
Next.js 14 (App Router) · Tailwind CSS · Framer Motion · Recharts · Supabase
(Postgres + Auth) · Resend · Telegram Bot API · Contentlayer (MDX blog)

## What's implemented

- **Schema** (`supabase/migrations/0001_init.sql`) — courts, wash bays, bookings,
  pricing rules, equipment, payments, maintenance overrides, RLS policies.
  Double-booking is prevented by a Postgres `EXCLUDE` constraint on
  `(court_id, slot)` / `(box_id, slot)` — this holds even under concurrent
  requests, so the guarantee lives in the database, not just the API layer.
- **Atomic booking RPCs** — `create_court_booking`, `create_wash_booking`,
  `confirm_booking` wrap insert + line items + payment into one transaction.
- **Dynamic pricing** — `pricing_rules` table drives peak/off-peak/weekend rates;
  `lib/pricing/index.ts` resolves the matching rule server-side (the API never
  trusts a client-sent price).
- **Booking flow** (`/book`) — 7-day date strip, 10×30 slot grid across all
  courts, live availability from `/api/bookings`, equipment add-ons, checkout
  with TBC/BOG/PayPal method selection (sandbox-ready — wire real provider
  SDKs into `app/api/checkout`).
- **Car wash flow** (`/car-wash`) — standalone booking with a 10-min changeover
  buffer baked into the reserved time range so back-to-back cars never collide.
- **Cross-sell recommendation engine** (`lib/carwash/suggest.ts`) — once a
  customer picks a court + time, `/api/car-wash/suggestions` classifies the
  best available wash bay into one of four honest outcomes: a perfect fit
  (wash finishes before the match ends), a close overlap (spills a little
  outside the match window), court-only (wash is booked out near that time,
  with the nearest alternative shown), or no wash available today at all.
  Selecting the recommendation books it linked to the court booking
  (`linkedCourtBookingId`) in the same checkout.
- **Email** — `emails/BookingConfirmation.tsx` (React Email) sent via Resend
  with a generated QR check-in code (`lib/email/send.ts`).
- **Cancellations & credit** (`supabase/migrations/0004`, `/cancel/[token]`) —
  every booking carries an unguessable `cancel_token`; the confirmation email
  links straight to it, so guests cancel without an account. Cancel more than
  `free_cancellation_hours` ahead (default 24) and the card is refunded; cancel
  inside the window and the club keeps the cash while the customer gets a
  credit note for the full amount, redeemable against a future booking. The
  page states which outcome applies *before* the customer confirms. Cancelling
  flips `status` to `'cancelled'`, which the partial `EXCLUDE` constraints
  already read as "slot is free" — the court goes back on sale with no extra
  bookkeeping. Policy lives in a one-row `cancellation_policy` table, editable
  without a deploy.
- **Rate limiting** (`supabase/migrations/0003`, `lib/rate-limit.ts`) — a fixed
  window counted in Postgres, not process memory, because serverless instances
  don't share a heap. 10 bookings / 10 min, 120 availability reads / min,
  60 wash suggestions / min, per IP. Fails open so a database blip can't take
  booking offline.
- **Telegram** — `lib/telegram/sendReport.ts` builds the nightly summary from
  the `get_daily_summary` SQL function (revenue split, utilization %, payment
  method breakdown) and posts it via the Bot API. Triggered by:
  - Vercel Cron at 23:59 daily (`vercel.json` → `/api/cron/telegram-report`)
  - Manual "Send report now" button in `/admin`
  - `npm run telegram:report` for non-Vercel hosts (system cron / GH Actions)
- **Admin dashboard** (`/admin`) — Supabase Auth + role check (`staff`/`admin`
  only), 14-day revenue & occupancy charts (Recharts), today's court grid and
  car wash queue, CSV export, manual maintenance override endpoint.
- **Blog** (`/blog`) — Contentlayer + MDX, card index + individual post pages.

## Testing

```bash
./scripts/db-test.sh     # needs a local Postgres; touches nothing in Supabase
```

Spins up a throwaway Postgres, applies every migration in order, runs 47
assertions over the booking rules, the cancellation/credit policy, the report
arithmetic and the rate limiter, then fires 40 concurrent connections at a
single slot. Exactly one booking may commit; 39 must be rejected with
`SLOT_TAKEN` and nothing else. A second concurrency pass checks the rate-limit
counter is atomic (40 simultaneous hits against a limit of 10 let through
exactly 10).

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase, Resend, Telegram keys
```

1. Create a Supabase project, then run the migration:
   ```bash
   supabase link --project-ref your-project-ref
   supabase db push
   # or paste supabase/migrations/0001_init.sql into the Supabase SQL editor
   ```
2. Create your first staff user in Supabase Auth, then set their role:
   ```sql
   insert into profiles (id, full_name, role)
   values ('<auth-user-uuid>', 'Your Name', 'admin');
   ```
3. Create a Telegram bot via [@BotFather](https://t.me/BotFather), add it to
   your admin group, and get the group's chat ID (e.g. via `getUpdates` or
   [@userinfobot](https://t.me/userinfobot)).
4. Get a Resend API key and verify your sending domain.
5. `npm run dev` → http://localhost:3000

## Payment providers

The checkout UI is provider-agnostic and sandbox-ready. `paymentMethod` is
stored on every booking; wire up real charge flows in:
- `app/api/checkout/` — create a route per provider (`paypal`, `bog`, `tbc`)
- On success, call the `confirm_booking` RPC with the provider's transaction
  reference — this is what flips `payment_status` to `paid` and fires the
  "paid" email state.

## Known issues

- **Next.js 14 is unpatched.** Every current advisory's fix range ends in
  15.5.x, so no 14.x release carries the fixes. `next.config.mjs` removes the
  two features that made most of them reachable here (an open image-optimizer
  wildcard and a raised Server Action payload cap — neither was used), but the
  upgrade to 15.5.x is still outstanding. It needs React 19 and will pull
  framer-motion, recharts and radix with it, so it deserves its own pass.
- **The cancellation flow has not been exercised against a live Supabase.** The
  SQL is covered by `db-test.sh` against real Postgres, and the page renders,
  but the full round trip (email link -> cancel -> credit code) needs a real
  project and a Resend key.

## What's intentionally left as follow-up work

This is a full, working scaffold — not a finished audited production system.
Before going live:
- Swap the manual "cash confirms immediately" logic in the booking routes for
  real payment webhook handlers (PayPal IPN/webhooks, BOG/TBC callback URLs).
- Let customers redeem credit notes at checkout. `redeem_credit()` exists and is
  tested; the checkout UI does not call it yet, so credit is currently issued
  but not spendable.
- Staff-side cancel/reschedule in `/admin`. `cancel_booking()` already accepts
  `p_actor = 'staff'`; only the UI is missing.
- Email the customer their credit code. The cancel page shows it once — if they
  close the tab before writing it down, it is only recoverable from the
  database.
- Move the Vercel cron off `59 23 * * *`. Vercel schedules in UTC, so that
  fires at 03:59 Tbilisi time. `59 19 * * *` delivers the report at 23:59 local.
- Replace the placeholder map embed on `/directions` with your actual location.
