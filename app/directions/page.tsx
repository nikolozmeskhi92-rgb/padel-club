export const metadata = { title: "Directions — Nexus Padel Club" };

export default function DirectionsPage() {
  const address = process.env.NEXT_PUBLIC_CLUB_ADDRESS || "12 Court Lane";

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <h1 className="font-heading text-3xl font-extrabold text-ink">Find us</h1>
      <p className="mt-3 text-ink-muted">{address}</p>
      <div className="mt-8 aspect-video w-full overflow-hidden rounded-court border border-line bg-surface-base shadow-card">
        {/* Replace with an embedded Google Maps iframe using your club's place ID */}
        <div className="flex h-full items-center justify-center text-sm text-ink-muted/70">
          Map embed goes here
        </div>
      </div>
      <h2 className="mt-10 font-heading text-xl font-bold text-ink">Club rules</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-muted">
        <li>Arrive 10 minutes before your slot.</li>
        <li>Non-marking shoes required on all courts.</li>
        <li>Cancellations within 4 hours of the slot are non-refundable.</li>
        <li>Car wash drop-off closes 15 minutes before the club closes.</li>
      </ul>
    </div>
  );
}
