import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";

const Schema = z.object({
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(4).max(20),
});

/**
 * "I booked, but I've lost the email."
 *
 * Someone who booked as a guest has no account to sign into, and the
 * confirmation is the only copy of their code. Without this they have to ring
 * the club — which is fine at 2pm and useless at 11pm.
 *
 * Two facts are required together, the same pair every airline asks for: the
 * booking code and the email it was made with. Either alone is not enough. The
 * code on its own is eight characters and would be brute-forceable; the email
 * on its own would let anyone list a stranger's bookings by guessing addresses.
 *
 * The reply is deliberately identical whether the code is wrong, the email is
 * wrong, or neither exists. Saying "that code exists but the email doesn't
 * match" would confirm the code, which is half the secret.
 */
export async function POST(req: NextRequest) {
  // The tightest limit on the site: this is the one endpoint whose whole job is
  // to answer "does this pair exist?", so it is the one worth guessing at.
  const limited = await enforceRateLimit(req, "find:booking", 5, 600);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const email = parsed.data.email.toLowerCase();
  const code = parsed.data.code.toUpperCase();
  const supabase = createServiceRoleClient();

  const [{ data: court }, { data: wash }] = await Promise.all([
    supabase
      .from("court_bookings")
      .select(
        "court_id, slot, duration_minutes, status, price_cents, payment_status, booking_code, guest_name, guest_email, cancel_token"
      )
      .eq("booking_code", code)
      .maybeSingle(),
    supabase
      .from("wash_bookings")
      .select(
        "bay_id, service, slot, status, price_cents, payment_status, booking_code, guest_name, guest_email, cancel_token"
      )
      .eq("booking_code", code)
      .maybeSingle(),
  ]);

  const found = court
    ? { kind: "court" as const, b: court as any, resourceName: `Court ${(court as any).court_id}` }
    : wash
      ? {
          kind: "car_wash" as const,
          b: wash as any,
          resourceName: `Wash Bay ${(wash as any).bay_id} · ${String((wash as any).service).replace(/_/g, " ")}`,
        }
      : null;

  // One answer for every kind of miss.
  if (!found || (found.b.guest_email ?? "").toLowerCase() !== email) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const slot: string = found.b.slot ?? "";
  const m = slot.match(/[\[\(]"?([^",]+)"?,"?([^",\)\]]+)"?[\)\]]/);

  return NextResponse.json({
    booking: {
      kind: found.kind,
      resourceName: found.resourceName,
      bookingCode: found.b.booking_code,
      guestName: found.b.guest_name,
      startIso: m ? new Date(m[1]).toISOString() : null,
      endIso: m ? new Date(m[2]).toISOString() : null,
      status: found.b.status,
      paymentStatus: found.b.payment_status,
      priceCents: found.b.price_cents,
      // The cancel token is handed over only once both facts check out. It is
      // the capability that actually cancels, which is why the code alone must
      // never be enough to reach it.
      cancelToken: found.b.status === "cancelled" ? null : found.b.cancel_token,
    },
  });
}
