import type { MempoolTransaction } from "@/lib/api/types";

/**
 * Extract all unique addresses from a transaction (both inputs and outputs).
 */
export function extractTxAddresses(tx: MempoolTransaction): string[] {
  const addresses = new Set<string>();

  for (const vin of tx.vin) {
    if (!vin.is_coinbase && vin.prevout?.scriptpubkey_address) {
      addresses.add(vin.prevout.scriptpubkey_address);
    }
  }

  for (const vout of tx.vout) {
    if (vout.scriptpubkey_address) {
      addresses.add(vout.scriptpubkey_address);
    }
  }

  return [...addresses];
}
