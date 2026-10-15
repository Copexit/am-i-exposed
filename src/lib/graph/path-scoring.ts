/**
 * Link certainty for each hop of a ConnectionPath. A hop is scored from the
 * input the path enters a tx by to the output it leaves by. Link probability
 * is direction-independent, so the B side of a bent path is scored the same
 * way from its chain-meaning indices. Pure: no UI imports.
 */

import type { MempoolTransaction } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import { analyzeChangeDetection } from "@/lib/analysis/heuristics/change-detection";
import { isCoinJoinTx } from "@/lib/analysis/heuristics/coinjoin";
import type { ConnectionPath } from "./connection-search";

export type HopBasis = "deterministic" | "boltzmann" | "change" | "estimate";
export interface HopScore { txid: string; probability: number; basis: HopBasis }
export type PathTier = "deterministic" | "likely" | "weak" | "ambiguous";
export interface PathScore { hops: HopScore[]; compound: number; tier: PathTier; estimated: boolean }

const CHANGE_PROB = { high: 0.8, medium: 0.65, low: 0.55 } as const;
/** Score for a hop whose tx was never fetched (only possible for an unverified meet tx). */
const UNKNOWN_TX_PROB = 0.5;

function scoreHop(
  tx: MempoolTransaction,
  inIndex: number,
  outIndex: number,
  boltzmann: ReadonlyMap<string, BoltzmannWorkerResult>,
): HopScore {
  const txid = tx.txid;
  if (tx.vin.length === 1 || tx.vout.length === 1) return { txid, probability: 1, basis: "deterministic" };

  // The pool remaps the matrix to submitted order, the same [vout][vin] mapping the graph edges use.
  const p = boltzmann.get(txid)?.matLnkProbabilities[outIndex]?.[inIndex];
  if (p !== undefined) return { txid, probability: p, basis: "boltzmann" };

  const change = analyzeChangeDetection(tx).findings.find((f) => f.id === "h2-change-detected");
  const conf = change?.params?.confidence;
  if (change?.params?.changeIndex === outIndex && (conf === "high" || conf === "medium" || conf === "low")) {
    return { txid, probability: CHANGE_PROB[conf], basis: "change" };
  }
  return { txid, probability: 1 / Math.max(tx.vin.length, tx.vout.length), basis: "estimate" };
}

export function scorePath(
  path: ConnectionPath,
  txs: ReadonlyMap<string, MempoolTransaction>,
  boltzmann: ReadonlyMap<string, BoltzmannWorkerResult>,
): PathScore {
  const hops: HopScore[] = [];
  path.hops.forEach((hop, i) => {
    const sharedDescendantPivot = path.kind === "shared-descendant" && i === path.pivot;
    const bothIdx = hop.inIndex !== undefined && hop.outIndex !== undefined;
    if (!sharedDescendantPivot && !bothIdx) return; // endpoints and the shared-ancestor origin
    const tx = txs.get(hop.txid);
    if (!tx) {
      hops.push({ txid: hop.txid, probability: UNKNOWN_TX_PROB, basis: "estimate" });
    } else if (sharedDescendantPivot && !bothIdx) {
      // Two inputs co-spent in one tx: common-input ownership, unless a CoinJoin
      hops.push(isCoinJoinTx(tx)
        ? { txid: hop.txid, probability: 1 / tx.vin.length, basis: "estimate" }
        : { txid: hop.txid, probability: 1, basis: "deterministic" });
    } else {
      hops.push(scoreHop(tx, hop.inIndex!, hop.outIndex!, boltzmann));
    }
  });

  const compound = hops.reduce((acc, h) => acc * h.probability, 1);
  const tier: PathTier = hops.every((h) => h.basis === "deterministic") ? "deterministic"
    : compound >= 0.5 ? "likely" : compound >= 0.1 ? "weak" : "ambiguous";
  return { hops, compound, tier, estimated: hops.some((h) => h.basis === "estimate" || h.basis === "change") };
}
