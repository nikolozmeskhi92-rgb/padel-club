import Link from "next/link";
// Car, not Shirt: the icon next to "car wash" was a t-shirt, which reads as
// merchandise. Same icon family, so the weight and stroke still match the row.
import { ArrowRight, Car, Timer, ShieldCheck, MapPin, Clock } from "lucide-react";
import { formatMoney } from "@/lib/currency";
import { CLOSE_HOUR, FREE_CANCELLATION_HOURS, OPEN_HOUR } from "@/lib/time/club";

export default function HomePage() {
  return (
    <div>
      {/* ---------- HERO ---------- */}
      {/*
        On a phone the hero is given real height and the copy is anchored to the
        bottom of it. A video hero that is only as tall as its text is not a
        video hero: there was nowhere for the clip to be seen except behind the
        words, which is what forced the scrim so dark. With the copy at the
        foot, the top half can be nearly clear and the bottom can stay dark
        enough to read against — both, instead of a compromise that was neither.

        svh, not vh: on iOS vh is the height with the address bar hidden, so the
        hero would be taller than the screen on arrival. A browser that does not
        know svh ignores the line and gets the old auto height, which is fine.
      */}
      <section className="relative isolate flex min-h-[78svh] flex-col justify-end overflow-hidden bg-brand-dark md:block md:min-h-0">
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
          className="absolute inset-0 z-0 h-full w-full object-cover"
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

        {/*
          One scrim on a phone, two on a desktop.

          Both used to run top-to-bottom on a phone, and stacked alpha does not
          add — it compounds: 0.80 over 0.85 leaves 3% of the video showing, and
          0.55 over 0.60 leaves 18%. The court had effectively been painted out.

          A single layer now, weighted so the video is clearest at the top,
          where nothing is written, and darkest at the bottom, where the buttons
          and the price sit. Measured against the brightest frames of the clip,
          white text over the middle of this gradient lands near 6:1 — well past
          the 4.5:1 that small text needs and double the 3:1 the headline does —
          so there is real room to let the video through.

          The desktop pair is untouched: the second one is a left-to-right fade
          that holds the headline against the bright half of the court, and a
          horizontal fade clears a column nobody has on a 390px screen.
        */}
        {/* Phone: four stops, not three, because the shape matters more than the
            depth. Nearly clear over the top third where nobody is reading, then
            a fast ramp into a floor dark enough to hold white text against the
            brightest frame of the clip. The numbers are measured — see the
            contrast check in the commit that introduced them — not eyeballed. */}
        <div
          className="absolute inset-0 z-0 bg-[linear-gradient(to_bottom,rgba(0,26,51,0.08)_0%,rgba(0,26,51,0.12)_20%,rgba(0,26,51,0.58)_36%,rgba(0,26,51,0.74)_100%)] md:hidden"
          aria-hidden="true"
        />
        {/* Desktop, unchanged: a vertical wash for overall contrast, and a
            left-to-right fade that holds the headline against the bright half
            of the court. A horizontal fade clears a column nobody has on a
            390px screen, which is why the phone does not get it. */}
        <div
          className="absolute inset-0 z-0 hidden bg-gradient-to-b from-brand-dark/80 via-brand-dark/55 to-brand-dark/85 md:block"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 z-0 hidden bg-gradient-to-r from-brand-dark/85 via-brand-dark/40 to-transparent md:block"
          aria-hidden="true"
        />

        {/*
          z-10 and a GPU layer, not a negative z-index on the video.

          iOS Safari composites a playing <video> on the GPU, and anything the
          page pushed behind it with a negative z-index can end up genuinely
          behind that layer: on an iPhone the headline was invisible until you
          touched the screen and forced a repaint. Keeping every layer at zero
          or above, and giving this one its own compositing layer, means the
          text is painted over the video by the same machinery that draws it.
        */}
        <div className="relative z-10 mx-auto w-full max-w-6xl transform-gpu px-7 pb-10 pt-12 sm:px-8 sm:py-24 md:py-32">
          {/*
            The opening hours and the supporting paragraph move out of the hero
            on a phone and sit on the band below it — see the section that
            follows. Four blocks of text over video is three too many on a
            390px screen: it forces the scrim dark enough to hide the clip that
            was the point of shooting it. The hero keeps the promise and the two
            buttons; the facts read better on white anyway, where their contrast
            does not depend on what the video is doing behind them.
          */}
          <p className="mb-5 hidden flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-white/85 md:flex">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-brand-accent" />
              Open {String(OPEN_HOUR).padStart(2, "0")}:00&ndash;{String(CLOSE_HOUR).padStart(2, "0")}:00 daily
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 text-brand-accent" />
              10 courts · 4 wash bays
            </span>
          </p>

          {/*
            48px was a desktop headline shrunk to fit rather than a phone one:
            uppercase extrabold at that size ran the full width of a 390px
            screen, wrapped to four lines and left no air at either edge. The
            line break is only forced once there is room for it — on a phone the
            text wraps where it naturally falls.
          */}
          <h1 className="max-w-3xl font-heading text-[1.75rem] font-extrabold uppercase leading-[1.12] tracking-tight text-white sm:text-5xl sm:leading-[1.05] md:text-7xl">
            Your court is waiting.
            <br className="hidden sm:inline" />{" "}
            Book it in 20 seconds.
          </h1>

          <p className="mt-5 hidden max-w-xl text-base text-white/80 sm:mt-6 sm:text-lg md:block">
            Real-time availability across all 10 courts, instant confirmation, and
            a clean car from our wash bay — all in one checkout.
          </p>

          {/* Full width on a phone: two buttons at their natural width leave a
              ragged edge, and a thumb wants the whole row to aim at. */}
          <div className="mt-8 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:gap-4">
            <Link
              href="/book"
              className="group flex items-center justify-center gap-2 rounded-court bg-brand px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] sm:justify-start"
            >
              Book a court
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/car-wash"
              className="flex items-center justify-center gap-2 rounded-court border border-white/25 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 sm:justify-start"
            >
              <Car className="h-4 w-4" />
              Book a car wash only
            </Link>
          </div>

          {/* Prices are the first thing a new visitor looks for; giving the
              cheapest real rate here saves them a trip into the booking grid. */}
          <p className="mt-6 text-sm text-white/75 sm:mt-8 sm:text-white/65">
            From {formatMoney(6000)} an hour off-peak · {formatMoney(800)} car wash
          </p>
        </div>
      </section>

      {/* ---------- WHAT THE HERO USED TO CARRY (phones only) ---------- */}
      {/*
        The same two pieces of copy, on white, directly under the video. Text on
        a solid surface can be read whatever frame the clip is on, and lifting
        them out is what let the scrim come up enough to see the court at all.

        White against the page's muted grey marks it as its own band rather than
        stray copy, and it reads in the order someone arrives in: the promise
        and the button first, then when the club is open and what it has, then
        the detail. Above md the hero carries them as before and this is gone,
        so neither ever appears twice.
      */}
      <section className="border-b border-line bg-surface-base md:hidden">
        <div className="mx-auto max-w-6xl px-7 py-6 sm:px-8">
          <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold text-ink">
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 shrink-0 text-brand" />
              Open {String(OPEN_HOUR).padStart(2, "0")}:00&ndash;{String(CLOSE_HOUR).padStart(2, "0")}:00 daily
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0 text-brand" />
              10 courts · 4 wash bays
            </span>
          </p>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            Real-time availability across all 10 courts, instant confirmation, and
            a clean car from our wash bay — all in one checkout.
          </p>
        </div>
      </section>

      {/* ---------- TRUST STRIP ---------- */}
      <section className="mx-auto max-w-6xl px-7 sm:px-8 py-16">
        <div className="grid gap-8 sm:grid-cols-3">
          <Feature
            icon={<Timer className="h-5 w-5" />}
            title="Instant confirmation"
            body="The court you see is the court you get. Slots lock the moment you book — no double-bookings, ever."
          />
          <Feature
            icon={<Car className="h-5 w-5" />}
            title="Courtside car wash"
            body="Drop your keys before you play, drive off clean when you're done. Add it to any court booking."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Cancel with confidence"
            body={`Free cancellation up to ${FREE_CANCELLATION_HOURS} hours before your slot. Cancel later and the full amount becomes club credit.`}
          />
        </div>
      </section>

      {/* ---------- GALLERY ---------- */}
      <section className="border-y border-line bg-surface-muted">
        <div className="mx-auto max-w-6xl px-7 sm:px-8 py-16">
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
          className="absolute inset-0 z-0 h-full w-full object-cover object-center"
          loading="lazy"
          decoding="async"
        />
        <div
          className="absolute inset-0 z-0 bg-gradient-to-r from-brand-dark/95 via-brand-dark/80 to-brand-dark/50"
          aria-hidden="true"
        />
        <div className="relative z-10 mx-auto flex max-w-6xl transform-gpu flex-col items-start justify-between gap-6 px-7 py-16 sm:px-8 md:flex-row md:items-center md:py-20">
          <div>
            <h2 className="font-heading text-xl font-extrabold uppercase tracking-tight text-white sm:text-2xl md:text-3xl">
              Finish your match, drive off in a clean car.
            </h2>
            <p className="mt-2 max-w-md text-sm text-white/75 sm:text-base">
              Add a wash cycle to your court booking — same checkout, ready when you are.
            </p>
          </div>
          <Link
            href="/book"
            className="w-full shrink-0 rounded-court bg-brand px-6 py-3.5 text-center text-sm font-semibold text-white transition-transform hover:scale-[1.02] md:w-auto md:py-3"
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
