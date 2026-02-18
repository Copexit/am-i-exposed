import type { InputType } from "@/lib/types";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";

/** Extract a txid or address from a mempool.space / blockstream URL. */
function extractFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const path = url.pathname;

    // Match /tx/{txid} or /address/{address}
    const txMatch = path.match(/\/tx\/([a-fA-F0-9]{64})/);
    if (txMatch) return txMatch[1];

    const addrMatch = path.match(/\/address\/([a-zA-Z0-9]+)/);
    if (addrMatch) return addrMatch[1];
  } catch {
    // Not a URL
  }
  return null;
}

/** Clean user input, extracting from URLs if needed. */
export function cleanInput(input: string): string {
  const trimmed = input.trim();
  return extractFromUrl(trimmed) ?? trimmed;
}

/** Detect whether user input is a txid, address, or invalid. */
export function detectInputType(
  input: string,
  network: BitcoinNetwork = "mainnet",
): InputType {
  let trimmed = input.trim();

  // Try extracting from URL first
  const fromUrl = extractFromUrl(trimmed);
  if (fromUrl) trimmed = fromUrl;

  // txid: 64 hex chars (network-agnostic)
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return "txid";

  if (network === "mainnet") {
    // Bech32 mainnet (bc1q for P2WPKH, bc1p for P2TR)
    if (/^bc1[a-zA-HJ-NP-Z0-9]{25,62}$/i.test(trimmed)) return "address";
    // Legacy P2PKH (1...)
    if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
    // P2SH (3...)
    if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
  } else {
    // Bech32 testnet/signet (tb1q for P2WPKH, tb1p for P2TR)
    if (/^tb1[a-zA-HJ-NP-Z0-9]{25,62}$/i.test(trimmed)) return "address";
    // Testnet P2PKH (m... or n...)
    if (/^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
    // Testnet P2SH (2...)
    if (/^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
  }

  return "invalid";
}
