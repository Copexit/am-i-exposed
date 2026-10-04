/** btc-signer -> mempool.space-shaped pieces, shared by the PSBT and raw tx parsers. */
import { Address, OutScript, Script, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import { bytesToHex } from "./hex";
import type { BitcoinNetwork } from "./networks";

export type BtcNetwork = typeof NETWORK;

/** btc-signer OutScript type -> mempool.space scriptpubkey_type */
export const MEMPOOL_SCRIPT_TYPE: Record<string, string> = {
  pk: "p2pk", pkh: "p2pkh", sh: "p2sh", wpkh: "v0_p2wpkh", wsh: "v0_p2wsh", tr: "v1_p2tr", ms: "multisig", p2a: "anchor",
};

/** Rough per-input vsize by prevout type, for transactions that are not signed yet. */
export const INPUT_VSIZE: Record<string, number> = {
  p2pkh: 148,
  p2sh: 91, // assumes P2SH-P2WPKH
  v0_p2wpkh: 68,
  v1_p2tr: 58,
};

export const netFor = (network: BitcoinNetwork): BtcNetwork => (network === "mainnet" ? NETWORK : TEST_NETWORK);

/** Describe an output script the way the mempool.space API does. */
export function describeScript(script: Uint8Array, net: BtcNetwork) {
  const scriptpubkey = bytesToHex(script);
  if (script[0] === 0x6a) {
    return { scriptpubkey, scriptpubkey_type: "op_return", scriptpubkey_address: "" };
  }
  let scriptpubkey_type = "unknown";
  let scriptpubkey_address = "";
  try {
    const decoded = OutScript.decode(script);
    scriptpubkey_type = MEMPOOL_SCRIPT_TYPE[decoded.type] ?? "unknown";
    scriptpubkey_address = Address(net).encode(decoded);
  } catch {
    // Non-standard script or a type without an address (p2pk, bare multisig)
  }
  return { scriptpubkey, scriptpubkey_type, scriptpubkey_address };
}

/**
 * scriptSig pushes as space-separated hex, enough for detectLowRSignatures
 * (it only reads hex items starting with 30). Opcodes are kept as their names.
 */
export function scriptSigAsm(script: Uint8Array | undefined): string {
  if (!script || script.length === 0) return "";
  try {
    return Script.decode(script).map((op) => (op instanceof Uint8Array ? bytesToHex(op) : String(op))).join(" ");
  } catch {
    return "";
  }
}
