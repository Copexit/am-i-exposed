import { indexFor } from "./market";
import type { IndexPrices, Layer } from "./types";

export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
};

export const toLayer = (v: string | undefined): Layer =>
  v === "lightning" ? "lightning" : v === "onchain" ? "onchain" : "other";

/** price from a declared premium and the index; satsMax from sats, else fiatMax / price. */
export function pricing(currency: string, premium: number | null, fiatMax: number | null, sats: number | null, index: IndexPrices | null) {
  const idx = indexFor(currency, index);
  const price = idx !== null && premium !== null ? idx * (1 + premium / 100) : null;
  const satsMax = sats !== null && sats > 0 ? sats : price && fiatMax !== null ? Math.round((fiatMax / price) * 1e8) : null;
  return { price, satsMax };
}

/** One fa value: fixed amount; two: range. */
export function fiatRange(fa: string[] | undefined): { fiatMin: number | null; fiatMax: number | null } {
  const a = num(fa?.[0]);
  const b = num(fa?.[1]);
  if (a === null) return { fiatMin: null, fiatMax: null };
  return b === null ? { fiatMin: a, fiatMax: a } : { fiatMin: Math.min(a, b), fiatMax: Math.max(a, b) };
}
