/**
 * One definition of the club's currency, used by the booking UI, the
 * confirmation email and the nightly Telegram report so they can never drift
 * apart. Override with NEXT_PUBLIC_CURRENCY (an ISO 4217 code) if the club
 * ever charges in something else.
 */
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || "GEL";
/**
 * Controls grouping and the decimal mark only — the currency symbol is ours
 * (see below). "en-GE" renders 25.00 as "25,00", which reads as a thousands
 * separator to an English-speaking customer; "en-US" gives "25.00" and
 * "1,245.00". Override if the club wants Georgian conventions.
 */
export const CURRENCY_LOCALE = process.env.NEXT_PUBLIC_CURRENCY_LOCALE || "en-US";

/**
 * Symbols are ours, not Intl's. `Intl.NumberFormat(..., { style: "currency" })`
 * renders GEL as the literal string "GEL 45.00" on many ICU builds — including
 * Chrome's — rather than "₾45.00", and which you get varies by browser and OS.
 * Grouping and decimals still come from Intl; only the symbol is pinned.
 */
const SYMBOLS: Record<string, string> = { GEL: "₾", USD: "$", EUR: "€", GBP: "£" };

function symbolFor(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

/** "₾1,245.00" — the browser, emails, anywhere a thousands separator helps. */
export function formatMoney(cents: number, currency: string = CURRENCY): string {
  const amount = new Intl.NumberFormat(CURRENCY_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
  return `${symbolFor(currency)}${amount}`;
}

/**
 * "₾1245.00" — no grouping separators. The Telegram report aligns its columns
 * by hand, so a separator that appears only above ₾1,000 would make the rows
 * jump.
 */
export function formatMoneyPlain(cents: number, currency: string = CURRENCY): string {
  return `${symbolFor(currency)}${(cents / 100).toFixed(2)}`;
}
