import { SATS_PER_BTC } from "@/lib/constants";

/**
 * Unified satoshi formatting for the entire app.
 * Always displays amounts in sats with locale-aware thousand separators.
 */
export function formatSats(sats: number, locale?: string): string {
  return `${sats.toLocaleString(locale)} sats`;
}

/** Format a number with en-US locale for consistent display in analysis findings. */
export function fmtN(n: number): string {
  return n.toLocaleString("en-US");
}

/** Format satoshis as a human-readable BTC string (e.g. "0.001 BTC"). */
export function formatBtc(sats: number): string {
  return `${(sats / SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, "")} BTC`;
}

/** Format a value as sats or BTC depending on magnitude. */
export function formatSatsOrBtc(sats: number): string {
  if (sats >= SATS_PER_BTC) {
    return formatBtc(sats);
  }
  return `${fmtN(sats)} sats`;
}

/** Calculate virtual size from transaction weight. */
export function calcVsize(weight: number): number {
  return Math.ceil(weight / 4);
}

/** Calculate fee rate in sat/vB as a formatted string. */
export function calcFeeRate(tx: { fee: number; weight: number }): string {
  const vsize = calcVsize(tx.weight);
  if (vsize === 0) return "0";
  return (tx.fee / vsize).toFixed(1);
}

/**
 * Locale-aware relative time formatting using Intl.RelativeTimeFormat.
 * Formats a unix timestamp as a human-readable "X ago" string.
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

/** Round a number to `digits` decimal places (default 3). */
export function roundTo(n: number, digits = 3): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/** Format a satoshi value as a USD string using the given BTC price. */
export function formatUsdValue(sats: number, usdPerBtc: number): string {
  const usd = (sats / SATS_PER_BTC) * usdPerBtc;
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: usd >= 100 ? 0 : 2 })}`;
}
