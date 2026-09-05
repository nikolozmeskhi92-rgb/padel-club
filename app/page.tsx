import Link from "next/link";
import { ArrowRight, Shirt, Timer, ShieldCheck, MapPin, Clock } from "lucide-react";
import { formatMoney } from "@/lib/currency";

export default function HomePage() {
  return (
    <div>
      {/* ---------- HERO ---------- */}
      <section className="relative isolate overflow-hidden bg-brand-dark">
        {/*
          Muted + playsInline + autoPlay is the only combination iOS Safari will
          start on its own. The poster carries the first paint so the headline
          never sits on a black rectangle while the video buffers, and
          preload="metadata" keeps the 1.3 MB off the critical path.

          MP4 is listed first because H.264 encodes this clip smaller than VP9
          here (1.3 MB vs 1.7 MB) and plays essentially everywhere; the WebM is
          the fallback for builds shipped without proprietary codecs. Don't add
          a `media` attribute to these — browsers ignore it inside <video>
          (unlike <picture>), so a "mobile cut" would just be served to everyone.
        */}
        <video
          className="absolute inset-0 -z-10 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/media/hero-poster.jpg"
          aria-hidden="true"
          tabIndex={-1}
        >
          <source src="/media/hero.mp4" type="video/mp4" />
          <source src="/media/hero.webm" type="video/webm" />
        </video>

        {/* Two overlays: a vertical wash for overall contrast, and a stronger
            left-side gradient so the headline holds against the bright court. */}
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-dark/80 via-brand-dark/55 to-brand-dark/85"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-dark/85 via-brand-dark/40 to-transparent"
          aria-hidden="true"
        />

        <div className="mx-auto max-w-6xl px-6 py-24 md:py-32">
          <p className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-white/85">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-brand-accent" />
              Open 08:00–23:00 daily
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-brand-accent" />
              10 courts · 4 wash bays
            </span>
          </p>

          <h1 className="max-w-3xl font-heading text-5xl font-extrabold uppercase leading-[1.05] tracking-tight text-white md:text-7xl">
            Your court is waiting.
            <br />
            Book it in 20 seconds.
          </h1>

          <p className="mt-6 max-w-xl text-lg text-white/80">
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
              className="flex items-center gap-2 rounded-court border border-white/25 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            >
              <Shirt className="h-4 w-4" />
              Book a car wash only
            </Link>
          </div>

          {/* Prices are the first thing a new visitor looks for; giving the
              cheapest real rate here saves them a trip into the booking grid. */}
          <p className="mt-8 text-sm text-white/65">
            From {formatMoney(2500)} an hour off-peak · {formatMoney(800)} car wash
          </p>
        </div>
      </section>

      {/* ---------- TRUST STRIP ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-8 sm:grid-cols-3">
          <Feature
            icon={<Timer className="h-5 w-5" />}
            title="Instant confirmation"
            body="The court you see is the court you get. Slots lock the moment you book — no double-bookings, ever."
          />
          <Feature
            icon={<Shirt className="h-5 w-5" />}
            title="Courtside car wash"
            body="Drop your keys before you play, drive off clean when you're done. Add it to any court booking."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Cancel with confidence"
            body="Free cancellation up to 24 hours before your slot. Cancel later and the full amount becomes club credit."
          />
        </div>
      </section>

      {/* ---------- GALLERY ---------- */}
      <section className="border-y border-line bg-surface-muted">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight text-ink md:text-3xl">
            Panoramic glass. Proper surfaces.
          </h2>
          <p className="mt-2 max-w-lg text-ink-muted">
            Seven outdoor courts and three indoor, so the weather never cancels your game.
          </p>

          {/* Asymmetric on desktop: one tall portrait beside two stacked
              landscapes, so the shapes of the photos do the composition
              rather than a row of identical crops. */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <figure className="relative overflow-hidden rounded-court lg:row-span-2">
              <img
                src="/media/racket-net.jpg"
                alt="A padel racket and ball resting on a blue court beside the net"
                className="h-64 w-full object-cover lg:h-full"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <figure className="relative overflow-hidden rounded-court">
              <img
                src="/media/court-overhead.jpg"
                alt="Overhead view of a player's shoes, racket and ball on the blue court surface"
                className="h-64 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <figure className="relative overflow-hidden rounded-court">
              <img
                src="/media/net-handoff.jpg"
                alt="Two players passing a racket to each other across the net"
                className="h-64 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </figure>
            <figure className="relative overflow-hidden rounded-court sm:col-span-2">
              <img
                src="/media/racket-mint.jpg"
                alt="A player setting a mint-green padel racket down on the court in low sun"
                className="h-64 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </figure>
          </div>
        </div>
      </section>

      {/* ---------- CROSS-SELL CTA ---------- */}
      <section className="relative isolate overflow-hidden border-b border-line">
        {/* The hero's own still, reused here so no photo appears twice on the page. */}
        <img
          src="/media/hero-poster.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full object-cover object-center"
          loading="lazy"
          decoding="async"
        />
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-dark/95 via-brand-dark/80 to-brand-dark/50"
          aria-hidden="true"
        />
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-20 md:flex-row md:items-center">
          <div>
            <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight text-white md:text-3xl">
              Finish your match, drive off in a clean car.
            </h2>
            <p className="mt-2 max-w-md text-white/75">
              Add a wash cycle to your court booking — same checkout, ready when you are.
            </p>
          </div>
          <Link
            href="/book"
            className="shrink-0 rounded-court bg-brand px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-[1.02]"
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
