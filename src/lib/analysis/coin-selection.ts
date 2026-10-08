/**
 * Coin Selection Advisor
 *
 * Given the wallet's UTXOs and a payment amount, recommends which coins to
 * spend with privacy as the primary criterion.
 *
 * Candidate sets, always all of them (a covering single coin does not stop
 * the search for multi-coin sets):
 * - every single coin that pays;
 * - changeless sets of 2-3 coins (changelessSet), wallet-wide and within each
 *   linkage cluster;
 * - from the coins that cannot pay alone: for each, the smallest partner that
 *   pays with it; the smallest coins added up; the fewest coins; and the
 *   fewest coins within each linkage cluster.
 *
 * Ranked by privacy cost (COST), then inputs, then fee, then change. Up to
 * MAX_PLANS plans are returned, the best of each strategy; a plan with no
 * cost (links nothing new, leaves no change) is returned alone. A plan with a high-severity warning (CoinJoin outputs merged
 * with each other or with unmixed coins, a mixed output leaving change at
 * least the payment) is shown only when no other set pays.
 *
 * Linkage clusters (wallet-clusters.ts) carry what the wallet's history
 * already links on-chain: merging within one certain cluster is free and
 * counts as one origin; merging within one inferred cluster (sibling outputs
 * of one payment and their descendants) costs half a link. Mixed CoinJoin outputs are spent whole, ideally with no
 * change. CoinJoin change is not mixed: it stays linked to the coins that
 * entered the CoinJoin.
 *
 * Never selected: dust (may come from a dust attack) and coins worth no more
 * than their own input fee at the given rate.
 * "Insufficient" only when every spendable coin together cannot pay
 * amount + fee, reported with the shortfall.
 */

import type { MempoolUtxo } from "@/lib/api/types";
import type { Severity } from "@/lib/types";
import type { WalletAddressInfo } from "./wallet-audit";
import { buildWalletGraph, coinClass, type CoinClass } from "./wallet-behavior";
import { buildClusters } from "./wallet-clusters";
import { P2PKH_DUST_LIMIT, TOXIC_CHANGE_THRESHOLD } from "@/lib/constants";

// ---------- Types ----------

export interface CoinSelectionInput {
  utxo: MempoolUtxo;
  /** Address this UTXO belongs to */
  address: string;
  /** Origin class from the wallet's history (wallet-behavior coinClass) */
  origin?: CoinClass;
  /** Certain linkage cluster (wallet-clusters): coins of one cluster are already linked on-chain */
  cluster?: string;
  /** Inferred linkage cluster: probably linked (sibling outputs of one payment and their descendants) */
  group?: string;
  /** The address has been funded more than once */
  reusedAddress?: boolean;
}

/** Where a selected coin comes from. `with` is the 1-based row of the related coin. */
export type OriginHint =
  | { kind: "coinjoin" }
  | { kind: "coinjoin-change" }
  | { kind: "same-tx"; with: number }
  | { kind: "same-address"; with: number }
  | { kind: "linked"; with: number }
  | { kind: "probably-linked"; with: number }
  | { kind: "reused-address" };

export interface SelectedCoin extends CoinSelectionInput {
  hints: OriginHint[];
}

export type PlanWarningId =
  | "coinjoin-mix" | "coinjoin-merge" | "mixed-change" | "coinjoin-change" | "merges-origins" | "toxic-change" | "mixed-scripts";

export interface PlanWarning {
  id: PlanWarningId;
  severity: Severity;
  /** Number shown in the message (coins, origins, change sats, script types) */
  count: number;
}

export type PlanStrategy = "single-coin" | "no-change" | "same-origin" | "probably-linked" | "multi-coin";

/** Why a plan ranks where it does, in one line. */
export type PlanReason = "fallback" | "links" | "inferred-links" | "bad-change" | "big-change" | "clean" | "small-change";

export interface CoinSelectionPlan {
  strategy: PlanStrategy;
  reason: PlanReason;
  /** Privacy cost points (COST); lower is better */
  cost: number;
  selected: SelectedCoin[];
  inputTotal: number;
  paymentAmount: number;
  /** Fee in sats; includes any leftover absorbed when there is no change */
  fee: number;
  /** Change in sats, 0 when changeless */
  change: number;
  /** Changeless only: leftover sats added to the fee instead of a dust-sized change output */
  absorbed: number;
  /** Distinct certain linkage clusters among the selected coins */
  origins: number;
  /** Distinct inferred linkage clusters (at most `origins`) */
  groups: number;
  warnings: PlanWarning[];
}

interface Excluded {
  /** Dust coins left out */
  dustExcluded: number;
  /** Coins worth no more than their own input fee at this rate */
  uneconomical: number;
}

export type CoinSelectionAdvice =
  | ({
      kind: "plans";
      /** Ranked best first, at most MAX_PLANS */
      plans: CoinSelectionPlan[];
      /** No single coin pays: whether the wallet holds roughly enough for a Stonewall. null otherwise. */
      stonewall: boolean | null;
    } & Excluded)
  | ({ kind: "insufficient"; spendable: number; shortfall: number } & Excluded)
  | { kind: "invalid" };

// ---------- Fee estimation ----------

export function scriptType(address: string): "p2tr" | "p2wpkh" | "p2sh" | "p2pkh" {
  if (address.startsWith("bc1p") || address.startsWith("tb1p")) return "p2tr";
  if (address.startsWith("bc1q") || address.startsWith("tb1q")) return "p2wpkh";
  if (address.startsWith("3") || address.startsWith("2")) return "p2sh";
  return "p2pkh";
}

/** Estimated vbytes per input by script type. */
export const INPUT_VB = { p2tr: 58, p2wpkh: 68, p2sh: 91, p2pkh: 148 } as const;
const BASE_VB = 10;
/** ponytail: output type is unknown (payment) or wallet-specific (change), so a P2WPKH-sized output is assumed. */
const OUTPUT_VB = 31;

/** Leftover at or below this goes to the fee instead of a change output. */
const CHANGELESS_TOLERANCE = 1000;
/** Search budget (DFS calls or pair/triple probes) per search: fewest coins, smallest partners, all per-cluster searches together, and each changeless search. */
const MAX_ITERATIONS = 100_000;

/** Fee and change for inputs worth `total` sats and `inVb` vbytes, or null when they cannot pay. */
function settle(total: number, inVb: number, amount: number, feeRate: number): { fee: number; change: number } | null {
  if (total - amount - Math.ceil((inVb + BASE_VB + OUTPUT_VB) * feeRate) < 0) return null;
  const change = total - amount - Math.ceil((inVb + BASE_VB + 2 * OUTPUT_VB) * feeRate);
  if (change > CHANGELESS_TOLERANCE) return { fee: total - amount - change, change };
  return { fee: total - amount, change: 0 };
}

/** 0 changeless, 1 change large enough to spend later, 2 toxic change. */
const changeClass = (change: number) => (change === 0 ? 0 : change >= TOXIC_CHANGE_THRESHOLD ? 1 : 2);

// ---------- Origins ----------

/**
 * Origin per coin: union-find over its address and linkage cluster (the
 * address also covers coins that carry no cluster). `inferred` adds the
 * inferred cluster.
 */
function originIds(coins: CoinSelectionInput[], inferred: boolean): number[] {
  const parent = coins.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstBy = new Map<string, number>();
  coins.forEach((c, i) => {
    const keys = [`a:${c.address}`];
    if (c.cluster !== undefined) keys.push(`c:${c.cluster}`);
    if (inferred && c.group !== undefined) keys.push(`g:${c.group}`);
    for (const k of keys) {
      const j = firstBy.get(k);
      if (j === undefined) firstBy.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  return coins.map((_, i) => find(i));
}

export function withHints(coins: CoinSelectionInput[]): SelectedCoin[] {
  return coins.map((c, i) => {
    const hints: OriginHint[] = [];
    if (c.origin === "mixed") hints.push({ kind: "coinjoin" });
    if (c.origin === "coinjoin-change") hints.push({ kind: "coinjoin-change" });
    const sameTx = coins.findIndex((o, j) => j !== i && o.utxo.txid === c.utxo.txid);
    if (sameTx >= 0) hints.push({ kind: "same-tx", with: sameTx + 1 });
    const sameAddr = coins.findIndex((o, j) => j !== i && o.address === c.address);
    if (sameAddr >= 0) hints.push({ kind: "same-address", with: sameAddr + 1 });
    if (sameTx < 0 && sameAddr < 0 && c.cluster !== undefined) {
      const linked = coins.findIndex((o, j) => j !== i && o.cluster === c.cluster);
      const probably = coins.findIndex((o, j) => j !== i && c.group !== undefined && o.group === c.group);
      if (linked >= 0) hints.push({ kind: "linked", with: linked + 1 });
      else if (probably >= 0) hints.push({ kind: "probably-linked", with: probably + 1 });
    }
    if (c.reusedAddress) hints.push({ kind: "reused-address" });
    return { ...c, hints };
  });
}

// ---------- Search ----------

interface Candidate {
  coin: CoinSelectionInput;
  /** Certain origin (originIds) */
  group: number;
  /** Inferred origin */
  loose: number;
  value: number;
  vb: number;
}

type RankKey = [changeClass: number, origins: number, leftover: number];
const better = (a: RankKey, b: RankKey) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/**
 * Best set of the minimum possible size that pays amount + fee.
 * Rank: changeless, then non-toxic change, then toxic change; within each,
 * fewer distinct origins, then less change (or overpay).
 * Candidates must be sorted by value descending. `budget.left` is shared and decremented.
 */
function fewestCoins(cands: Candidate[], amount: number, feeRate: number, budget: { left: number }, maxK = Infinity): Candidate[] | null {
  // Smallest k whose k largest coins can pay.
  let k = 0;
  for (let i = 0, sum = 0, vb = 0; i < cands.length; i++) {
    sum += cands[i]!.value;
    vb += cands[i]!.vb;
    if (settle(sum, vb, amount, feeRate)) { k = i + 1; break; }
  }
  if (k === 0 || k > maxK) return null;

  const suffix = new Array<number>(cands.length + 1).fill(0);
  for (let i = cands.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + cands[i]!.value;
  const minFee = Math.ceil((k * INPUT_VB.p2tr + BASE_VB + OUTPUT_VB) * feeRate);

  let best: Candidate[] | null = null;
  let bestKey: RankKey = [Infinity, Infinity, Infinity];
  const chosen: number[] = [];
  const seen = new Set<number>();

  // ponytail: budgeted k-subset DFS. The first leaf is the top-k set; past the budget
  // on huge wallets the pick is good, not provably best.
  function dfs(index: number, sum: number, vb: number): void {
    if (budget.left-- <= 0) return;
    const need = k - chosen.length;
    if (need === 0) {
      const s = settle(sum, vb, amount, feeRate);
      if (!s) return;
      seen.clear();
      for (const i of chosen) seen.add(cands[i]!.group);
      const key: RankKey = [changeClass(s.change), seen.size, s.change || s.fee];
      if (better(key, bestKey)) {
        bestKey = key;
        best = chosen.map(i => cands[i]!);
      }
      return;
    }
    if (cands.length - index < need) return;
    // Sorted descending: the next `need` coins are the largest still reachable.
    if (sum + suffix[index]! - suffix[index + need]! < amount + minFee) return;
    const c = cands[index]!;
    chosen.push(index);
    dfs(index + 1, sum + c.value, vb + c.vb);
    chosen.pop();
    dfs(index + 1, sum, vb);
  }
  dfs(0, 0, 0);
  return best;
}

/**
 * Changeless set of 2 or 3 coins, in the spirit of Bitcoin Core's Branch and Bound:
 * coins whose effective values (value minus own input fee) sum within
 * [target, target + cost of change], where target is the amount plus the fee of a
 * 1-output tx and cost of change is one more output plus CHANGELESS_TOLERANCE
 * (the window in which settle() reports no change). Fewest inputs first, then
 * least fee. `budget.left` is shared and decremented.
 */
function changelessSet(cands: Candidate[], amount: number, feeRate: number, budget: { left: number }): Candidate[] | null {
  const lo = amount + (BASE_VB + OUTPUT_VB) * feeRate;
  const hi = lo + OUTPUT_VB * feeRate + CHANGELESS_TOLERANCE;
  const ev = (c: Candidate) => c.value - c.vb * feeRate;
  const cs = cands.filter(c => ev(c) <= hi).sort((a, b) => ev(a) - ev(b));
  const e = cs.map(ev);
  const n = cs.length;
  /** First index >= from whose effective value is >= x. */
  const lb = (x: number, from: number) => {
    let l = from, r = n;
    while (l < r) { const m = (l + r) >> 1; if (e[m]! < x) l = m + 1; else r = m; }
    return l;
  };
  let best: Candidate[] | null = null;
  let bestFee = Infinity;
  const consider = (idx: number[]) => {
    const set = idx.map(i => cs[i]!).reverse(); // largest first, like the other plans
    // ev uses an unrounded fee; settle() has the final word.
    const s = settle(set.reduce((t, c) => t + c.value, 0), set.reduce((t, c) => t + c.vb, 0), amount, feeRate);
    if (s && s.change === 0 && s.fee < bestFee) { best = set; bestFee = s.fee; }
  };

  // Pairs: for each coin the smallest partner that reaches the target (least overpay).
  for (let i = 0; i < n - 1 && e[i]! + e[i + 1]! <= hi; i++) {
    if (budget.left-- <= 0) return best;
    const j = lb(lo - e[i]!, i + 1);
    if (j < n && e[i]! + e[j]! <= hi) consider([i, j]);
  }
  if (best) return best;

  // ponytail: budgeted O(n^2 log n) triple scan; past the budget on huge wallets a triple may be missed.
  for (let i = 0; i < n - 2 && e[i]! + e[i + 1]! + e[i + 2]! <= hi; i++) {
    // Skip partners too small to reach the target even with the largest third coin.
    for (let j = Math.max(i + 1, lb(lo - e[i]! - e[n - 1]!, i + 1)); j < n - 1 && e[i]! + e[j]! + e[j + 1]! <= hi; j++) {
      if (budget.left-- <= 0) return best;
      const k = lb(lo - e[i]! - e[j]!, j + 1);
      if (k < n && e[i]! + e[j]! + e[k]! <= hi) consider([i, j, k]);
    }
  }
  return best;
}

/** Coins by inferred origin (each holds whole certain origins). */
function groupBy(cands: Candidate[]): Candidate[][] {
  const groups = new Map<number, Candidate[]>();
  for (const c of cands) {
    const g = groups.get(c.loose);
    if (g) g.push(c);
    else groups.set(c.loose, [c]);
  }
  return [...groups.values()];
}

/** Change at least this many times the payment counts as "much larger". */
const BIG_CHANGE_RATIO = 3;
/** Plans returned at most. */
export const MAX_PLANS = 3;
/**
 * When a single coin pays, sets of coins that cannot pay alone are searched
 * only up to this size: a set past it links too much to beat one coin.
 */
const MAX_SMALL_SET = 6;

/** From this change-to-payment ratio the big-change cost grows with the ratio. */
const HUGE_CHANGE_RATIO = 10;

/**
 * Privacy cost weights. A new link is the main cost; a link the history
 * already makes probable (inferred) costs half. Change badness (toxic size,
 * or change from a CoinJoin coin) costs a little less than a link. Change
 * much larger than the payment keeps most of the coin's value on change
 * linked to this payment (the recipient sees the input's value either way):
 * from 3x it costs bigChange, from 10x it grows with the ratio, capped at
 * bigChange + half a link. The ratios keep the earlier rulings: a changeless
 * merge of 2 origins beats a single coin whose change is toxic or 3x the
 * payment, never one with ordinary change, and never a merge of 3 origins.
 */
const COST = { link: 12, change: 4, badChange: 10, bigChange: 9, coinjoinMerge: 40 } as const;

/** Big-change cost for a change-to-payment ratio. */
function bigChangeCost(ratio: number): number {
  if (ratio < BIG_CHANGE_RATIO) return 0;
  if (ratio < HUGE_CHANGE_RATIO) return COST.bigChange;
  return COST.bigChange + Math.min(COST.link / 2, COST.link * Math.log10(ratio / HUGE_CHANGE_RATIO));
}

interface Scored {
  picked: Candidate[];
  fee: number;
  change: number;
  origins: number;
  groups: number;
  /** Mixed outputs spent: on equal cost, CoinJoin change (toxic anyway) goes before a mixed output */
  mixed: number;
  cost: number;
  /** Merges a mixed output, or a mixed output leaves change at least the payment */
  severe: boolean;
  badChange: boolean;
}

function score(picked: Candidate[], amount: number, feeRate: number): Scored | null {
  const s = settle(picked.reduce((t, c) => t + c.value, 0), picked.reduce((t, c) => t + c.vb, 0), amount, feeRate);
  if (!s) return null;
  const origins = new Set(picked.map(c => c.group)).size;
  const groups = new Set(picked.map(c => c.loose)).size;
  const mixedCount = picked.filter(c => c.coin.origin === "mixed").length;
  const mixed = mixedCount > 0;
  const fromCoinJoin = mixed || picked.some(c => c.coin.origin === "coinjoin-change");
  const badChange = s.change > 0 && (s.change < TOXIC_CHANGE_THRESHOLD || fromCoinJoin);
  let cost = (groups - 1) * COST.link + (origins - groups) * (COST.link / 2);
  if (mixed && picked.length > 1) cost += COST.coinjoinMerge;
  if (s.change > 0) cost += COST.change;
  if (badChange) cost += COST.badChange;
  cost += bigChangeCost(s.change / amount);
  const severe = mixed && (picked.length > 1 || s.change >= amount);
  return { picked, ...s, origins, groups, mixed: mixedCount, cost, severe, badChange };
}

/** Smallest coins first until they pay, or null past MAX_SMALL_SET coins. */
function smallestFirst(small: Candidate[], amount: number, feeRate: number): Candidate[] | null {
  const asc = [...small].reverse();
  for (let i = 0, sum = 0, vb = 0; i < asc.length && i < MAX_SMALL_SET; i++) {
    sum += asc[i]!.value;
    vb += asc[i]!.vb;
    if (settle(sum, vb, amount, feeRate)) return asc.slice(0, i + 1);
  }
  return null;
}

/** For each coin, the smallest partner that pays with it. `small` is sorted descending. */
function smallestPartners(small: Candidate[], amount: number, feeRate: number, budget: { left: number }): Candidate[][] {
  const asc = [...small].reverse();
  const out: Candidate[][] = [];
  for (let i = 0; i < asc.length; i++) {
    // Partners below this value cannot pay even at zero fee.
    const need = amount - asc[i]!.value;
    let l = 0, r = asc.length;
    while (l < r) { const m = (l + r) >> 1; if (asc[m]!.value < need) l = m + 1; else r = m; }
    for (let j = l; j < asc.length; j++) {
      if (budget.left-- <= 0) return out;
      if (j === i) continue;
      if (settle(asc[i]!.value + asc[j]!.value, asc[i]!.vb + asc[j]!.vb, amount, feeRate)) { out.push([asc[j]!, asc[i]!]); break; }
    }
  }
  return out;
}

function reasonOf(x: Scored, amount: number, fallback: boolean): PlanReason {
  if (fallback) return "fallback";
  if (x.groups > 1) return "links";
  if (x.origins > 1) return "inferred-links";
  if (x.badChange) return "bad-change";
  if (x.change >= BIG_CHANGE_RATIO * amount) return "big-change";
  return x.change === 0 ? "clean" : "small-change";
}

// ---------- Plans ----------

const strategyOf = (x: Scored): PlanStrategy =>
  x.picked.length === 1 ? "single-coin"
  : x.change === 0 ? "no-change"
  : x.origins === 1 ? "same-origin"
  : x.groups === 1 ? "probably-linked"
  : "multi-coin";

function buildPlan(x: Scored, amount: number, feeRate: number, fallback: boolean): CoinSelectionPlan {
  const coins = x.picked.map(c => c.coin);
  const inputTotal = x.picked.reduce((s, c) => s + c.value, 0);
  const inVb = x.picked.reduce((s, c) => s + c.vb, 0);
  const { fee, change, origins, groups } = x;
  const absorbed = change === 0 ? fee - Math.ceil((inVb + BASE_VB + OUTPUT_VB) * feeRate) : 0;
  const warnings: PlanWarning[] = [];

  const mixed = coins.filter(c => c.origin === "mixed");
  if (mixed.length > 0 && mixed.length < coins.length) {
    warnings.push({ id: "coinjoin-mix", severity: "high", count: mixed.length });
  } else if (mixed.length > 1) {
    // Even outputs of one CoinJoin: spending them together links them again.
    warnings.push({ id: "coinjoin-merge", severity: "high", count: mixed.length });
  } else if (mixed.length === 1 && change >= amount) {
    warnings.push({ id: "mixed-change", severity: "high", count: change });
  }
  const cjChange = coins.filter(c => c.origin === "coinjoin-change").length;
  if (cjChange > 0) warnings.push({ id: "coinjoin-change", severity: "medium", count: cjChange });
  if (groups > 1) warnings.push({ id: "merges-origins", severity: "medium", count: groups });
  if (change > 0 && change < TOXIC_CHANGE_THRESHOLD) warnings.push({ id: "toxic-change", severity: "medium", count: change });
  const scripts = new Set(coins.map(c => scriptType(c.address))).size;
  if (scripts > 1) warnings.push({ id: "mixed-scripts", severity: "low", count: scripts });

  return {
    strategy: strategyOf(x), reason: reasonOf(x, amount, fallback), cost: x.cost,
    selected: withHints(coins), inputTotal, paymentAmount: amount, fee, change, absorbed, origins, groups, warnings,
  };
}

/**
 * Recommend which coins to spend for a payment.
 *
 * @param utxos - Wallet UTXOs with address and origin info
 * @param paymentAmount - Payment amount in sats
 * @param feeRate - Fee rate in sat/vB
 */
export function adviseCoinSelection(
  utxos: CoinSelectionInput[],
  paymentAmount: number,
  feeRate = 5,
): CoinSelectionAdvice {
  if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 || !Number.isFinite(feeRate) || feeRate <= 0) {
    return { kind: "invalid" };
  }

  const notDust = utxos.filter(u => u.utxo.value >= P2PKH_DUST_LIMIT);
  const vbOf = (c: CoinSelectionInput) => INPUT_VB[scriptType(c.address)];
  const usable = notDust.filter(c => c.utxo.value > vbOf(c) * feeRate);
  const excluded: Excluded = { dustExcluded: utxos.length - notDust.length, uneconomical: notDust.length - usable.length };

  const group = originIds(usable, false);
  const loose = originIds(usable, true);
  const cands: Candidate[] = usable
    .map((coin, i) => ({ coin, group: group[i]!, loose: loose[i]!, value: coin.utxo.value, vb: vbOf(coin) }))
    .sort((a, b) => b.value - a.value);

  const spendable = cands.reduce((s, c) => s + c.value, 0);
  const allVb = cands.reduce((s, c) => s + c.vb, 0);
  if (!settle(spendable, allVb, paymentAmount, feeRate)) {
    const fee = Math.ceil((allVb + BASE_VB + OUTPUT_VB) * feeRate);
    return { kind: "insufficient", spendable, shortfall: paymentAmount + fee - spendable, ...excluded };
  }

  const pays = (set: Candidate[]) =>
    settle(set.reduce((s, c) => s + c.value, 0), set.reduce((s, c) => s + c.vb, 0), paymentAmount, feeRate) !== null;
  const singles = cands.filter(c => pays([c]));
  // Coins that cannot pay alone. A set with change that holds a coin able to pay
  // alone is never better than that coin alone (more links, more change).
  const small = cands.filter(c => !pays([c]));

  const sets: (Candidate[] | null)[] = singles.map(c => [c]);
  const budget = { left: MAX_ITERATIONS };
  const groupBudget = { left: MAX_ITERATIONS };
  sets.push(changelessSet(cands, paymentAmount, feeRate, budget));
  for (const g of groupBy(cands)) if (g.length > 1) sets.push(changelessSet(g, paymentAmount, feeRate, groupBudget));
  if (pays(small)) {
    // No single coin: the first DFS leaf is the top-k set, so a result always exists.
    const maxK = singles.length > 0 ? MAX_SMALL_SET : Infinity;
    sets.push(fewestCoins(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }, maxK));
    sets.push(smallestFirst(small, paymentAmount, feeRate));
    sets.push(...smallestPartners(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }));
    const sameBudget = { left: MAX_ITERATIONS };
    for (const g of groupBy(small)) if (g.length > 1 && pays(g)) sets.push(fewestCoins(g, paymentAmount, feeRate, sameBudget, maxK));
  }

  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (const set of sets) {
    if (!set) continue;
    const id = set.map(c => `${c.coin.utxo.txid}:${c.coin.utxo.vout}`).sort().join();
    if (seen.has(id)) continue;
    seen.add(id);
    const x = score(set, paymentAmount, feeRate);
    if (x) scored.push(x);
  }
  scored.sort((a, b) => a.cost - b.cost || a.mixed - b.mixed || a.picked.length - b.picked.length || a.fee - b.fee || a.change - b.change);

  // High-severity plans only when nothing else pays.
  const safe = scored.filter(x => !x.severe);
  const fallback = safe.length === 0;
  // The best plan of each strategy. A plan with no cost (links nothing new, no change) stands alone.
  const plans: CoinSelectionPlan[] = [];
  for (const x of fallback ? scored : safe) {
    if (plans.length === MAX_PLANS || plans[0]?.cost === 0) break;
    if (!plans.some(p => p.strategy === strategyOf(x))) plans.push(buildPlan(x, paymentAmount, feeRate, fallback));
  }

  // Stonewall pays the amount twice (payment + decoy), each side funded by its own coins.
  const stonewall = singles.length > 0 ? null : spendable >= 2 * (paymentAmount + plans[0]!.fee);
  return { kind: "plans", plans, stonewall, ...excluded };
}

// ---------- Wallet data ----------

/** Flatten wallet scan data into selector inputs with origin class and linkage cluster. */
export function buildCoinInputs(infos: WalletAddressInfo[]): CoinSelectionInput[] {
  const g = buildWalletGraph(infos);
  const clusters = buildClusters(g);
  return infos.flatMap(info => {
    const d = info.addressData;
    const funded = d ? d.chain_stats.funded_txo_count + d.mempool_stats.funded_txo_count : info.utxos.length;
    return info.utxos.map(utxo => ({
      utxo,
      address: info.derived.address,
      origin: coinClass(g, utxo.txid, utxo.vout),
      cluster: clusters.of(utxo.txid, utxo.vout),
      group: clusters.inferredOf(utxo.txid, utxo.vout),
      reusedAddress: funded > 1,
    }));
  });
}
