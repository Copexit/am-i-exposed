import type { IndexPrices } from "./types";

export const STABLE_TO_FIAT: Record<string, string> = { USDT: "USD", USDC: "USD" };

/** Fiat per BTC for a currency; USDT/USDC use the USD index. */
export function indexFor(code: string, index: IndexPrices | null): number | null {
  const v = index?.prices[STABLE_TO_FIAT[code] ?? code];
  return typeof v === "number" && v > 0 ? v : null;
}

/** (price / idx - 1) * 100 */
export function computePremium(price: number, idx: number): number {
  return (price / idx - 1) * 100;
}
