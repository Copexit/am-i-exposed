/**
 * Coin Selection Advisor
 *
 * Given the wallet's UTXOs and a payment amount, recommends which coins to
 * spend with privacy as the primary criterion.
 *
 * - One coin covers it: the best single coin (changeless, else change that is
 *   not toxic, else the smallest coin that pays). When that coin leaves change,
 *   also a "no-change" plan of up to 3 coins whose sum lands in the changeless
 *   window (see changelessSet), recommended per recommendNoChange.
 * - No single coin covers it: up to two ranked multi-coin plans
 *     "same-origin":  coins that share an address, or a funding tx the wallet
 *                     itself created (not CoinJoins, not batch receipts), so
 *                     merging adds no new source of funds
 *     "fewest-coins": the minimum number of coins, preferring changeless
 *                     sets, then non-toxic change, then fewer distinct
 *                     origins, then less change
 *   plus a Stonewall hint (not built here).
 * - "Insufficient" only when every spendable coin together cannot pay
 *   amount + fee, reported with the shortfall.
 *
 * Never selected: dust (may come from a dust attack) and coins worth no more
 * than their own input fee at the given rate.
 * Origins come from what the chain shows (funding tx, address, CoinJoin,
 * address reuse); the app has no user labels.
 */

import type { MempoolUtxo } from "@/lib/api/types";
import type { Severity } from "@/lib/types";
import type { WalletAddressInfo } from "./wallet-audit";
import { isCoinJoinTx } from "./heuristics/coinjoin";
import { P2PKH_DUST_LIMIT, TOXIC_CHANGE_THRESHOLD } from "@/lib/constants";

// ---------- Types ----------

export interface CoinSelectionInput {
  utxo: MempoolUtxo;
  /** Address this UTXO belongs to */
  address: string;
  /** The funding transaction is a CoinJoin */
  fromCoinJoin?: boolean;
  /** The funding transaction spent this wallet's own coins (the wallet created it) */
  selfFunded?: boolean;
  /** The address has been funded more than once */
  reusedAddress?: boolean;
}

/** Where a selected coin comes from. `with` is the 1-based row of the related coin. */
export type OriginHint =
  | { kind: "coinjoin" }
  | { kind: "same-tx"; with: number }
  | { kind: "same-address"; with: number }
  | { kind: "reused-address" };

export interface SelectedCoin extends CoinSelectionInput {
  hints: OriginHint[];
}

export type PlanWarningId = "coinjoin-mix" | "coinjoin-merge" | "merges-origins" | "toxic-change" | "mixed-scripts";

export interface PlanWarning {
  id: PlanWarningId;
  severity: Severity;
  /** Number shown in the message (coins, origins, change sats, script types) */
  count: number;
}

export type PlanStrategy = "single-coin" | "no-change" | "same-origin" | "fewest-coins";

export interface CoinSelectionPlan {
  strategy: PlanStrategy;
  selected: SelectedCoin[];
  inputTotal: number;
  paymentAmount: number;
  /** Fee in sats; includes any leftover absorbed when there is no change */
  fee: number;
  /** Change in sats, 0 when changeless */
  change: number;
  /** Distinct on-chain origins among the selected coins */
  origins: number;
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
      /** Ranked best first */
      plans: CoinSelectionPlan[];
      /** Multi-coin case: whether the wallet holds roughly enough for a Stonewall. null for one coin. */
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
/** Search budget (DFS calls or pair/triple probes) per search: fewest-coins, all same-origin groups together, and each changeless search. */
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
 * Union-find over coins: same address, or same funding tx that the wallet
 * created itself. Outputs of a CoinJoin or of a batch payout received from
 * someone else are not known to be linked, so they never join.
 */
function originIds(coins: CoinSelectionInput[]): number[] {
  const parent = coins.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstBy = new Map<string, number>();
  coins.forEach((c, i) => {
    const keys = [`a:${c.address}`, ...(c.selfFunded && !c.fromCoinJoin ? [`t:${c.utxo.txid}`] : [])];
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
    if (c.fromCoinJoin) hints.push({ kind: "coinjoin" });
    const sameTx = coins.findIndex((o, j) => j !== i && o.utxo.txid === c.utxo.txid);
    if (sameTx >= 0) hints.push({ kind: "same-tx", with: sameTx + 1 });
    const sameAddr = coins.findIndex((o, j) => j !== i && o.address === c.address);
    if (sameAddr >= 0) hints.push({ kind: "same-address", with: sameAddr + 1 });
    if (c.reusedAddress) hints.push({ kind: "reused-address" });
    return { ...c, hints };
  });
}

// ---------- Search ----------

interface Candidate {
  coin: CoinSelectionInput;
  origin: number;
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
function fewestCoins(cands: Candidate[], amount: number, feeRate: number, budget: { left: number }): Candidate[] | null {
  // Smallest k whose k largest coins can pay.
  let k = 0;
  for (let i = 0, sum = 0, vb = 0; i < cands.length; i++) {
    sum += cands[i]!.value;
    vb += cands[i]!.vb;
    if (settle(sum, vb, amount, feeRate)) { k = i + 1; break; }
  }
  if (k === 0) return null;

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
      for (const i of chosen) seen.add(cands[i]!.origin);
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

function groupByOrigin(cands: Candidate[]): Candidate[][] {
  const groups = new Map<number, Candidate[]>();
  for (const c of cands) {
    const g = groups.get(c.origin);
    if (g) g.push(c);
    else groups.set(c.origin, [c]);
  }
  return [...groups.values()];
}

/**
 * Recommend "No change" over "Single coin" when it reveals nothing new (its coins
 * already share one origin), or when the single coin's change is toxic or at least
 * as large as the payment (a big change output is easy to follow). Never when
 * "No change" carries a high-severity warning (it would merge CoinJoin outputs).
 */
export function recommendNoChange(single: CoinSelectionPlan, noChange: CoinSelectionPlan): boolean {
  if (noChange.warnings.some(w => w.severity === "high")) return false;
  return noChange.origins === 1 || changeClass(single.change) === 2 || single.change >= single.paymentAmount;
}

// ---------- Plans ----------

function buildPlan(strategy: PlanStrategy, picked: Candidate[], amount: number, feeRate: number): CoinSelectionPlan {
  const coins = picked.map(c => c.coin);
  const inputTotal = picked.reduce((s, c) => s + c.value, 0);
  // Callers only pass sets that pay.
  const { fee, change } = settle(inputTotal, picked.reduce((s, c) => s + c.vb, 0), amount, feeRate)!;
  const origins = new Set(picked.map(c => c.origin)).size;
  const warnings: PlanWarning[] = [];

  const cj = coins.filter(c => c.fromCoinJoin);
  if (cj.length > 0 && cj.length < coins.length) {
    warnings.push({ id: "coinjoin-mix", severity: "high", count: cj.length });
  } else if (new Set(cj.map(c => c.utxo.txid)).size > 1) {
    warnings.push({ id: "coinjoin-merge", severity: "high", count: cj.length });
  }
  if (origins > 1) warnings.push({ id: "merges-origins", severity: "medium", count: origins });
  if (changeClass(change) === 2) warnings.push({ id: "toxic-change", severity: "medium", count: change });
  const scripts = new Set(coins.map(c => scriptType(c.address))).size;
  if (scripts > 1) warnings.push({ id: "mixed-scripts", severity: "low", count: scripts });

  return { strategy, selected: withHints(coins), inputTotal, paymentAmount: amount, fee, change, origins, warnings };
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

  const origin = originIds(usable);
  const cands: Candidate[] = usable
    .map((coin, i) => ({ coin, origin: origin[i]!, value: coin.utxo.value, vb: vbOf(coin) }))
    .sort((a, b) => b.value - a.value);

  const spendable = cands.reduce((s, c) => s + c.value, 0);
  const allVb = cands.reduce((s, c) => s + c.vb, 0);
  if (!settle(spendable, allVb, paymentAmount, feeRate)) {
    const fee = Math.ceil((allVb + BASE_VB + OUTPUT_VB) * feeRate);
    return { kind: "insufficient", spendable, shortfall: paymentAmount + fee - spendable, ...excluded };
  }

  // One coin: changeless, then non-toxic change, then toxic; within a class the smallest coin.
  let single: Candidate | null = null;
  let singleClass = Infinity;
  for (const c of cands) {
    const s = settle(c.value, c.vb, paymentAmount, feeRate);
    if (!s) continue;
    const cls = changeClass(s.change);
    if (cls <= singleClass) { single = c; singleClass = cls; } // descending order: later is smaller
  }
  if (single) {
    const singlePlan = buildPlan("single-coin", [single], paymentAmount, feeRate);
    if (singlePlan.change === 0) return { kind: "plans", plans: [singlePlan], stonewall: null, ...excluded };
    // Same-origin sets first (they link nothing new), then any coins.
    const groupBudget = { left: MAX_ITERATIONS };
    const fromGroups = groupByOrigin(cands)
      .filter(g => g.length > 1)
      .map(g => changelessSet(g, paymentAmount, feeRate, groupBudget))
      .filter(s => s !== null)
      .map(s => buildPlan("no-change", s, paymentAmount, feeRate))
      .sort((a, b) => a.selected.length - b.selected.length || a.fee - b.fee);
    const any = fromGroups.length ? null : changelessSet(cands, paymentAmount, feeRate, { left: MAX_ITERATIONS });
    const noChange = fromGroups[0] ?? (any && buildPlan("no-change", any, paymentAmount, feeRate));
    const plans = !noChange ? [singlePlan] : recommendNoChange(singlePlan, noChange) ? [noChange, singlePlan] : [singlePlan, noChange];
    return { kind: "plans", plans, stonewall: null, ...excluded };
  }

  // The full set pays and the first DFS leaf is the top-k set, so a result always exists.
  const fewest = fewestCoins(cands, paymentAmount, feeRate, { left: MAX_ITERATIONS })!;
  const fewestPlan = buildPlan("fewest-coins", fewest, paymentAmount, feeRate);
  const plans: CoinSelectionPlan[] = [];

  if (fewestPlan.origins > 1) {
    const budget = { left: MAX_ITERATIONS };
    let bestGroup: Candidate[] | null = null;
    for (const g of groupByOrigin(cands)) {
      if (g.length < 2) continue; // one coin cannot pay here, or `single` would have
      if (!settle(g.reduce((s, c) => s + c.value, 0), g.reduce((s, c) => s + c.vb, 0), paymentAmount, feeRate)) continue;
      const pick = fewestCoins(g, paymentAmount, feeRate, budget);
      if (pick && (!bestGroup || pick.length < bestGroup.length)) bestGroup = pick;
    }
    const sameAsFewest = bestGroup?.length === fewest.length && bestGroup.every(x => fewest.includes(x));
    if (bestGroup && !sameAsFewest) plans.push(buildPlan("same-origin", bestGroup, paymentAmount, feeRate));
  }
  plans.push(fewestPlan);

  // Stonewall pays the amount twice (payment + decoy), each side funded by its own coins.
  const stonewall = spendable >= 2 * (paymentAmount + fewestPlan.fee);
  return { kind: "plans", plans, stonewall, ...excluded };
}

// ---------- Wallet data ----------

/** Flatten wallet scan data into selector inputs with on-chain origin info. */
export function buildCoinInputs(infos: WalletAddressInfo[]): CoinSelectionInput[] {
  const own = new Set(infos.map(i => i.derived.address));
  const txById = new Map(infos.flatMap(i => i.txs.map(tx => [tx.txid, tx] as const)));
  const cache = new Map<string, { cj: boolean; self: boolean }>();
  const funding = (txid: string) => {
    let v = cache.get(txid);
    if (!v) {
      const tx = txById.get(txid);
      v = tx
        ? { cj: isCoinJoinTx(tx), self: tx.vin.some(i => !!i.prevout?.scriptpubkey_address && own.has(i.prevout.scriptpubkey_address)) }
        : { cj: false, self: false };
      cache.set(txid, v);
    }
    return v;
  };
  return infos.flatMap(info => {
    const d = info.addressData;
    const funded = d ? d.chain_stats.funded_txo_count + d.mempool_stats.funded_txo_count : info.utxos.length;
    return info.utxos.map(utxo => {
      const f = funding(utxo.txid);
      return { utxo, address: info.derived.address, fromCoinJoin: f.cj, selfFunded: f.self, reusedAddress: funded > 1 };
    });
  });
}
