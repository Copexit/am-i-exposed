/**
 * PSBT (Partially Signed Bitcoin Transaction) Analyzer
 *
 * Parses a BIP174/BIP370 PSBT and extracts structural data for privacy analysis.
 * This allows users to preview the privacy impact of a transaction before broadcasting.
 *
 * The PSBT is parsed using @scure/btc-signer, which handles the complex binary format.
 * The parsed data is converted into the MempoolTransaction format so existing
 * heuristics can analyze it.
 */

import { Transaction, Address, OutScript, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import { base64 } from "@scure/base";
import { bytesToHex, hexToBytes } from "./hex";
import type { BitcoinNetwork } from "./networks";
import type { MempoolTransaction, MempoolVin, MempoolVout } from "@/lib/api/types";

// ---------- Types ----------

export interface PSBTParseResult {
  /** The parsed transaction (can run heuristics on this) */
  tx: MempoolTransaction;
  /** Total input value in sats */
  inputTotal: number;
  /** Total output value in sats */
  outputTotal: number;
  /** Fee in sats (input - output) */
  fee: number;
  /** Virtual size in vbytes */
  vsize: number;
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Number of inputs */
  inputCount: number;
  /** Number of outputs */
  outputCount: number;
  /** Whether all inputs have UTXO data (needed for fee calc) */
  complete: boolean;
  /** Network used to encode addresses (caller-selected, or inferred from BIP32 hints) */
  network: "mainnet" | "testnet";
}

// ---------- Helpers ----------

/** btc-signer OutScript type -> mempool.space scriptpubkey_type */
const MEMPOOL_SCRIPT_TYPE: Record<string, string> = {
  pk: "p2pk",
  pkh: "p2pkh",
  sh: "p2sh",
  wpkh: "v0_p2wpkh",
  wsh: "v0_p2wsh",
  tr: "v1_p2tr",
  ms: "multisig",
  p2a: "anchor",
};

/** Rough per-input vsize by prevout type, for PSBTs that are not finalized yet. */
const INPUT_VSIZE: Record<string, number> = {
  p2pkh: 148,
  p2sh: 91, // assumes P2SH-P2WPKH
  v0_p2wpkh: 68,
  v1_p2tr: 58,
};

type BtcNetwork = typeof NETWORK;

/** Describe an output script the way the mempool.space API does. */
function describeScript(script: Uint8Array, net: BtcNetwork) {
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
 * Output scripts do not encode the network, so fall back to BIP32 derivation
 * hints: a coin type of 1' (m/purpose'/1'/...) means a test network.
 */
function inferTestnet(tx: Transaction): boolean {
  const paths: number[][] = [];
  const collect = (
    bip32?: [Uint8Array, { path: number[] }][],
    tapBip32?: [Uint8Array, { der: { path: number[] } }][],
  ) => {
    for (const [, d] of bip32 ?? []) paths.push(d.path);
    for (const [, d] of tapBip32 ?? []) paths.push(d.der.path);
  };
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    collect(inp.bip32Derivation, inp.tapBip32Derivation);
  }
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    collect(out.bip32Derivation, out.tapBip32Derivation);
  }
  return paths.some((p) => p.length >= 2 && p[1] === 0x80000001);
}

// ---------- Public API ----------

/** Check if a string looks like a base64-encoded PSBT. */
export function isPSBT(input: string): boolean {
  // PSBT magic bytes in base64: "cHNidP" (from 0x70736274ff)
  const trimmed = input.trim();
  return trimmed.startsWith("cHNidP") || trimmed.startsWith("70736274ff");
}

/**
 * Parse a PSBT string (base64 or hex) and extract transaction data
 * suitable for privacy analysis.
 *
 * @param network - the selected network, used to encode addresses. When omitted,
 *   the network is inferred from BIP32 derivation hints (default mainnet).
 */
export function parsePSBT(input: string, network?: BitcoinNetwork): PSBTParseResult {
  const trimmed = input.trim();

  // Decode the PSBT bytes
  let psbtBytes: Uint8Array;
  if (trimmed.startsWith("cHNidP")) {
    psbtBytes = base64.decode(trimmed);
  } else if (trimmed.startsWith("70736274ff")) {
    try {
      psbtBytes = hexToBytes(trimmed);
    } catch {
      throw new Error("Invalid PSBT hex");
    }
  } else {
    throw new Error("Invalid PSBT format: must be base64 or hex encoded");
  }

  // Parse with @scure/btc-signer
  const tx = Transaction.fromPSBT(psbtBytes);

  const inputCount = tx.inputsLength;
  const outputCount = tx.outputsLength;

  const testnet = network ? network !== "mainnet" : inferTestnet(tx);
  const net = testnet ? TEST_NETWORK : NETWORK;

  // Extract input data
  let inputTotal = 0;
  let complete = true;
  let estimatedVsize = 10.5;
  const vins: MempoolVin[] = [];

  for (let i = 0; i < inputCount; i++) {
    const inp = tx.getInput(i);
    const utxo = inp.witnessUtxo ?? inp.nonWitnessUtxo?.outputs[inp.index ?? 0];

    let prevout: MempoolVin["prevout"] = null;
    if (utxo) {
      const value = Number(utxo.amount);
      inputTotal += value;
      prevout = { ...describeScript(utxo.script, net), scriptpubkey_asm: "", value };
    } else {
      complete = false;
    }
    estimatedVsize += INPUT_VSIZE[prevout?.scriptpubkey_type ?? ""] ?? 68;

    vins.push({
      txid: inp.txid ? bytesToHex(inp.txid) : `unknown_${i}`,
      vout: inp.index ?? 0,
      prevout,
      scriptsig: inp.finalScriptSig ? bytesToHex(inp.finalScriptSig) : "",
      scriptsig_asm: "",
      witness: inp.finalScriptWitness?.map(bytesToHex) ?? [],
      is_coinbase: false,
      sequence: inp.sequence ?? 0xffffffff,
    });
  }

  // Extract output data
  let outputTotal = 0;
  const vouts: MempoolVout[] = [];

  for (let i = 0; i < outputCount; i++) {
    const out = tx.getOutput(i);
    const value = Number(out.amount ?? 0);
    outputTotal += value;
    estimatedVsize += 31;

    vouts.push({
      ...(out.script
        ? describeScript(out.script, net)
        : { scriptpubkey: "", scriptpubkey_type: "unknown", scriptpubkey_address: "" }),
      scriptpubkey_asm: "",
      value,
    });
  }

  const fee = complete ? inputTotal - outputTotal : 0;

  // vsize: try the library first, but unsigned PSBTs throw "not finalized"
  let vsize = 0;
  try {
    vsize = tx.vsize;
  } catch {
    vsize = Math.ceil(estimatedVsize);
  }
  const feeRate = vsize > 0 && fee > 0 ? Math.round(fee / vsize) : 0;

  // Build a MempoolTransaction-like object for heuristic analysis
  const mempoolTx: MempoolTransaction = {
    txid: "psbt-preview",
    version: tx.version ?? 2,
    locktime: tx.lockTime ?? 0,
    vin: vins,
    vout: vouts,
    size: vsize,
    weight: vsize * 4, // approximate
    fee,
    status: {
      confirmed: false,
    },
  };

  return {
    tx: mempoolTx,
    inputTotal,
    outputTotal,
    fee,
    vsize,
    feeRate,
    inputCount,
    outputCount,
    complete,
    network: testnet ? "testnet" : "mainnet",
  };
}
