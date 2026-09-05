# Nexus Padel Club — Booking Platform

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

## What's intentionally left as follow-up work

This is a full, working scaffold — not a finished audited production system.
Before going live:
- Swap the manual "cash confirms immediately" logic in the booking routes for
  real payment webhook handlers (PayPal IPN/webhooks, BOG/TBC callback URLs).
- Add rate limiting to the public booking API routes.
- Add a booking cancellation/refund flow and staff-side "reschedule" UI.
- Add end-to-end tests around the concurrent-booking race condition
  (the DB constraint is solid; worth a load test to confirm under real traffic).
- Replace the placeholder map embed on `/directions` with your actual location.
