/**
 * A transaction that is not (necessarily) on chain yet: a PSBT or a raw tx
 * pasted, dropped or scanned by the user. Lives in memory only.
 */
import { Transaction, RawTx } from "@scure/btc-signer";
import { base64 } from "@scure/base";
import { bytesToHex, hexToBytes } from "@/lib/bitcoin/hex";
import { parsePSBT, type PSBTParseResult } from "@/lib/bitcoin/psbt";
import { describeScript, netFor, scriptSigAsm } from "@/lib/bitcoin/tx-convert";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { MempoolTransaction, MempoolVin, MempoolVout } from "@/lib/api/types";

export type LocalTxStatus = "unsigned" | "partial" | "signed";

export interface LocalTx {
  source: "psbt" | "raw";
  status: LocalTxStatus;
  /** Engine shape. txid is real only when the tx is signed (legacy scriptSigs change it). */
  tx: MempoolTransaction;
  /** Input indexes whose prevout (value + script) is unknown. */
  missingPrevouts: number[];
  /** Broadcastable hex, only when status === "signed". */
  signedHex: string | null;
  /** PSBT metadata (fee, vsize...) for PSBT sources. */
  psbt: PSBTParseResult | null;
}

export const PREVIEW_TXID = "psbt-preview";

const RAW_OPTS = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true } as const;
const MIN_RAW_TX_HEX = 120; // 60 bytes: smallest plausible 1-in-1-out tx
const HEX_RE = /^[0-9a-fA-F]+$/;

/** Strict raw tx check: hex, even, not a txid, and parses with no trailing bytes. Never throws. */
export function isRawTxHex(text: string): boolean {
  if (text.length < MIN_RAW_TX_HEX || text.length % 2 !== 0 || !HEX_RE.test(text)) return false;
  if (text.toLowerCase().startsWith("70736274ff")) return false; // PSBT hex
  try {
    decodeRaw(hexToBytes(text));
    return true;
  } catch {
    return false;
  }
}

function decodeRaw(bytes: Uint8Array) {
  const raw = RawTx.decode(bytes); // throws on trailing bytes / truncation
  if (raw.inputs.length === 0 || raw.outputs.length === 0) throw new Error("Transaction has no inputs or outputs");
  return Transaction.fromRaw(bytes, RAW_OPTS);
}

/** Parse a raw transaction (hex or bytes). Prevouts are unknown until looked up. */
export function parseRawTx(hexOrBytes: string | Uint8Array, network: BitcoinNetwork): LocalTx {
  const bytes = typeof hexOrBytes === "string" ? hexToBytes(hexOrBytes.trim()) : hexOrBytes;
  const tx = decodeRaw(bytes);
  const net = netFor(network);

  const vin: MempoolVin[] = [];
  let signed = true;
  let estimatedVsize = 10.5;
  for (let i = 0; i < tx.inputsLength; i++) {
    const inp = tx.getInput(i);
    const witness = inp.finalScriptWitness?.map(bytesToHex) ?? [];
    const scriptsig = inp.finalScriptSig ? bytesToHex(inp.finalScriptSig) : "";
    if (witness.length === 0 && scriptsig === "") signed = false;
    estimatedVsize += 68;
    vin.push({
      txid: inp.txid ? bytesToHex(inp.txid) : `unknown_${i}`,
      vout: inp.index ?? 0,
      prevout: null,
      scriptsig,
      scriptsig_asm: scriptSigAsm(inp.finalScriptSig),
      witness,
      is_coinbase: false,
      sequence: inp.sequence ?? 0xffffffff,
    });
  }
  const vout: MempoolVout[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const out = tx.getOutput(i);
    estimatedVsize += 31;
    vout.push({
      ...(out.script ? describeScript(out.script, net) : { scriptpubkey: "", scriptpubkey_type: "unknown", scriptpubkey_address: "" }),
      scriptpubkey_asm: "",
      value: Number(out.amount ?? 0n),
    });
  }

  const weight = signed ? tx.weight : Math.ceil(estimatedVsize) * 4;
  return {
    source: "raw",
    status: signed ? "signed" : "unsigned",
    tx: {
      txid: signed ? tx.id : PREVIEW_TXID,
      version: tx.version,
      locktime: tx.lockTime,
      vin,
      vout,
      size: signed ? bytes.length : Math.ceil(estimatedVsize),
      weight,
      fee: 0,
      status: { confirmed: false },
    },
    missingPrevouts: vin.map((_, i) => i),
    signedHex: signed ? bytesToHex(bytes) : null,
    psbt: null,
  };
}

function psbtBytes(input: string): Uint8Array {
  const t = input.trim();
  if (t.startsWith("cHNidP")) return base64.decode(t);
  return hexToBytes(t);
}

/** Parse a PSBT and work out whether it can be finalized (= broadcastable). */
export function psbtToLocalTx(input: string, network: BitcoinNetwork): LocalTx {
  const parsed = parsePSBT(input, network);
  const tx = Transaction.fromPSBT(psbtBytes(input));

  let status: LocalTxStatus = "unsigned";
  let signedHex: string | null = null;
  let txid = PREVIEW_TXID;
  try {
    const c = tx.clone();
    if (!c.isFinal) c.finalize();
    const extracted = c.extract();
    signedHex = bytesToHex(extracted);
    txid = Transaction.fromRaw(extracted, RAW_OPTS).id;
    status = "signed";
  } catch {
    for (let i = 0; i < tx.inputsLength; i++) {
      const inp = tx.getInput(i);
      if ((inp.partialSig?.length ?? 0) > 0 || inp.tapKeySig || (inp.tapScriptSig?.length ?? 0) > 0) status = "partial";
    }
  }

  const missingPrevouts = parsed.tx.vin.flatMap((v, i) => (v.prevout ? [] : [i]));
  return {
    source: "psbt",
    status,
    tx: { ...parsed.tx, txid },
    missingPrevouts,
    signedHex,
    psbt: parsed,
  };
}

/** PSBT (base64/hex) or raw tx hex. Throws with the parser's reason. */
export function parseLocalTx(text: string, network: BitcoinNetwork): LocalTx {
  const t = text.trim();
  if (t.startsWith("cHNidP") || t.toLowerCase().startsWith("70736274ff")) return psbtToLocalTx(t, network);
  return parseRawTx(t, network);
}

/** i18n label for the scan header / ScanScreen ("PSBT · 2 in · 3 out"). */
export function localTxLabel(local: LocalTx) {
  return {
    key: local.source === "psbt" ? ("local.queryPsbt" as const) : ("local.queryRaw" as const),
    inputs: local.tx.vin.length,
    outputs: local.tx.vout.length,
  };
}
