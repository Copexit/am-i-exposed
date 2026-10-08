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

/**
 * A typed or pasted amount in either "1.234,56" or "1,234.56" form; null unless a positive number.
 * The last separator is the decimal one when both appear; a lone separator is grouping only when
 * it repeats, or when exactly 3 digits follow a non-zero integer part and it is not the locale's decimal mark.
 */
export function parseAmount(text: string, locale: string): number | null {
  // A pasted "€250", "250 EUR" or "R$ 250": currency symbols and codes at either end go.
  const s = text.replace(/^[\p{L}\p{Sc}\s]+|[\p{L}\p{Sc}\s]+$/gu, "").replace(/[\s\u00a0\u202f']/g, "");
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dots = s.split(".").length - 1;
  const commas = s.split(",").length - 1;
  let dec: "." | "," | null = null;
  if (dots && commas) dec = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
  else if (dots + commas === 1) {
    const sep = dots ? "." : ",";
    const [int = "", frac = ""] = s.split(sep);
    const localeDec = (1.5).toLocaleString(locale).charAt(1);
    dec = frac.length === 3 && /[1-9]/.test(int) && sep !== localeDec ? null : sep;
  }
  const grp = dec === "." ? "," : dec === "," ? "." : /[.,]/;
  const [int, frac, extra] = s.split(dec ?? "\u0000").map((p, i) => (i === 0 ? p.split(grp).join("") : p));
  if (extra !== undefined || (frac !== undefined && /[.,]/.test(frac))) return null;
  const n = Number(`${int || "0"}.${frac ?? ""}`.replace(/\.$/, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
