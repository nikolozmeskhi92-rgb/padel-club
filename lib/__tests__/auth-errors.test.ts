import { describe, expect, it } from "vitest";
import { authErrorMessage, isEmailRateLimit, RATE_LIMITED_MESSAGE } from "@/lib/auth/errors";

/**
 * The bug this file exists for: the second sign-up in an hour came back 429
 * `over_email_send_rate_limit` and the page printed Supabase's own words,
 * "email rate limit exceeded" — accurate, useless, and indistinguishable from
 * the site being broken.
 */
describe("the mail quota, which is what actually went wrong", () => {
  it("recognises it by code, by status, and by wording", () => {
    expect(isEmailRateLimit({ code: "over_email_send_rate_limit" })).toBe(true);
    expect(isEmailRateLimit({ status: 429, message: "whatever" })).toBe(true);
    expect(isEmailRateLimit({ message: "email rate limit exceeded" })).toBe(true);
  });

  it("does not mistake an ordinary failure for it", () => {
    expect(isEmailRateLimit({ message: "Invalid login credentials" })).toBe(false);
    expect(isEmailRateLimit(null)).toBe(false);
  });

  it("says how long rather than what broke", () => {
    const said = authErrorMessage({ code: "over_email_send_rate_limit", message: "email rate limit exceeded" });
    expect(said).toBe(RATE_LIMITED_MESSAGE);
    expect(said).not.toMatch(/rate limit exceeded/);
    expect(said).toMatch(/few minutes/);
  });
});

describe("everything else it has to translate", () => {
  it("keeps Supabase's cooldown sentence, because it carries the number", () => {
    const message = "For security purposes, you can only request this after 51 seconds.";
    expect(authErrorMessage({ message })).toBe(message);
  });

  it("never confirms that an address is registered here", () => {
    const said = authErrorMessage({ message: "User already registered" });
    expect(said).not.toMatch(/already/i);
    expect(said).not.toMatch(/registered/i);
  });

  it("passes an unfamiliar message through rather than swallowing it", () => {
    // A vague "something went wrong" for an error nobody anticipated is worse
    // than the provider's own words.
    expect(authErrorMessage({ message: "Signups not allowed for this instance" })).toBe(
      "Signups not allowed for this instance"
    );
  });

  it("always says something", () => {
    expect(authErrorMessage({}).length).toBeGreaterThan(0);
    expect(authErrorMessage(null).length).toBeGreaterThan(0);
  });
});
