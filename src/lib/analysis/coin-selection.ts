/**
 * Coin Selection Advisor
 *
 * Given the wallet's UTXOs and a payment amount, recommends which coins to
 * spend with privacy as the primary criterion.
 *
 * - One coin covers it: the smallest coin that does (changeless when the
 *   leftover is small enough to give to the fee).
 * - No single coin covers it: up to two ranked multi-coin plans
 *     "same-origin":  coins already linked on chain (same address, or same
 *                     non-CoinJoin funding tx), so merging reveals nothing new
 *     "fewest-coins": the minimum number of coins, preferring changeless
 *                     sets, then fewer distinct origins, then less change
 *   plus a Stonewall hint (not built here).
 * - "Insufficient" only when every spendable coin together cannot pay
 *   amount + fee, reported with the shortfall.
 *
 * Dust coins are never selected: they may come from a dust attack.
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

export type PlanStrategy = "single-coin" | "same-origin" | "fewest-coins";

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

export type CoinSelectionAdvice =
  | {
      kind: "plans";
      /** Ranked best first */
      plans: CoinSelectionPlan[];
      /** Multi-coin case: whether the wallet holds roughly enough for a Stonewall. null for one coin. */
      stonewall: boolean | null;
      dustExcluded: number;
    }
  | { kind: "insufficient"; spendable: number; shortfall: number; dustExcluded: number };

// ---------- Fee estimation ----------

function scriptType(address: string): "p2tr" | "p2wpkh" | "p2sh" | "p2pkh" {
  if (address.startsWith("bc1p") || address.startsWith("tb1p")) return "p2tr";
  if (address.startsWith("bc1q") || address.startsWith("tb1q")) return "p2wpkh";
  if (address.startsWith("3") || address.startsWith("2")) return "p2sh";
  return "p2pkh";
}

/** Estimated vbytes per input by script type. */
const INPUT_VB = { p2tr: 58, p2wpkh: 68, p2sh: 91, p2pkh: 148 } as const;

/** ~31 vbytes per output + 10 base overhead. */
function estimateFee(inputs: CoinSelectionInput[], outputCount: number, feeRate: number): number {
  const vb = inputs.reduce((s, i) => s + INPUT_VB[scriptType(i.address)], 0) + 10 + outputCount * 31;
  return Math.ceil(vb * feeRate);
}

/** Leftover at or below this goes to the fee instead of a change output. */
const CHANGELESS_TOLERANCE = 1000;
/** Search budget per subset search. */
const MAX_ITERATIONS = 100_000;

/** Fee and change for spending `coins`, or null when they cannot pay. */
function settle(coins: CoinSelectionInput[], amount: number, feeRate: number): { fee: number; change: number } | null {
  const total = coins.reduce((s, c) => s + c.utxo.value, 0);
  if (total - amount - estimateFee(coins, 1, feeRate) < 0) return null;
  const change = total - amount - estimateFee(coins, 2, feeRate);
  if (change > CHANGELESS_TOLERANCE) return { fee: total - amount - change, change };
  return { fee: total - amount, change: 0 };
}

// ---------- Origins ----------

/** Union-find over coins: same address, or same non-CoinJoin funding tx. */
function originIds(coins: CoinSelectionInput[]): number[] {
  const parent = coins.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const firstBy = new Map<string, number>();
  coins.forEach((c, i) => {
    // Two outputs of one CoinJoin are not known to share an owner: never a link.
    const keys = [`a:${c.address}`, ...(c.fromCoinJoin ? [] : [`t:${c.utxo.txid}`])];
    for (const k of keys) {
      const j = firstBy.get(k);
      if (j === undefined) firstBy.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  return coins.map((_, i) => find(i));
}

function withHints(coins: CoinSelectionInput[]): SelectedCoin[] {
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
}

type RankKey = [hasChange: number, origins: number, leftover: number];
const better = (a: RankKey, b: RankKey) =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/**
 * Best set of the minimum possible size that pays amount + fee.
 * Rank: changeless first, then fewer distinct origins, then less change (or overpay).
 * Candidates must be sorted by value descending.
 */
function fewestCoins(cands: Candidate[], amount: number, feeRate: number): Candidate[] | null {
  // Smallest k whose k largest coins can pay.
  let k = 0;
  for (let i = 1; i <= cands.length && k === 0; i++) {
    if (settle(cands.slice(0, i).map(c => c.coin), amount, feeRate)) k = i;
  }
  if (k === 0) return null;

  const suffix = new Array<number>(cands.length + 1).fill(0);
  for (let i = cands.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + cands[i]!.coin.utxo.value;
  const minFee = Math.ceil((k * INPUT_VB.p2tr + 41) * feeRate);

  let best: Candidate[] | null = null;
  let bestKey: RankKey = [Infinity, Infinity, Infinity];
  let iterations = 0;
  const chosen: Candidate[] = [];

  // ponytail: capped k-subset DFS. The first leaf is the top-k set, so a result always
  // exists; past the cap on huge wallets the pick is good, not provably best.
  function dfs(index: number, sum: number): void {
    if (iterations++ > MAX_ITERATIONS) return;
    const need = k - chosen.length;
    if (need === 0) {
      const s = settle(chosen.map(c => c.coin), amount, feeRate);
      if (!s) return;
      const key: RankKey = [s.change > 0 ? 1 : 0, new Set(chosen.map(c => c.origin)).size, s.change || s.fee];
      if (better(key, bestKey)) {
        bestKey = key;
        best = [...chosen];
      }
      return;
    }
    if (cands.length - index < need) return;
    // Sorted descending: the next `need` coins are the largest still reachable.
    if (sum + suffix[index]! - suffix[index + need]! < amount + minFee) return;
    chosen.push(cands[index]!);
    dfs(index + 1, sum + cands[index]!.coin.utxo.value);
    chosen.pop();
    dfs(index + 1, sum);
  }
  dfs(0, 0);
  return best;
}

// ---------- Plans ----------

function buildPlan(strategy: PlanStrategy, picked: Candidate[], amount: number, feeRate: number): CoinSelectionPlan {
  const coins = picked.map(c => c.coin);
  // Callers only pass sets that pay.
  const { fee, change } = settle(coins, amount, feeRate)!;
  const origins = new Set(picked.map(c => c.origin)).size;
  const warnings: PlanWarning[] = [];

  const cj = coins.filter(c => c.fromCoinJoin);
  if (cj.length > 0 && cj.length < coins.length) {
    warnings.push({ id: "coinjoin-mix", severity: "high", count: cj.length });
  } else if (new Set(cj.map(c => c.utxo.txid)).size > 1) {
    warnings.push({ id: "coinjoin-merge", severity: "high", count: cj.length });
  }
  if (origins > 1) warnings.push({ id: "merges-origins", severity: "medium", count: origins });
  if (change > 0 && change < TOXIC_CHANGE_THRESHOLD) warnings.push({ id: "toxic-change", severity: "medium", count: change });
  const scripts = new Set(coins.map(c => scriptType(c.address))).size;
  if (scripts > 1) warnings.push({ id: "mixed-scripts", severity: "low", count: scripts });

  return {
    strategy,
    selected: withHints(coins),
    inputTotal: coins.reduce((s, c) => s + c.utxo.value, 0),
    paymentAmount: amount,
    fee,
    change,
    origins,
    warnings,
  };
}

const sameSet = (a: Candidate[], b: Candidate[]) => a.length === b.length && a.every(x => b.includes(x));

/**
 * Recommend which coins to spend for a payment.
 *
 * @param utxos - Wallet UTXOs with address and origin info
 * @param paymentAmount - Payment amount in sats (> 0)
 * @param feeRate - Fee rate in sat/vB (> 0)
 */
export function adviseCoinSelection(
  utxos: CoinSelectionInput[],
  paymentAmount: number,
  feeRate = 5,
): CoinSelectionAdvice {
  const spendableCoins = utxos.filter(u => u.utxo.value >= P2PKH_DUST_LIMIT);
  const dustExcluded = utxos.length - spendableCoins.length;
  const origin = originIds(spendableCoins);
  const cands: Candidate[] = spendableCoins
    .map((coin, i) => ({ coin, origin: origin[i]! }))
    .sort((a, b) => b.coin.utxo.value - a.coin.utxo.value);

  const spendable = cands.reduce((s, c) => s + c.coin.utxo.value, 0);
  if (!settle(cands.map(c => c.coin), paymentAmount, feeRate)) {
    const fee = estimateFee(cands.map(c => c.coin), 1, feeRate);
    return { kind: "insufficient", spendable, shortfall: paymentAmount + fee - spendable, dustExcluded };
  }

  // One coin: the smallest that pays (sorted descending, so the last match).
  const single = cands.filter(c => settle([c.coin], paymentAmount, feeRate)).at(-1);
  if (single) {
    return { kind: "plans", plans: [buildPlan("single-coin", [single], paymentAmount, feeRate)], stonewall: null, dustExcluded };
  }

  // The full set pays, so a fewest-coins set always exists.
  const fewest = fewestCoins(cands, paymentAmount, feeRate)!;
  const fewestPlan = buildPlan("fewest-coins", fewest, paymentAmount, feeRate);
  const plans: CoinSelectionPlan[] = [];

  if (fewestPlan.origins > 1) {
    let bestGroup: Candidate[] | null = null;
    for (const id of new Set(cands.map(c => c.origin))) {
      const pick = fewestCoins(cands.filter(c => c.origin === id), paymentAmount, feeRate);
      if (pick && (!bestGroup || pick.length < bestGroup.length)) bestGroup = pick;
    }
    if (bestGroup && !sameSet(bestGroup, fewest)) plans.push(buildPlan("same-origin", bestGroup, paymentAmount, feeRate));
  }
  plans.push(fewestPlan);

  // Stonewall pays the amount twice (payment + decoy), each side funded by its own coins.
  const stonewall = spendable >= 2 * (paymentAmount + fewestPlan.fee);
  return { kind: "plans", plans, stonewall, dustExcluded };
}

// ---------- Wallet data ----------

/** Flatten wallet scan data into selector inputs with on-chain origin info. */
export function buildCoinInputs(infos: WalletAddressInfo[]): CoinSelectionInput[] {
  const txById = new Map(infos.flatMap(i => i.txs.map(tx => [tx.txid, tx] as const)));
  const cj = new Map<string, boolean>();
  const isCj = (txid: string) => {
    let v = cj.get(txid);
    if (v === undefined) {
      const tx = txById.get(txid);
      v = tx ? isCoinJoinTx(tx) : false;
      cj.set(txid, v);
    }
    return v;
  };
  return infos.flatMap(info => {
    const d = info.addressData;
    const funded = d ? d.chain_stats.funded_txo_count + d.mempool_stats.funded_txo_count : info.utxos.length;
    return info.utxos.map(utxo => ({
      utxo,
      address: info.derived.address,
      fromCoinJoin: isCj(utxo.txid),
      reusedAddress: funded > 1,
    }));
  });
}
