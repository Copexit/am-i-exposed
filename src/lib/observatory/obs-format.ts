/** BTC amount for the Observatory: 2 decimals from 1 BTC up, 4 below, "0" for zero. No unit. */
export function fmtBtc(btc: number, locale: string): string {
  if (btc === 0) return (0).toLocaleString(locale);
  const digits = Math.abs(btc) >= 1 ? 2 : 4;
  return btc.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Integer count with locale grouping. */
export const fmtCount = (n: number, locale: string): string => Math.round(n).toLocaleString(locale);

/** `url` if it is an absolute http(s) URL, else null: upstream links never become `javascript:` or relative hrefs. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
