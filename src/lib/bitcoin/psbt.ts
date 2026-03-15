/**
 * PSBT (Partially Signed Bitcoin Transaction) Analyzer
 *
 * Parses a BIP174/BIP370 PSBT and extracts structural data for privacy analysis.
 * This allows users to preview the privacy impact of a transaction before broadcasting.
 *
 * The PSBT is parsed using @scure/btc-signer, which handles the complex binary format.
 * We then convert the parsed data into our MempoolTransaction format so existing
 * heuristics can analyze it.
 */

import { Transaction, NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import { base64, hex as hexCodec } from "@scure/base";
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
  /** Network detected from output addresses */
  network: "mainnet" | "testnet";
}

// ---------- Helpers ----------

function detectScriptType(scriptHex: string): string {
  if (!scriptHex) return "unknown";
  // P2PKH: OP_DUP OP_HASH160 <20> ... OP_EQUALVERIFY OP_CHECKSIG
  if (scriptHex.startsWith("76a914") && scriptHex.endsWith("88ac")) return "p2pkh";
  // P2SH: OP_HASH160 <20> ... OP_EQUAL
  if (scriptHex.startsWith("a914") && scriptHex.endsWith("87")) return "p2sh";
  // P2WPKH: OP_0 <20>
  if (scriptHex.startsWith("0014") && scriptHex.length === 44) return "v0_p2wpkh";
  // P2WSH: OP_0 <32>
  if (scriptHex.startsWith("0020") && scriptHex.length === 68) return "v0_p2wsh";
  // P2TR: OP_1 <32>
  if (scriptHex.startsWith("5120") && scriptHex.length === 68) return "v1_p2tr";
  return "unknown";
}

function bytesToHex(bytes: Uint8Array): string {
  return hexCodec.encode(bytes);
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
 */
export function parsePSBT(input: string): PSBTParseResult {
  const trimmed = input.trim();

  // Decode the PSBT bytes
  let psbtBytes: Uint8Array;
  if (trimmed.startsWith("cHNidP")) {
    psbtBytes = base64.decode(trimmed);
  } else if (trimmed.startsWith("70736274ff")) {
    // Hex-encoded PSBT
    psbtBytes = new Uint8Array(
      trimmed.match(/.{1,2}/g)!.map(b => parseInt(b, 16)),
    );
  } else {
    throw new Error("Invalid PSBT format: must be base64 or hex encoded");
  }

  // Parse with @scure/btc-signer
  const tx = Transaction.fromPSBT(psbtBytes);

  const inputCount = tx.inputsLength;
  const outputCount = tx.outputsLength;

  // Extract input data
  let inputTotal = 0;
  let complete = true;
  const vins: MempoolVin[] = [];

  for (let i = 0; i < inputCount; i++) {
    const inp = tx.getInput(i);

    let prevValue = 0;
    let prevScript = "";
    let prevScriptType = "unknown";
    const prevAddress = "";

    // Try to get UTXO value from witnessUtxo or nonWitnessUtxo
    if (inp.witnessUtxo) {
      prevValue = Number(inp.witnessUtxo.amount);
      prevScript = bytesToHex(inp.witnessUtxo.script);
      prevScriptType = detectScriptType(prevScript);
    } else {
      complete = false;
    }

    inputTotal += prevValue;

    vins.push({
      txid: inp.txid ? bytesToHex(inp.txid) : `unknown_${i}`,
      vout: inp.index ?? 0,
      prevout: {
        scriptpubkey: prevScript,
        scriptpubkey_asm: "",
        scriptpubkey_type: prevScriptType,
        scriptpubkey_address: prevAddress,
        value: prevValue,
      },
      scriptsig: "",
      scriptsig_asm: "",
      witness: [],
      is_coinbase: false,
      sequence: inp.sequence ?? 0xffffffff,
    });
  }

  // Extract output data
  let outputTotal = 0;
  const vouts: MempoolVout[] = [];
  let detectedNetwork: "mainnet" | "testnet" = "mainnet";

  for (let i = 0; i < outputCount; i++) {
    const out = tx.getOutput(i);
    const value = Number(out.amount ?? 0);
    outputTotal += value;

    const script = out.script ? bytesToHex(out.script) : "";
    const scriptType = detectScriptType(script);

    // Try to get address
    let address = "";
    try {
      const mainAddr = tx.getOutputAddress(i, NETWORK);
      if (mainAddr) address = mainAddr;
    } catch {
      try {
        const testAddr = tx.getOutputAddress(i, TEST_NETWORK);
        if (testAddr) {
          address = testAddr;
          detectedNetwork = "testnet";
        }
      } catch {
        // Can't determine address
      }
    }

    if (address.startsWith("tb1") || address.startsWith("m") || address.startsWith("n") || address.startsWith("2")) {
      detectedNetwork = "testnet";
    }

    vouts.push({
      scriptpubkey: script,
      scriptpubkey_asm: "",
      scriptpubkey_type: scriptType,
      scriptpubkey_address: address,
      value,
    });
  }

  const fee = complete ? inputTotal - outputTotal : 0;

  // vsize: try the library first, but unsigned PSBTs throw "not finalized"
  let vsize = 0;
  try {
    vsize = tx.vsize;
  } catch {
    // Estimate: 10.5 overhead + 68 per segwit input + 31 per output
    vsize = Math.ceil(10.5 + inputCount * 68 + outputCount * 31);
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
    network: detectedNetwork,
  };
}
