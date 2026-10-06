import { bytesToHex } from "@/lib/bitcoin/hex";
import { walletJsonToPayload, MULTISIG } from "./wallet-json";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

export class InputFileError extends Error {
  constructor(public reason: "too-large" | "unreadable" | "multisig") {
    super(reason);
    this.name = "InputFileError";
  }
}

/** File or QR bytes -> the canonical string the text field accepts. Throws InputFileError("multisig") for a multisig-only wallet export. */
export function bytesToPayload(bytes: Uint8Array): string {
  if (PSBT_MAGIC.every((b, i) => bytes[i] === b)) return bytesToHex(bytes);
  // A UTF-8 BOM (Windows editors) is not part of the text payload
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return bytesToHex(bytes); // not UTF-8: binary
  }
  // Wallet-export JSON may carry non-ASCII labels; only its descriptor/xpub is kept.
  const wallet = walletJsonToPayload(text);
  if (wallet === MULTISIG) throw new InputFileError("multisig");
  if (wallet) return wallet;
  return /^[\x20-\x7e\t\r\n]*$/.test(text) ? text.trim() : bytesToHex(bytes);
}

export async function readInputFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new InputFileError("too-large");
  try {
    return bytesToPayload(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    throw err instanceof InputFileError ? err : new InputFileError("unreadable");
  }
}
