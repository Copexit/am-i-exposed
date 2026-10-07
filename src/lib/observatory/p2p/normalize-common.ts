import { computePremium, indexFor } from "./market";
import type { IndexPrices, Layer } from "./types";

export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

export const toLayer = (v: string | undefined): Layer =>
  v === "lightning" ? "lightning" : v === "onchain" ? "onchain" : "other";

/** ISO-ish currency code (3 to 5 uppercase letters, USDT/USDC included), else null. */
export const currencyCode = (v: string | undefined): string | null => {
  const c = (v ?? "").trim().toUpperCase();
  return /^[A-Z]{3,5}$/.test(c) ? c : null;
};

/**
 * Price and premium of an order. A fixed fiat amount for a fixed sats amount is a fixed price:
 * its declared premium (usually "0") means "no premium applies", so the price is fiat / sats and
 * the premium is computed against the common index. Otherwise the declared premium is used and
 * the price follows from the index. satsMax: the sats amount, else fiatMax / price.
 */
export function pricing(currency: string, declared: number | null, fiatMin: number | null, fiatMax: number | null, sats: number | null, index: IndexPrices | null) {
  const idx = indexFor(currency, index);
  if (sats !== null && sats > 0 && fiatMax !== null && fiatMax > 0 && fiatMin === fiatMax) {
    const price = (fiatMax / sats) * 1e8;
    return { price, premium: idx !== null ? computePremium(price, idx) : null, satsMax: sats };
  }
  const price = idx !== null && declared !== null ? idx * (1 + declared / 100) : null;
  const satsMax = sats !== null && sats > 0 ? sats : price && fiatMax !== null ? Math.round((fiatMax / price) * 1e8) : null;
  return { price, premium: declared, satsMax };
}

/** One fa value: fixed amount; two: range. */
export function fiatRange(fa: string[] | undefined): { fiatMin: number | null; fiatMax: number | null } {
  const a = num(fa?.[0]);
  const b = num(fa?.[1]);
  if (a === null) return { fiatMin: null, fiatMax: null };
  return b === null ? { fiatMin: a, fiatMax: a } : { fiatMin: Math.min(a, b), fiatMax: Math.max(a, b) };
}
