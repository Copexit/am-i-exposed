/**
 * Wallet-level heuristics: behaviours that only exist across the wallet's
 * history (merges, change exposure, peel chains). docs/spec-wallet-heuristics.md
 */
import type { Finding, Severity } from "@/lib/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { isRoundAmount } from "./heuristics/round-amount";
import { coinClass, type SimplePayment, type WalletGraph } from "./wallet-behavior";
import type { MempoolTransaction } from "@/lib/api/types";
import { buildClusters, type WalletClusters } from "./wallet-clusters";

/** Txids listed on a finding card; the rest are counted in `more`. */
export const MAX_TX_REFS = 10;

export function txRefs(txids: readonly string[]): { _txids: string; more: number } {
  return { _txids: JSON.stringify(txids.slice(0, MAX_TX_REFS)), more: Math.max(0, txids.length - MAX_TX_REFS) };
}

/**
 * W2: a change input spent with a coin from another linkage cluster
 * (wallet-clusters). Coins on its address, from its funding tx or descending
 * from the same wallet-owned coins add no new link.
 */
function mergesChange(classes: readonly string[], before: readonly string[] | undefined): boolean {
  if (!before) return false;
  return classes.some((c, i) =>
    (c === "change" || c === "coinjoin-change") && before.some((o, j) => j !== i && o !== before[i]));
}

/**
 * W1 post-mix merge and W2 change merge. Each spend counts once, under the
 * worse of the two; `merged` lets the consolidation check skip them.
 */
export function checkMerges(
  g: WalletGraph,
  spends: readonly MempoolTransaction[],
  clusters: WalletClusters = buildClusters(g),
): { findings: Finding[]; merged: Set<string> } {
  const unmixed: string[] = [];
  const mixedOnly: string[] = [];
  const change: string[] = [];
  for (const tx of spends) {
    if (tx.vin.length < 2) continue;
    const classes = tx.vin.map((v) => coinClass(g, v.txid, v.vout));
    if (classes.includes("mixed")) {
      (classes.some((c) => c !== "mixed" && c !== "unknown") ? unmixed : mixedOnly).push(tx.txid);
    } else if (mergesChange(classes, clusters.linking.get(tx.txid))) {
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

/** W3: in how many simple payments a standard change rule points at the real change. */
export function checkChangeExposure(payments: readonly SimplePayment[]): Finding[] {
  let byType = 0, byRound = 0, byOptimal = 0;
  const exposedTxids: string[] = [];
  for (const { tx, change, payment } of payments) {
    const ct = getAddressType(change.scriptpubkey_address!);
    const type = ct !== getAddressType(payment.scriptpubkey_address!)
      && tx.vin.every((v) => getAddressType(v.prevout!.scriptpubkey_address!) === ct);
    const round = isRoundAmount(payment.value) && !isRoundAmount(change.value);
    const minIn = Math.min(...tx.vin.map((v) => v.prevout!.value));
    const optimal = tx.vin.length >= 2 && change.value < minIn && payment.value >= minIn;
    if (type) byType++;
    if (round) byRound++;
    if (optimal) byOptimal++;
    if (type || round || optimal) exposedTxids.push(tx.txid);
  }
  const exposed = exposedTxids.length;
  if (exposed === 0) return [];
  const ratio = exposed / payments.length;
  const [severity, scoreImpact]: [Severity, number] = ratio > 0.5 ? ["high", -6] : ratio > 0.2 ? ["medium", -4] : ["low", -2];
  return [{
    id: "wallet-change-exposed",
    severity,
    confidence: "high",
    title: `${exposed} of ${payments.length} payments revealed their change`,
    description:
      `In ${exposed} of ${payments.length} simple payments a standard change-detection rule pointed at the real change output: ` +
      `address type (${byType}), round payment amount (${byRound}), or change smaller than every input (${byOptimal}). ` +
      "Anyone applying these rules can follow the wallet's change from payment to payment.",
    recommendation:
      "Use a wallet that gives change the payment's address type (Bitcoin Core does), avoid round payment amounts, " +
      "and prefer changeless payments (exact-amount coin selection) or spend one coin that covers the payment.",
    scoreImpact,
    params: { exposed, payments: payments.length, ratio: Math.round(ratio * 100), byType, byRound, byOptimal, ...txRefs(exposedTxids) },
  }];
}

/** W4: payments that each spend only the previous payment's change. */
export function checkPeelChains(payments: readonly SimplePayment[]): Finding[] {
  const steps = new Map(payments.filter((p) => p.tx.vin.length === 1).map((p) => [p.tx.txid, p.tx]));
  const prevOf = new Map<string, string>();
  for (const tx of steps.values()) {
    const parent = tx.vin[0]!.txid;
    // A payment's only wallet output is its change, so a step spending a step spends its change
    if (steps.has(parent)) prevOf.set(tx.txid, parent);
  }
  const len = new Map<string, number>();
  const depth = (id: string): number => {
    const path: string[] = [];
    let cur: string | undefined = id;
    while (cur !== undefined && !len.has(cur)) { path.push(cur); cur = prevOf.get(cur); }
    let d = cur !== undefined ? len.get(cur)! : 0;
    for (let i = path.length - 1; i >= 0; i--) len.set(path[i]!, ++d);
    return len.get(id)!;
  };
  const parents = new Set(prevOf.values());
  const tails = [...steps.keys()].filter((id) => !parents.has(id));
  const long = tails.filter((id) => depth(id) >= 3);
  if (long.length === 0) return [];
  const end = long.reduce((a, b) => (depth(b) > depth(a) ? b : a));
  const chain: string[] = [];
  for (let cur: string | undefined = end; cur !== undefined; cur = prevOf.get(cur)) chain.unshift(cur);
  const count = chain.length;
  return [{
    id: "wallet-peel-chain",
    severity: count >= 6 ? "high" : "medium",
    confidence: "high",
    title: `Peel chain of ${count} payments`,
    description:
      `${count} payments in a row each spent only the change of the previous one. ` +
      `Anyone who identifies one payment in the chain can follow the rest. Chains of 3 or more payments: ${long.length}.`,
    recommendation:
      "Break the chain: pay from a different coin, spend exact amounts so no change is left, " +
      "run the change through a CoinJoin before the next payment, or use PayJoin or Stonewall when available.",
    scoreImpact: count >= 6 ? -6 : -3,
    params: { count, chains: long.length, ...txRefs(chain) },
  }];
}

/** Good practice: 3+ solo spends, none merged change, CoinJoin outputs or many coins, and no peel chain. */
export function checkNoMerge(spendCount: number, anyMergeOrPeel: boolean): Finding[] {
  if (spendCount < 3 || anyMergeOrPeel) return [];
  return [{
    id: "wallet-no-merge",
    severity: "good",
    confidence: "high",
    title: `Coins kept apart in ${spendCount} spends`,
    description:
      `None of the wallet's ${spendCount} spends merged change, CoinJoin outputs or many coins into one transaction. ` +
      "Keeping coins apart limits what each payment reveals.",
    recommendation: "Keep using coin control.",
    scoreImpact: 3,
    params: { count: spendCount },
  }];
}
