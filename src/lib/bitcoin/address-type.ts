import type { AddressType } from "@/lib/types";

/**
 * Detect the address type from its prefix and length.
 * Supports mainnet (bc1, 1, 3) and testnet/signet (tb1, m, n, 2).
 */
export function getAddressType(addr: string): AddressType {
  if (addr.startsWith("bc1p") || addr.startsWith("tb1p")) return "p2tr";
  if (addr.startsWith("bc1q") || addr.startsWith("tb1q")) {
    // P2WPKH addresses are ~42 chars, P2WSH are ~62 chars
    return addr.length > 50 ? "p2wsh" : "p2wpkh";
  }
  if (addr.startsWith("3") || addr.startsWith("2")) return "p2sh";
  if (addr.startsWith("1") || addr.startsWith("m") || addr.startsWith("n"))
    return "p2pkh";
  return "unknown";
}
