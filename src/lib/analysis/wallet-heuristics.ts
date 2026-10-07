/**
 * Wallet-level heuristics: behaviours that only exist across the wallet's
 * history (merges, change exposure, peel chains). docs/spec-wallet-heuristics.md
 */
import type { Finding } from "@/lib/types";
import { coinClass, type WalletGraph } from "./wallet-behavior";
import type { MempoolTransaction } from "@/lib/api/types";

/** Txids listed on a finding card; the rest are counted in `more`. */
export const MAX_TX_REFS = 10;

export function txRefs(txids: readonly string[]): { _txids: string; more: number } {
  return { _txids: JSON.stringify(txids.slice(0, MAX_TX_REFS)), more: Math.max(0, txids.length - MAX_TX_REFS) };
}

/**
 * W1 post-mix merge and W2 change merge. Each spend counts once, under the
 * worse of the two; `merged` lets the consolidation check skip them.
 */
export function checkMerges(g: WalletGraph, spends: readonly MempoolTransaction[]): { findings: Finding[]; merged: Set<string> } {
  const unmixed: string[] = [];
  const mixedOnly: string[] = [];
  const change: string[] = [];
  for (const tx of spends) {
    if (tx.vin.length < 2) continue;
    const classes = tx.vin.map((v) => coinClass(g, v.txid, v.vout));
    if (classes.includes("mixed")) {
      (classes.some((c) => c !== "mixed" && c !== "unknown") ? unmixed : mixedOnly).push(tx.txid);
    } else if (new Set(tx.vin.map((v) => v.txid)).size >= 2 && classes.some((c) => c === "change" || c === "coinjoin-change")) {
      change.push(tx.txid);
    }
  }

  const findings: Finding[] = [];
  const postmix = [...unmixed, ...mixedOnly];
  if (postmix.length > 0) {
    const worst = unmixed.length > 0;
    // Title counts the variant's spends: a mixed-only spend is not "with unmixed coins"
    const count = worst ? unmixed.length : mixedOnly.length;
    findings.push({
      id: "wallet-postmix-merge",
      severity: worst ? "critical" : "high",
      confidence: "high",
      title: worst
        ? `${count} spend${count > 1 ? "s" : ""} merged CoinJoin outputs with unmixed coins`
        : `${count} spend${count > 1 ? "s" : ""} merged several CoinJoin outputs`,
      description: worst
        ? "CoinJoin outputs were spent together with coins that were never mixed (CoinJoin change, change or received coins). " +
          "The common-input heuristic links each mixed output to the unmixed coin's history, which largely undoes the CoinJoin for it."
        : "Several CoinJoin outputs were spent together. Each was hidden among its round's peers; spent together, " +
          "their possible histories intersect and the anonymity of each output shrinks.",
      recommendation: worst
        ? "Spend each CoinJoin output on its own, never in the same transaction as unmixed coins or CoinJoin change. " +
          "Freeze CoinJoin change and unmixed coins with coin control and spend or remix them separately."
        : "Spend one CoinJoin output per transaction. When a payment needs more, use a collaborative transaction " +
          "(Stonewall, PayJoin with a recipient that supports it) instead of merging mixed outputs.",
      scoreImpact: worst ? (unmixed.length > 1 ? -20 : -15) : (mixedOnly.length > 1 ? -12 : -8),
      params: { count, unmixedCount: unmixed.length, mixedOnlyCount: mixedOnly.length, _variant: worst ? "unmixed" : "mixed", ...txRefs(postmix) },
    });
  }
  if (change.length > 0) {
    const count = change.length;
    findings.push({
      id: "wallet-change-merge",
      severity: count > 1 ? "high" : "medium",
      confidence: "high",
      title: `${count} spend${count > 1 ? "s" : ""} merged change with other coins`,
      description:
        "Change from an earlier payment was spent together with a coin from a different transaction. " +
        "Whoever identified that change, including the earlier payment's recipient, now also sees the other coin and its history, " +
        "and every address involved joins one cluster.",
      recommendation:
        "Use coin control: spend change on its own or with coins from the same transaction. " +
        "When a payment needs more, spend the change completely in a payment that leaves no new change, or run it through a CoinJoin first.",
      scoreImpact: count >= 5 ? -10 : count > 1 ? -7 : -4,
      params: { count, ...txRefs(change) },
    });
  }
  return { findings, merged: new Set([...postmix, ...change]) };
}
