import { bytesToHex } from "@/lib/bitcoin/hex";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];

export class InputFileError extends Error {
  constructor(public reason: "too-large" | "unreadable") {
    super(reason);
    this.name = "InputFileError";
  }
}

/** File or QR bytes -> the canonical string the text field accepts. */
export function bytesToPayload(bytes: Uint8Array): string {
  if (PSBT_MAGIC.every((b, i) => bytes[i] === b)) return bytesToHex(bytes);
  // A UTF-8 BOM (Windows editors) is not part of the text payload
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    if (/^[\x20-\x7e\t\r\n]*$/.test(text)) return text.trim();
  } catch {
    // not UTF-8: binary
  }
  return bytesToHex(bytes);
}

export async function readInputFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new InputFileError("too-large");
  try {
    return bytesToPayload(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new InputFileError("unreadable");
  }
}
