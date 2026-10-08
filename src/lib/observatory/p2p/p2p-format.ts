import { fmtBtc } from "../obs-format";

/** Signed premium with one decimal: "+1.8%", "-0.5%", "0.0%". */
export function fmtPremium(p: number, locale: string): string {
  const v = Math.round(p * 10) / 10;
  const s = Math.abs(v).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}%`;
}

/** Sats as a BTC figure (2 decimals from 1 BTC, 4 below), no unit. */
export const fmtSatsBtc = (sats: number, locale: string): string => fmtBtc(sats / 1e8, locale);

/** Fiat amount in its currency; codes Intl does not know (USDT) fall back to "1,234 USDT". */
export function fmtFiat(amount: number, currency: string, locale: string, compact = false): string {
  const opts: Intl.NumberFormatOptions = compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: amount >= 100 ? 0 : 2 };
  try {
    return new Intl.NumberFormat(locale, { ...opts, style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(amount);
  } catch {
    return `${new Intl.NumberFormat(locale, opts).format(amount)} ${currency}`;
  }
}

/** "50 - 500 EUR" style range, or one amount when fixed. */
export function fmtFiatRange(min: number | null, max: number | null, currency: string, locale: string): string | null {
  if (max === null) return null;
  if (min === null || min === max) return fmtFiat(max, currency, locale);
  return `${fmtFiat(min, currency, locale, min >= 10_000)} - ${fmtFiat(max, currency, locale, max >= 10_000)}`;
}
