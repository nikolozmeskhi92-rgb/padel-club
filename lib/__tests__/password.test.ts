import { describe, expect, it } from "vitest";
import {
  checkPassword,
  passwordStrength,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} from "@/lib/auth/password";

describe("what we will accept as a password", () => {
  it("takes an ordinary decent password", () => {
    expect(checkPassword("correct horse battery").ok).toBe(true);
    expect(checkPassword("Tbilisi-Padel-2026").ok).toBe(true);
  });

  it("refuses anything shorter than the stated minimum", () => {
    expect(checkPassword("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(checkPassword("a".repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it("refuses the passwords guessed first", () => {
    for (const p of ["password", "PASSWORD123", "12345678", "lukipadel"]) {
      expect(checkPassword(p).ok, p).toBe(false);
    }
  });

  it("refuses a password built out of the person's own email", () => {
    expect(checkPassword("nikoloz2026!", "nikoloz@example.com").ok).toBe(false);
    // The same password is fine for somebody else — the rule is about *their*
    // address, not a banned word list.
    expect(checkPassword("nikoloz2026!", "someone@example.com").ok).toBe(true);
  });

  it("ignores a short local part, or every address would ban half the alphabet", () => {
    expect(checkPassword("axolotl-parade", "ax@example.com").ok).toBe(true);
  });

  it("refuses more than bcrypt will actually hash", () => {
    // bcrypt silently drops everything past 72 bytes, so a longer password is
    // not stronger — the tail simply does nothing, which is worth saying.
    expect(checkPassword("a".repeat(MAX_PASSWORD_BYTES)).ok).toBe(true);
    expect(checkPassword("a".repeat(MAX_PASSWORD_BYTES + 1)).ok).toBe(false);
  });

  it("counts bytes and not characters", () => {
    // 20 tennis balls are 80 bytes — over the limit — while .length reports 40,
    // because each one is a surrogate pair. A length check would wave it
    // through and bcrypt would quietly cut it in half.
    const emoji = "🎾".repeat(20);
    expect(emoji.length).toBeLessThan(MAX_PASSWORD_BYTES);
    expect(new TextEncoder().encode(emoji).length).toBeGreaterThan(MAX_PASSWORD_BYTES);
    expect(checkPassword(emoji).ok).toBe(false);
  });

  it("explains itself every time it refuses", () => {
    for (const p of ["short", "password", "a".repeat(200)]) {
      const verdict = checkPassword(p);
      expect(verdict.ok).toBe(false);
      expect(verdict.message, p).toBeTruthy();
    }
  });
});

describe("the strength meter", () => {
  it("rates length above novelty", () => {
    // Four lowercase words beat a short password with every character class in
    // it, because that is what is actually true.
    expect(passwordStrength("horse battery staple radish").score).toBe(3);
    expect(passwordStrength("Aa1!Aa1!").score).toBeLessThan(3);
  });

  it("says nothing at all about an empty field", () => {
    expect(passwordStrength("").label).toBe("");
  });
});
