/**
 * What counts as an acceptable password here, in one place.
 *
 * The rules follow the modern guidance rather than the old one: length is what
 * actually makes a password hard to guess, so there is a real minimum and no
 * demand for a symbol and a capital letter — those rules push people towards
 * "Password1!" and a sticky note. What is blocked instead is the small set of
 * passwords attackers try first, and anything built out of the person's own
 * email address, which is the first thing a targeted guess reaches for.
 *
 * Keep MIN_PASSWORD_LENGTH in step with the minimum in the Supabase dashboard
 * (Authentication → Providers → Email). The server is the authority; this is
 * here so the customer is told before they submit rather than after.
 */

export const MIN_PASSWORD_LENGTH = 8;

/**
 * bcrypt — which is what Supabase hashes with — ignores everything past 72
 * bytes. A longer password is not stronger, it is silently truncated, and a
 * password manager generating 100 characters would leave the customer with a
 * password whose tail does nothing. Say so rather than quietly cutting it.
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * The passwords guessed first. Not a dictionary — a dictionary belongs on the
 * server and Supabase already refuses leaked passwords when that option is on.
 * This is the handful that would otherwise sail through a length check.
 */
const OBVIOUS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "iloveyou",
  "welcome1",
  "letmein1",
  "abc12345",
  "11111111",
  "padelclub",
  "lukipadel",
]);

export type PasswordCheck = { ok: boolean; message: string | null };

/**
 * Whether this password can be used, and if not, what to say about it.
 *
 * The message is written to be read by the person choosing the password, so it
 * says what to do rather than which rule was broken.
 */
export function checkPassword(password: string, email?: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters — length is what makes a password hard to guess.`,
    };
  }

  // Bytes, not characters: "é" is two bytes and an emoji is four, so a password
  // that looks short enough can still be over the limit.
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return {
      ok: false,
      message: `That is longer than ${MAX_PASSWORD_BYTES} bytes, and everything past that is ignored. Shorten it so what you type is what protects the account.`,
    };
  }

  if (OBVIOUS.has(password.toLowerCase())) {
    return {
      ok: false,
      message: "That is one of the first passwords anyone guesses. Please pick another.",
    };
  }

  const local = email?.split("@")[0]?.toLowerCase().trim();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) {
    return {
      ok: false,
      message: "Don't build the password out of your email address — that is the first thing a targeted guess tries.",
    };
  }

  return { ok: true, message: null };
}

export type Strength = { score: 0 | 1 | 2 | 3; label: string };

/**
 * A rough read on how strong a password looks, for the meter under the field.
 *
 * Deliberately crude and deliberately not a gate: the meter is there to nudge,
 * `checkPassword` is what decides. Scoring length first, variety second, which
 * is the order that matters.
 */
export function passwordStrength(password: string): Strength {
  if (password.length === 0) return { score: 0, label: "" };
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 0, label: "Too short" };

  const variety =
    (/[a-z]/.test(password) ? 1 : 0) +
    (/[A-Z]/.test(password) ? 1 : 0) +
    (/[0-9]/.test(password) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(password) ? 1 : 0);

  if (password.length >= 16 || (password.length >= 12 && variety >= 3)) {
    return { score: 3, label: "Strong" };
  }
  if (password.length >= 12 || variety >= 3) return { score: 2, label: "Good" };
  return { score: 1, label: "Weak" };
}
