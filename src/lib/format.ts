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

const SATS_PER_BTC = 100_000_000;

/** Format satoshis as a human-readable BTC string (e.g. "0.001 BTC"). */
export function formatBtc(sats: number): string {
  return `${(sats / SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, "")} BTC`;
}

/** Format a satoshi value as a USD string using the given BTC price. */
export function formatUsdValue(sats: number, usdPerBtc: number): string {
  const usd = (sats / SATS_PER_BTC) * usdPerBtc;
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: usd >= 100 ? 0 : 2 })}`;
}
