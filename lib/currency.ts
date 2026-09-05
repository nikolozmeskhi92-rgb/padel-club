/**
 * One definition of the club's currency, used by the booking UI, the
 * confirmation email and the nightly Telegram report so they can never drift
 * apart. Override with NEXT_PUBLIC_CURRENCY (an ISO 4217 code) if the club
 * ever charges in something else.
 */
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || "GEL";
export const CURRENCY_LOCALE = process.env.NEXT_PUBLIC_CURRENCY_LOCALE || "en-GE";

/** "₾45.00" — for the browser, emails and anywhere Intl is available. */
export function formatMoney(cents: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Telegram renders a narrow, monospaced-ish column, and Intl's output for GEL
 * varies by ICU build (sometimes "₾45.00", sometimes "GEL 45.00"), which makes
 * the report's alignment jump around. This keeps the symbol fixed.
 */
const SYMBOLS: Record<string, string> = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" };

export function formatMoneyPlain(cents: number, currency: string = CURRENCY): string {
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}
