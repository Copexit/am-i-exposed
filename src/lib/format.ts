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

/** Format a satoshi value as a USD string using the given BTC price. */
export function formatUsdValue(sats: number, usdPerBtc: number): string {
  const usd = (sats / SATS_PER_BTC) * usdPerBtc;
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: usd >= 100 ? 0 : 2 })}`;
}
