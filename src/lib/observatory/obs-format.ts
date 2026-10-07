/** BTC amount for the Observatory: 2 decimals from 1 BTC up, 4 below. No unit. */
export function fmtBtc(btc: number, locale: string): string {
  const digits = Math.abs(btc) >= 1 ? 2 : 4;
  return btc.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Integer count with locale grouping. */
export const fmtCount = (n: number, locale: string): string => Math.round(n).toLocaleString(locale);
