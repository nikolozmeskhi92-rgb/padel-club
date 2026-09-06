import { CLUB_NAME, CLUB_ADDRESS, CLUB_PHONE, pageTitle } from "@/lib/club";
import { CLOSE_HOUR, OPEN_HOUR, FREE_CANCELLATION_HOURS, PUBLIC_HORIZON_DAYS } from "@/lib/time/club";
import { LegalPage } from "@/components/legal/LegalPage";
import { formatMoney } from "@/lib/currency";

export const metadata = { title: pageTitle("Terms") };

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function TermsPage() {
  return (
    <LegalPage title="Booking terms" updated="7 September 2026">
      <section>
        <p>
          These are the terms you agree to when you book a court or a car wash at{" "}
          {CLUB_NAME}. They are short because the arrangement is simple.
        </p>
      </section>

      <section>
        <h2>Booking</h2>
        <ul>
          <li>
            The club is open {hh(OPEN_HOUR)}&ndash;{hh(CLOSE_HOUR)}, every day.
          </li>
          <li>
            Online booking runs {PUBLIC_HORIZON_DAYS} days ahead. For anything further
            out, get in touch and we will arrange it.
          </li>
          <li>
            A slot is yours the moment the booking is confirmed and you have a booking
            code. Two people cannot hold the same court at the same time — the system
            will not allow it.
          </li>
          <li>
            Court hire is {formatMoney(6000)} an hour off-peak and {formatMoney(8000)} an
            hour at peak times. Peak is weekday evenings from 19:00 and weekends from
            12:00. The price you see when you book is the price you pay.
          </li>
        </ul>
      </section>

      <section>
        <h2>Paying</h2>
        <p>
          Nothing is charged online. You pay at the club when you arrive, and the booking
          is held for you until then.
        </p>
      </section>

      <section>
        <h2>Cancelling</h2>
        <ul>
          <li>
            Cancel more than {FREE_CANCELLATION_HOURS} hours before your slot and you owe
            nothing.
          </li>
          <li>
            Cancel inside {FREE_CANCELLATION_HOURS} hours and, if you have already paid,
            the amount becomes club credit you can use on any future booking rather than
            a refund.
          </li>
          <li>
            Every confirmation email carries a cancellation link. If you have lost it, you
            can find the booking again with your code and email, or call the club.
          </li>
        </ul>
      </section>

      <section>
        <h2>On court</h2>
        <ul>
          <li>Arrive ten minutes before your slot.</li>
          <li>
            Non-marking shoes are required on all courts. We may refuse play in shoes that
            will damage the surface.
          </li>
          <li>
            Your slot ends at the time it says. The court is booked after you, so please
            leave it promptly.
          </li>
        </ul>
      </section>

      <section>
        <h2>Car wash</h2>
        <p>
          A wash can be added to a court booking when a bay is free during your match. We
          take reasonable care of your car; please take valuables with you. Drop-off
          closes fifteen minutes before the club does.
        </p>
      </section>

      <section>
        <h2>If we have to cancel</h2>
        <p>
          Occasionally we may have to cancel a booking — a flooded court, a burst pipe, a
          closure we did not choose. If that happens you get the full amount back, and we
          will tell you as early as we can.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          {CLUB_NAME}
          {CLUB_ADDRESS ? `, ${CLUB_ADDRESS}` : ""}
          {CONTACT_EMAIL ? ` · ${CONTACT_EMAIL}` : ""}
          {CLUB_PHONE ? ` · ${CLUB_PHONE}` : ""}
        </p>
      </section>
    </LegalPage>
  );
}
