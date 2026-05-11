// Bands and thresholds derived by AI-assisted (Claude) clustering of ~5.4M
// 2-of-3 P2SH-P2WSH release transactions on Bitcoin mainnet 2018-2026;
// ~68K txs identified as structurally HodlHodl-shaped releases.
import type { TxHeuristic } from "./types";
import type { Finding } from "@/lib/types";
import type { MempoolTransaction, MempoolVin } from "@/lib/api/types";
import { parseMultisigFromInput } from "@/lib/bitcoin/multisig";
import { getSpendableOutputs, isCoinbase, isOpReturn } from "./tx-utils";
import { buildHodlHodlPatternFinding } from "./multisig-findings";

// One-party-pays fee mode (~0.5%): low-band cluster
const BAND_FEE_LOW: [number, number] = [0.0038, 0.0062];
// Both-parties-pay combined fee mode (~1.0%): high-band cluster
const BAND_FEE_HIGH: [number, number] = [0.0083, 0.0125];
// Mid-band cluster observed between the two main modes
const BAND_FEE_MID: [number, number] = [0.0062, 0.0083];

const MAX_INPUT_SATS = 600_000_000;
const DUST_INPUT_SATS = 100_000;
const BMEX_PREFIX = "3BMEX";

function vinPassesInvariants(vin: MempoolVin): boolean {
  if (vin.sequence !== 0xffffffff) return false;
  const w = vin.witness;
  if (!w || w.length !== 4) return false;
  if (w[0] !== "") return false;
  if (!w[1].endsWith("01")) return false;
  if (!w[2].endsWith("01")) return false;
  return true;
}

function inRange(r: number, band: [number, number]): boolean {
  return r >= band[0] && r <= band[1];
}

export const analyzeHodlHodlDetection: TxHeuristic = (tx: MempoolTransaction) => {
  const findings: Finding[] = [];
  if (isCoinbase(tx)) return { findings };

  if (tx.version !== 1) return { findings };
  if (tx.locktime !== 0) return { findings };
  if (tx.vin.length !== 1) return { findings };

  const vin = tx.vin[0];
  const info = parseMultisigFromInput(vin);
  if (!info) return { findings };
  if (info.m !== 2 || info.n !== 3) return { findings };
  if (info.scriptType !== "p2sh-p2wsh") return { findings };
  if (!vinPassesInvariants(vin)) return { findings };

  for (const o of tx.vout) {
    if (isOpReturn(o.scriptpubkey)) return { findings };
  }

  const spendable = getSpendableOutputs(tx.vout);
  if (spendable.length < 2 || spendable.length > 5) return { findings };

  for (const o of tx.vout) {
    const addr = o.scriptpubkey_address;
    if (addr && addr.startsWith(BMEX_PREFIX)) return { findings };
  }

  const inputValue = vin.prevout?.value ?? 0;
  if (inputValue <= 0) return { findings };
  if (inputValue > MAX_INPUT_SATS) return { findings };

  const sortedAsc = [...spendable].sort((a, b) => a.value - b.value);
  const feeOutput = sortedAsc[0];
  const platformTake = spendable.length === 2
    ? sortedAsc[0].value
    : sortedAsc.slice(0, sortedAsc.length - 1).reduce((s, o) => s + o.value, 0);
  const ratio = platformTake / inputValue;

  if (inputValue < DUST_INPUT_SATS) return { findings };

  if (inRange(ratio, BAND_FEE_LOW) || inRange(ratio, BAND_FEE_HIGH) || inRange(ratio, BAND_FEE_MID)) {
    findings.push(buildHodlHodlPatternFinding(info.scriptType, feeOutput.value, ratio));
    return { findings };
  }

  return { findings };
};
