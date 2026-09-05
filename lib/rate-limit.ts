import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Best-effort client identity. Vercel sets x-forwarded-for; the leftmost entry
 * is the original client. Anything upstream of us can spoof this, so it is a
 * throttle against casual abuse, not an authentication signal.
 */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Fixed-window rate limit, counted in Postgres so every serverless instance
 * shares one budget.
 *
 * Fails OPEN: if the database is unreachable the request is allowed through.
 * A throttle that takes the booking system down with it is worse than no
 * throttle, and the booking routes need the same database anyway — they will
 * fail on their own, with a better error message, a moment later.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .rpc("rate_limit_hit", {
        p_bucket: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      })
      .single<{ allowed: boolean; remaining: number; retry_after_seconds: number }>();

    if (error || !data) {
      console.error("[rate-limit] check failed, allowing request:", error?.message);
      return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
    }

    return {
      allowed: data.allowed,
      remaining: data.remaining,
      retryAfterSeconds: data.retry_after_seconds,
    };
  } catch (err) {
    console.error("[rate-limit] check threw, allowing request:", err);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/**
 * Guard for a route handler. Returns a 429 response to return immediately, or
 * null when the request may proceed.
 */
export async function enforceRateLimit(
  req: NextRequest,
  scope: string,
  limit: number,
  windowSeconds: number
): Promise<NextResponse | null> {
  const result = await rateLimit(`${scope}:${clientIp(req)}`, limit, windowSeconds);
  if (result.allowed) return null;

  return NextResponse.json(
    { error: "RATE_LIMITED", retryAfterSeconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}
