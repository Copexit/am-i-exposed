import ofacData from "@/data/ofac-addresses.json";
import type { OfacCheckResult } from "./types";

// Normalize bech32 addresses to lowercase for comparison (BIP-173).
// Legacy base58 addresses are case-sensitive and must not be lowercased.
const SANCTIONED_SET = new Set<string>(
  ofacData.addresses.map((addr) => normalizeBech32(addr)),
);

function normalizeBech32(addr: string): string {
  const lower = addr.toLowerCase();
  if (lower.startsWith("bc1") || lower.startsWith("tb1")) return lower;
  return addr;
}

export function checkOfac(addresses: string[]): OfacCheckResult {
  const matched = addresses.filter((addr) =>
    SANCTIONED_SET.has(normalizeBech32(addr)),
  );
  return {
    checked: true,
    sanctioned: matched.length > 0,
    matchedAddresses: matched,
    lastUpdated: ofacData.lastUpdated,
  };
}
