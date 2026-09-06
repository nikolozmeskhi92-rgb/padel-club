import { CLUB_NAME, CLUB_ADDRESS, CLUB_PHONE } from "@/lib/club";
import { pageTitle } from "@/lib/club";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata = { title: pageTitle("Privacy") };

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="7 September 2026">
      <section>
        <p>
          This page describes what {CLUB_NAME} does with the information you give us when
          you book a court or a car wash. It is written to be read, not to be skimmed
          past.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <p>Only what a booking needs:</p>
        <ul>
          <li>
            <strong>Your name, email address and phone number.</strong> The name and phone
            are how the front desk finds you when you arrive; the email is where the
            confirmation and the cancellation link go.
          </li>
          <li>
            <strong>Your bookings.</strong> Which court or wash bay, when, how long, what
            it cost, and whether it has been paid.
          </li>
          <li>
            <strong>If you sign in with Google:</strong> your name and email address from
            that account, and nothing else. We do not request access to your Gmail, your
            files, your contacts or your calendar, and we could not read them if we
            wanted to.
          </li>
        </ul>
        <p>
          We do not collect payment card details, because nothing is paid on this site —
          you pay at the club.
        </p>
      </section>

      <section>
        <h2>Where it is kept, and who can see it</h2>
        <p>
          Bookings are stored in a database hosted by Supabase, on servers in the
          European Union. Confirmation emails are sent through Resend. Both companies
          process this data on our behalf and are not free to use it for anything else.
        </p>
        <p>
          Inside the club, only staff accounts can see bookings. Signing in as a customer
          shows you your own bookings and nobody else&apos;s. We do not sell this
          information, and we do not share it with anyone for advertising.
        </p>
      </section>

      <section>
        <h2>Cookies</h2>
        <p>
          If you sign in, we set a cookie that keeps you signed in. That is the only
          cookie the site sets. There is no advertising or analytics tracking on this
          site, which is why there is no cookie banner asking you to accept any.
        </p>
        <p>
          Your browser also remembers the name and phone number you last typed at
          checkout, so you do not have to type them again. That is stored on your own
          device, never sent to us for that purpose, and clearing your browser data
          removes it.
        </p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          Bookings are kept as a record of the club&apos;s trading — we need them for
          accounts, for disputes about who booked what, and to know how busy the courts
          are. If you ask us to delete your personal details, we will remove your name,
          email and phone from your bookings and keep only the anonymous record that a
          court was booked at that time.
        </p>
      </section>

      <section>
        <h2>What you can ask for</h2>
        <p>You can ask us at any time to:</p>
        <ul>
          <li>tell you exactly what we hold about you;</li>
          <li>correct anything that is wrong;</li>
          <li>delete your details, as described above;</li>
          <li>send you a copy of your bookings.</li>
        </ul>
        <p>
          Ask by email or at the desk and we will do it. You do not have to give a reason.
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
