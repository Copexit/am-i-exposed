/**
 * Wallet-level heuristics: behaviours that only exist across the wallet's
 * history (merges, change exposure, peel chains). docs/spec-wallet-heuristics.md
 */
import type { Finding, Severity } from "@/lib/types";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { isRoundAmount } from "./heuristics/round-amount";
import {
  checkAddressTypeMismatch, checkOptimalChange, checkRoundAmount, checkShadowChange, checkUnnecessaryInput, checkValueDisparity,
} from "./heuristics/change-detection-signals";
import { coinClass, isChangeClass, type CoinClass, type SimplePayment, type WalletGraph } from "./wallet-behavior";
import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";
import { buildClusters, type WalletClusters } from "./wallet-clusters";

/** Txids listed on a finding card; the rest are counted in `more`. */
export const MAX_TX_REFS = 10;

export function txRefs(txids: readonly string[]): { _txids: string; more: number } {
  return { _txids: JSON.stringify(txids.slice(0, MAX_TX_REFS)), more: Math.max(0, txids.length - MAX_TX_REFS) };
}

/**
 * W2: a change input spent with a coin from another certain linkage cluster
 * (wallet-clusters). Coins on its address, co-spent with it before or
 * descending from it through single-output spends add no new link.
 * "inferred" (a notch lower) when every such coin was in its inferred cluster
 * (they come from the same payment, but an observer had to guess which output
 * was the change), or when the change input is ambiguous: no rule lets an
 * observer tell it was change (changeIdentifiable). Still a merge.
 */
function mergesChange(
  classes: readonly string[],
  identifiable: readonly boolean[],
  link: { certain: readonly string[]; inferred: readonly string[] } | undefined,
): "certain" | "inferred" | null {
  if (!link) return null;
  let merged = false;
  for (const [i, c] of classes.entries()) {
    if (!isChangeClass(c as CoinClass)) continue;
    for (let j = 0; j < classes.length; j++) {
      if (j === i || link.certain[j] === link.certain[i]) continue;
      if (link.inferred[j] !== link.inferred[i] && identifiable[i]) return "certain";
      merged = true;
    }
  }
  return merged ? "inferred" : null;
}

/** Why an observer can tell a wallet output is change (changeIdentifiable). */
export type ChangeWhy = "coinjoin" | "round" | "type" | "optimal" | "disparity" | "unnecessary" | "shadow" | "same-address" | "spent-address";

/**
 * The engine's change-detection signals (H2, change-detection-signals.ts) on a
 * 2-output tx: for each output index, the signals that vote it the change.
 */
function h2Votes(tx: MempoolTransaction, outs: MempoolVout[]): { why: [ChangeWhy[], ChangeWhy[]]; weight: [number, number] } {
  const votes: [ChangeWhy[], ChangeWhy[]] = [[], []];
  const weight: [number, number] = [0, 0];
  const run = (why: ChangeWhy, check: (m: Map<number, number>, sig: string[]) => void) => {
    const m = new Map<number, number>();
    check(m, []);
    for (const i of [0, 1] as const) if ((m.get(i) ?? 0) > 0) { votes[i].push(why); weight[i] += m.get(i)!; }
  };
  const fee = tx.fee ?? tx.vin.reduce((t, v) => t + (v.prevout?.value ?? 0), 0) - tx.vout.reduce((t, o) => t + o.value, 0);
  run("type", (m, sig) => checkAddressTypeMismatch(tx.vin, outs, m, sig));
  run("round", (m, sig) => checkRoundAmount(outs, m, sig));
  run("disparity", (m, sig) => checkValueDisparity(outs, m, sig));
  run("unnecessary", (m, sig) => checkUnnecessaryInput(tx.vin, outs, m, sig));
  run("optimal", (m, sig) => checkOptimalChange(tx.vin, outs, fee, m, sig));
  run("shadow", (m, sig) => checkShadowChange(tx.vin, outs, m, sig));
  return { why: votes, weight };
}

const spentAddressesOf = new WeakMap<WalletGraph, Map<string, Set<string>>>();
/** Address to the outpoints spent from it, over the scanned history (memoized per graph). */
function spentFrom(g: WalletGraph): Map<string, Set<string>> {
  let m = spentAddressesOf.get(g);
  if (!m) {
    m = new Map();
    for (const tx of g.txs.values()) for (const v of tx.vin) {
      const a = v.prevout?.scriptpubkey_address;
      if (!a) continue;
      let s = m.get(a);
      if (!s) m.set(a, (s = new Set()));
      s.add(`${v.txid}:${v.vout}`);
    }
    spentAddressesOf.set(g, m);
  }
  return m;
}

/**
 * Can an observer tell that wallet output `vout` of `txid` is change? The
 * reason, or null when it is ambiguous. For change-class outputs
 * (isChangeClass), shared by W2 and the coin selector:
 * - coinjoin: CoinJoin change (the odd output of a CoinJoin or Tx0);
 * - same-address: sent back to an address of the tx's own inputs;
 * - spent-address: its address was already spent from in another spend
 *   (address reuse: the history links it for certain);
 * - on a 2-output tx, the engine's change-detection signals (H2: address
 *   type, round amount, value disparity, unnecessary input, optimal change,
 *   shadow change) pick it: some vote for it and none for the other output
 *   (as W3 counts exposed change), or H2 would report it at medium
 *   confidence or more (weight 2+ with a 2/3 majority);
 * - on a tx with more outputs, a standard rule (W3, rulesPick: round, type,
 *   optimal) picks it against every other output, and none picks another
 *   output against it.
 * Otherwise (one output of a self-transfer whose outputs look alike, a
 * payment whose change no rule points at) it is ambiguous.
 */
export function changeIdentifiable(g: WalletGraph, txid: string, vout: number): ChangeWhy | null {
  const tx = g.txs.get(txid);
  const out = tx?.vout[vout];
  if (!tx || !out?.scriptpubkey_address) return null;
  if (coinClass(g, txid, vout) === "coinjoin-change") return "coinjoin";
  const addr = out.scriptpubkey_address;
  if (tx.vin.some((v) => v.prevout?.scriptpubkey_address === addr)) return "same-address";
  const spent = spentFrom(g).get(addr);
  if (spent && [...spent].some((op) => op !== `${txid}:${vout}`)) return "spent-address";
  if (!tx.vin.every((v) => v.prevout?.scriptpubkey_address)) return null;
  const outs = tx.vout.filter((o) => o.scriptpubkey_address);
  if (outs.length === 2) {
    const i = outs.indexOf(out);
    const { why, weight } = h2Votes(tx, outs);
    const [mine, theirs] = [weight[i]!, weight[1 - i]!];
    // As W3 (some signal, none against) or as H2 at medium confidence or more (weight 2+, a 2/3 majority).
    const picked = (mine > 0 && theirs === 0) || (mine >= 2 && mine / (mine + theirs) >= 2 / 3);
    return picked ? why[i]![0]! : null;
  }
  const others = tx.vout.filter((o, i) => i !== vout && o.scriptpubkey_address);
  if (others.length === 0) return null;
  if (others.some((o) => { const w = rulesPick(tx, o, out); return w.type || w.round || w.optimal; })) return null;
  for (const rule of ["round", "type", "optimal"] as const) if (others.every((o) => rulesPick(tx, out, o)[rule])) return rule;
  return null;
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
  let inferredOnly = 0;
  for (const tx of spends) {
    if (tx.vin.length < 2) continue;
    const classes = tx.vin.map((v) => coinClass(g, v.txid, v.vout));
    if (classes.includes("mixed")) {
      (classes.some((c) => c !== "mixed" && c !== "unknown") ? unmixed : mixedOnly).push(tx.txid);
    } else {
      const identifiable = tx.vin.map((v, i) => isChangeClass(classes[i]) && changeIdentifiable(g, v.txid, v.vout) !== null);
      const m = mergesChange(classes, identifiable, clusters.linking.get(tx.txid));
      if (m) change.push(tx.txid);
      if (m === "inferred") inferredOnly++;
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
    // Severity and score follow the certain merges; one notch lower only when there are none
    const certainCount = count - inferredOnly;
    const soft = certainCount === 0;
    const n = soft ? count : certainCount;
    findings.push({
      id: "wallet-change-merge",
      severity: soft ? (n > 1 ? "medium" : "low") : n > 1 ? "high" : "medium",
      confidence: "high",
      title: `${count} spend${count > 1 ? "s" : ""} merged change with other coins`,
      description:
        "Change from an earlier payment was spent together with a coin from a different transaction. " +
        "Whoever identified that change, including the earlier payment's recipient, now also sees the other coin and its history, " +
        "and every address involved joins one cluster.",
      recommendation:
        "Use coin control: spend change on its own or with coins from the same transaction. " +
        "When a payment needs more, spend the change completely in a payment that leaves no new change, or run it through a CoinJoin first.",
      scoreImpact: soft ? (n >= 5 ? -7 : n > 1 ? -4 : -2) : n >= 5 ? -10 : n > 1 ? -7 : -4,
      params: { count, inferredCount: inferredOnly, ...txRefs(change) },
    });
  }
  return { findings, merged: new Set([...postmix, ...change]) };
}

/**
 * The standard change rules for a 2-output payment, asked of output `a`
 * against output `b`: does each rule pick `a` as the change?
 */
function rulesPick(tx: MempoolTransaction, a: MempoolVout, b: MempoolVout): { type: boolean; round: boolean; optimal: boolean } {
  const at = getAddressType(a.scriptpubkey_address!);
  const minIn = Math.min(...tx.vin.map((v) => v.prevout!.value));
  return {
    type: at !== getAddressType(b.scriptpubkey_address!) && tx.vin.every((v) => getAddressType(v.prevout!.scriptpubkey_address!) === at),
    round: isRoundAmount(b.value) && !isRoundAmount(a.value),
    optimal: tx.vin.length >= 2 && a.value < minIn && b.value >= minIn,
  };
}

/** The rules that point at the real change of `p`, or null when none does or one points at the payment. */
export function changeExposure({ tx, change, payment }: SimplePayment): { type: boolean; round: boolean; optimal: boolean } | null {
  const right = rulesPick(tx, change, payment);
  const wrong = rulesPick(tx, payment, change);
  return wrong.type || wrong.round || wrong.optimal || !(right.type || right.round || right.optimal) ? null : right;
}

/**
 * W3: in how many simple payments the standard change rules point at the
 * real change. A payment counts when at least one rule picks the change and
 * none picks the payment: with contradicting rules an analyst cannot tell.
 */
export function checkChangeExposure(payments: readonly SimplePayment[]): Finding[] {
  let byType = 0, byRound = 0, byOptimal = 0;
  const exposedTxids: string[] = [];
  for (const p of payments) {
    const { tx } = p;
    const right = changeExposure(p);
    if (!right) continue;
    if (right.type) byType++;
    if (right.round) byRound++;
    if (right.optimal) byOptimal++;
    exposedTxids.push(tx.txid);
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
