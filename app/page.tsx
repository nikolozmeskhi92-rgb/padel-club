import Link from "next/link";
import { ArrowRight, Shirt, Timer, ShieldCheck } from "lucide-react";

export default function HomePage() {
  return (
    <div>
      {/* HERO */}
      <section className="court-lines-bg relative overflow-hidden border-b border-line">
        <div className="mx-auto max-w-6xl px-6 py-28 md:py-36">
          <p className="mb-5 text-sm font-semibold text-brand">10 courts · open 08:00–23:00 daily</p>
          <h1 className="max-w-3xl font-heading text-5xl font-extrabold uppercase leading-[1.05] tracking-tight text-ink md:text-7xl">
            Your court is waiting.
            <br />
            Book it in 20 seconds.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-muted">
            Real-time availability across all 10 courts, instant confirmation, and
            a clean car from our wash bay — all in one checkout.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/book"
              className="group flex items-center gap-2 rounded-court bg-brand px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
            >
              Book a court
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/car-wash"
              className="flex items-center gap-2 rounded-court border border-line px-6 py-3.5 text-sm font-semibold text-ink transition-colors hover:border-ink-muted/40"
            >
              <Shirt className="h-4 w-4" />
              Book a car wash only
            </Link>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-8 sm:grid-cols-3">
          <Feature
            icon={<Timer className="h-5 w-5" />}
            title="Instant confirmation"
            body="Atomic slot-locking means the court you see is the court you get — no double-bookings, ever."
          />
          <Feature
            icon={<Shirt className="h-5 w-5" />}
            title="Courtside car wash"
            body="Drop your kit off before you play, pick up fresh gear when you're done. Add it to any court booking."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Flexible payment"
            body="Pay by TBC, BOG, or PayPal. Sandbox mode available for testing before going live."
          />
        </div>
      </section>

      {/* CROSS-SELL CTA */}
      <section className="border-y border-line bg-surface-base shadow-card">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
          <div>
            <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight text-ink md:text-3xl">
              Finish your match, drive off in a clean car.
            </h2>
            <p className="mt-2 max-w-md text-ink-muted">
              Add a wash cycle to your court booking — same checkout, ready when you are.
            </p>
          </div>
          <Link
            href="/book"
            className="shrink-0 rounded-court bg-brand-dark px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
          >
            Book court + car wash
          </Link>
        </div>
      </section>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-court border border-line bg-surface-base shadow-card p-6">
      <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-brand-accent/10 text-brand">
        {icon}
      </div>
      <h3 className="mb-2 font-heading text-base font-bold text-ink">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
    </div>
  );
}
