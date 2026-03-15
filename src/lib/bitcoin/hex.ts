/**
 * Shared hex encoding utility for the bitcoin module.
 * Wraps @scure/base to avoid duplicating the same one-liner across files.
 */

import { hex as hexCodec } from "@scure/base";

/** Convert a Uint8Array to a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  return hexCodec.encode(bytes);
}
