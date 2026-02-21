/**
 * Unified satoshi formatting for the entire app.
 * Always displays amounts in sats with locale-aware thousand separators.
 */
export function formatSats(sats: number, locale?: string): string {
  return `${sats.toLocaleString(locale)} sats`;
}
