/** BTC amount for the Observatory: 2 decimals from 1 BTC up, 4 below, "0" for zero. No unit. */
export function fmtBtc(btc: number, locale: string): string {
  if (btc === 0) return (0).toLocaleString(locale);
  const digits = Math.abs(btc) >= 1 ? 2 : 4;
  return btc.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Integer count with locale grouping. */
export const fmtCount = (n: number, locale: string): string => Math.round(n).toLocaleString(locale);
