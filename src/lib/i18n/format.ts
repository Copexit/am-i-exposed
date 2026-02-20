/**
 * Locale-aware relative time formatting using Intl.RelativeTimeFormat.
 * Replaces bespoke formatTimeAgo functions throughout the app.
 */
export function formatTimeAgo(unixTimestamp: number, locale: string): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });

  if (diff < 60) return rtf.format(-diff, "second");
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), "hour");
  if (diff < 2592000) return rtf.format(-Math.floor(diff / 86400), "day");
  if (diff < 31536000) return rtf.format(-Math.floor(diff / 2592000), "month");
  return rtf.format(-Math.floor(diff / 31536000), "year");
}

/** Locale-aware number formatting. */
export function formatNumber(n: number, locale: string): string {
  return n.toLocaleString(locale);
}
