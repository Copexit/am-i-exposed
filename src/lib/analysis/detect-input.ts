import type { InputType } from "@/lib/types";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import { isXpubOrDescriptor } from "@/lib/bitcoin/descriptor";
import { isPSBT } from "@/lib/bitcoin/psbt";
import { isRawTxHex } from "@/lib/input/local-tx";

/** Extract a txid or address from a mempool.space / blockstream URL. */
function extractFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const path = url.pathname;

    // Match /tx/{txid} or /address/{address}
    const txid = path.match(/\/tx\/([a-fA-F0-9]{64})/)?.[1];
    if (txid) return txid;

    const address = path.match(/\/address\/([a-zA-Z0-9]{25,90})/)?.[1];
    if (address) return address;
  } catch {
    // Not a URL
  }
  return null;
}

/** Max length for short inputs (address, txid, xpub, URL). */
const MAX_INPUT_LENGTH = 512;
/** Max length for transaction payloads (PSBT, raw tx, UR, BBQr). */
export const MAX_PAYLOAD_LENGTH = 4 * 1024 * 1024;

/** True for strings that start like a PSBT (base64 or hex). */
export function isLocalPayloadPrefix(s: string): boolean {
  return s.startsWith("cHNidP") || s.toLowerCase().startsWith("70736274ff");
}

/** Long hex or PSBT-looking text: whitespace inside is line wrapping, not content. */
function looksLikePayload(s: string): boolean {
  const compact = s.replace(/\s+/g, "");
  return isLocalPayloadPrefix(compact) || (compact.length > 64 && /^[0-9a-fA-F]+$/.test(compact));
}

const BIP21_RE = /^bitcoin:([a-z0-9]+)(?:\?.*)?$/i;
const UPPER_BECH32_RE = /^(BC1|TB1)[02-9AC-HJ-NP-Z]+$/;

/** Clean user input, extracting from URLs / BIP21 if needed. Payloads keep their full length. */
export function cleanInput(input: string): string {
  // Strip zero-width joiners and Unicode directional overrides; keep \n, \r, \t for payload unwrapping
  const stripped = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202f\u2060-\u206f]/g, "");
  if (looksLikePayload(stripped)) {
    return stripped.replace(/\s+/g, "").slice(0, MAX_PAYLOAD_LENGTH);
  }
  const trimmed = stripped.replace(/[\t\n\r]/g, "").trim().slice(0, MAX_INPUT_LENGTH);
  const bip21 = trimmed.match(BIP21_RE)?.[1];
  const candidate = bip21 ?? extractFromUrl(trimmed) ?? trimmed;
  return UPPER_BECH32_RE.test(candidate) ? candidate.toLowerCase() : candidate;
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

  // PSBT (must be checked before xpub since both can be long base64-ish strings)
  if (isPSBT(trimmed)) return "psbt";

  // Raw transaction hex (signed or unsigned); strict parse, so other hex stays invalid
  if (isRawTxHex(trimmed)) return "rawtx";

  // xpub / output descriptor (must be checked before address patterns)
  if (isXpubOrDescriptor(trimmed)) return "xpub";

  const lower = trimmed.toLowerCase();

  // Bech32/bech32m mainnet (bc1q for P2WPKH/P2WSH, bc1p for P2TR)
  // Bech32 charset: qpzry9x8gf2tvdw0s3jn54khce6mua7l
  if (/^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/.test(lower)) return "address";
  // Legacy P2PKH (1...) - total 25-34 chars
  if (/^1[a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(trimmed)) return "address";
  // P2SH (3...) - total 25-34 chars
  if (/^3[a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(trimmed)) return "address";

  // Bech32/bech32m testnet/signet (tb1q for P2WPKH/P2WSH, tb1p for P2TR)
  if (/^tb1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{39,87}$/.test(lower)) return "address";
  // Testnet P2PKH (m... or n...) - total 25-34 chars
  if (/^[mn][a-km-zA-HJ-NP-Z1-9]{24,33}$/.test(trimmed)) return "address";
  // Testnet P2SH (2...) - version 0xC4 can encode up to 35 chars total
  if (/^2[a-km-zA-HJ-NP-Z1-9]{24,34}$/.test(trimmed)) return "address";

  // Network parameter kept for API compatibility but validation is
  // permissive - on Umbrel the local mempool determines the network,
  // not the frontend selector, so all address formats are accepted.
  void network;

  return "invalid";
}
