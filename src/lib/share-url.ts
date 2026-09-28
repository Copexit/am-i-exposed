import { DEFAULT_NETWORK, type BitcoinNetwork } from "@/lib/bitcoin/networks";

/**
 * Canonical public link to a result (never localhost or a custom API host).
 * Non-mainnet results keep `?network=`, so testnet and signet links open on
 * the right chain.
 */
export function shareUrl(query: string, inputType: "txid" | "address", network: BitcoinNetwork): string {
  const qs = network === DEFAULT_NETWORK ? "" : `?network=${network}`;
  const prefix = inputType === "txid" ? "tx" : "addr";
  return `https://am-i.exposed/${qs}#${prefix}=${encodeURIComponent(query)}`;
}
