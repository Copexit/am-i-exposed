import ofacData from "@/data/ofac-addresses.json";
import type { OfacCheckResult } from "./types";

const SANCTIONED_SET = new Set<string>(ofacData.addresses);

export function checkOfac(addresses: string[]): OfacCheckResult {
  const matched = addresses.filter((addr) => SANCTIONED_SET.has(addr));
  return {
    checked: true,
    sanctioned: matched.length > 0,
    matchedAddresses: matched,
    lastUpdated: ofacData.lastUpdated,
  };
}
