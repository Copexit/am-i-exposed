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

    const addrMatch = path.match(/\/address\/([a-zA-Z0-9]{25,90})/);
    if (addrMatch) return addrMatch[1];
  } catch {
    // Not a URL
  }
  return null;
}

/** Max length for a valid Bitcoin address or txid (64 hex + some margin for URLs). */
const MAX_INPUT_LENGTH = 512;

/** Clean user input, extracting from URLs if needed. */
export function cleanInput(input: string): string {
  // Strip control characters, zero-width joiners, and Unicode directional overrides
  const stripped = input.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202f\u2060-\u206f]/g, "");
  const trimmed = stripped.trim().slice(0, MAX_INPUT_LENGTH);
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
    // Bech32/bech32m mainnet (bc1q for P2WPKH/P2WSH, bc1p for P2TR)
    // Bech32 charset: qpzry9x8gf2tvdw0s3jn54khce6mua7l
    if (/^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/.test(trimmed.toLowerCase())) return "address";
    // Legacy P2PKH (1...)
    if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
    // P2SH (3...)
    if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
  } else {
    // Bech32/bech32m testnet/signet (tb1q for P2WPKH/P2WSH, tb1p for P2TR)
    if (/^tb1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/.test(trimmed.toLowerCase())) return "address";
    // Testnet P2PKH (m... or n...)
    if (/^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
    // Testnet P2SH (2...)
    if (/^2[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return "address";
  }

  return "invalid";
}
