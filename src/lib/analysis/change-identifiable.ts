/**
 * Can an observer tell that a wallet output is change? Shared by W2
 * (wallet-heuristics checkMerges), the linkage clusters (wallet-clusters: only
 * identifiable change joins its payment's inputs for certain) and the coin
 * selector ("spend change on its own" applies to identifiable change only).
 * docs/privacy-engine.md, W2.
 */
import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { isRoundAmount } from "./heuristics/round-amount";
import { analyzeChangeDetection } from "./heuristics/change-detection";
import { coinClass, isOwn, type WalletGraph } from "./wallet-behavior";

/**
 * The standard change rules for a 2-output payment, asked of output `a`
 * against output `b`: does each rule pick `a` as the change?
 */
export function rulesPick(tx: MempoolTransaction, a: MempoolVout, b: MempoolVout): { type: boolean; round: boolean; optimal: boolean } {
  const at = getAddressType(a.scriptpubkey_address!);
  const minIn = Math.min(...tx.vin.map((v) => v.prevout!.value));
  return {
    type: at !== getAddressType(b.scriptpubkey_address!) && tx.vin.every((v) => getAddressType(v.prevout!.scriptpubkey_address!) === at),
    round: isRoundAmount(b.value) && !isRoundAmount(a.value),
    optimal: tx.vin.length >= 2 && a.value < minIn && b.value >= minIn,
  };
}

/**
 * Why an observer can tell a wallet output is change, or "unknown" when the
 * history lacks the data to say (taken as identifiable: the safe side).
 */
export type ChangeWhy =
  | "coinjoin" | "sole-output" | "same-address" | "spent-address"
  | "type" | "round" | "disparity" | "unnecessary" | "optimal" | "shadow" | "fresh"
  | "unknown";

/** H2 signal keys (change-detection.ts signalDetails) to reasons. */
const H2_WHY: Record<string, ChangeWhy> = {
  address_type: "type", round_amount: "round", value_disparity: "disparity", unnecessary_input: "unnecessary",
  optimal_change: "optimal", shadow_change: "shadow", fresh_address: "fresh",
};

/** Block height for ordering, unconfirmed last. */
const height = (tx: MempoolTransaction) => tx.status.block_height ?? Number.MAX_SAFE_INTEGER;

/** Number of scanned txs touching each wallet address (H2's fresh-address signal; outside addresses stay unknown). */
const useCounts = new WeakMap<WalletGraph, Map<string, number>>();
function ownTxCounts(g: WalletGraph): Map<string, number> {
  let m = useCounts.get(g);
  if (!m) {
    m = new Map();
    for (const tx of g.txs.values()) {
      const addrs = new Set([...tx.vout.map((o) => o.scriptpubkey_address), ...tx.vin.map((v) => v.prevout?.scriptpubkey_address)]);
      for (const a of addrs) if (a && isOwn(g, a)) m.set(a, (m.get(a) ?? 0) + 1);
    }
    useCounts.set(g, m);
  }
  return m;
}

/**
 * Why wallet output `vout` of `txid` can be told apart as change, or null when
 * it is ambiguous:
 * - coinjoin: CoinJoin change (the odd output of a CoinJoin or Tx0);
 * - sole-output: the tx's only output (nothing else it could be);
 * - same-address: sent back to an address of the tx's own inputs;
 * - spent-address: its address was spent from in another spend (before
 *   `before`, when given: W2 asks as of a merge);
 * - 2 outputs: the engine's change detection (H2, analyzeChangeDetection)
 *   picks it, with the wallet's own address use counts for its fresh-address
 *   signal. Gaps: round fiat amounts (no historical price here) and the
 *   fresh-address signal for outside addresses (their use counts are not
 *   fetched);
 * - 3+ outputs: a W3 rule (rulesPick: round, type, optimal) picks it against
 *   every other output and none picks another output against it. H2 has no
 *   multi-output version of value disparity, unnecessary input or shadow
 *   change: not checked there.
 * Missing data (the tx, the output's address, an input's prevout address):
 * "unknown".
 */
export function changeIdentifiable(g: WalletGraph, txid: string, vout: number, before?: MempoolTransaction): ChangeWhy | null {
  const tx = g.txs.get(txid);
  const out = tx?.vout[vout];
  if (!tx || !out?.scriptpubkey_address) return "unknown";
  if (coinClass(g, txid, vout) === "coinjoin-change") return "coinjoin";
  const addr = out.scriptpubkey_address;
  if (!tx.vin.every((v) => v.prevout?.scriptpubkey_address)) return "unknown";
  const outs = tx.vout.filter((o) => o.scriptpubkey_address);
  if (outs.length === 1) return "sole-output";
  if (tx.vin.some((v) => v.prevout?.scriptpubkey_address === addr)) return "same-address";
  for (const t of g.txs.values()) {
    if (t === tx || (before && (t === before || height(t) >= height(before)))) continue;
    if (t.vin.some((v) => v.prevout?.scriptpubkey_address === addr && !(v.txid === txid && v.vout === vout))) return "spent-address";
  }
  if (outs.length === 2) {
    const counts = ownTxCounts(g);
    const f = analyzeChangeDetection(tx, undefined, counts.size ? { outputTxCounts: counts } : undefined).findings.find((x) => x.id === "h2-change-detected");
    if (!f || f.params?.changeIndex !== vout) return null;
    const details = JSON.parse(String(f.params.signalDetails ?? "[]")) as { key: string; votedOutput: number }[];
    const mine = outs.indexOf(out);
    return H2_WHY[details.find((d) => d.votedOutput === mine)?.key ?? ""] ?? "unknown";
  }
  const others = tx.vout.filter((o, i) => i !== vout && o.scriptpubkey_address);
  if (others.some((o) => { const w = rulesPick(tx, o, out); return w.type || w.round || w.optimal; })) return null;
  for (const rule of ["round", "type", "optimal"] as const) if (others.every((o) => rulesPick(tx, out, o)[rule])) return rule;
  return null;
}
