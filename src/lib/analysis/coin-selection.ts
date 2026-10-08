/**
 * Coin Selection Advisor
 *
 * Given the wallet's UTXOs and a payment amount, recommends which coins to
 * spend with privacy as the primary criterion.
 *
 * Candidate sets, always all of them (a covering single coin does not stop
 * the search for multi-coin sets):
 * - every single coin that pays;
 * - changeless sets of 2-3 coins (changelessSets), wallet-wide and within each
 *   linkage cluster;
 * - from the coins that cannot pay alone: for each, the smallest partner that
 *   pays with it; the smallest coins added up; the fewest coins; the sets
 *   with the least change; and the fewest coins within each linkage cluster;
 * - the coins the recipient already knows, on their own.
 *
 * Privacy first (guide, "Spending checklist", "How plans are ranked") compares
 * what each plan lets an observer learn (PlanFacts), not a sum of weights,
 * in this order (comparePrivacy):
 *   a. hard rule violations (KYC with no-KYC, CoinJoin outputs with other
 *      coins, a change coin merged with other coins, two outputs of one
 *      transaction merged, a toxic coin merged): fewer first;
 *   b. the recipient already knows every input: first;
 *   c. change: none < small (at most the payment) < big (more than the
 *      payment) < huge (10x the payment or more) < toxic (under 10,000 sats,
 *      or from a CoinJoin coin, whatever its size). Guide rule 4: a merge
 *      that uses up the change beats one coin with a lot of change. Guard: a
 *      merge joining 3 or more unrelated groups counts as at least "big" here;
 *   d. new certain links: fewer first; at equal links, links one label
 *      observer already knows or between CoinJoin outputs only first;
 *   e. change detectable by the round-amount or address-type rules: fewer first;
 *   f. probable links confirmed: fewer first;
 *   g. inputs: fewer first;
 *   h. fee (absorbed leftover included): lower first, a difference below
 *      max(1,000 sats, 1% of the payment) counting as none;
 *   then less change.
 * Pareto pruning over the same facts drops a plan another beats or matches on
 * every one; up to MAX_PLANS plans are returned: the best under each ranking
 * criterion (rankPlans), then the rest in Privacy-first order. A plan that
 * merges CoinJoin outputs with unmixed coins, or a mixed output leaving change
 * at least the payment, is shown only when no other set pays; a merge of only
 * CoinJoin outputs never when one coin pays alone.
 *
 * Linkage clusters (wallet-clusters.ts) carry what the wallet's history
 * already links on-chain: merging within one certain cluster links nothing
 * new; merging within one inferred cluster (descendants of one payment's
 * outputs) confirms a probable link. Sibling outputs of one transaction are
 * not "probably linked" here: spending them together reveals the transaction
 * paid the wallet itself, a hard violation (same-tx), counted once: not also a
 * change merge, a new link, a probable link or a group in the 3-group guard.
 *
 * Never selected: dust (may come from a dust attack) and coins worth no more
 * than their own input fee at the given rate.
 * "Insufficient" only when every spendable coin together cannot pay
 * amount + fee, reported with the shortfall.
 */

import type { MempoolUtxo } from "@/lib/api/types";
import type { Severity } from "@/lib/types";
import type { WalletAddressInfo } from "./wallet-audit";
import { buildWalletGraph, coinClass, isChangeClass, type CoinClass } from "./wallet-behavior";
import { buildClusters } from "./wallet-clusters";
import { isRoundAmount } from "./heuristics/round-amount";
import { getAddressType } from "@/lib/bitcoin/address-type";
import { P2PKH_DUST_LIMIT, TOXIC_CHANGE_THRESHOLD } from "@/lib/constants";
import type { LabelTag } from "@/lib/wallet/labels";

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
  /** Wallet label tags (lib/wallet/labels), own or inherited from the funding coins */
  labelTags?: readonly LabelTag[];
  /** Wallet label origin keys ("kyc:bitstamp"), own or inherited */
  labelOrigins?: readonly string[];
  /** Wallet label text (the output's, else its address's) */
  label?: string;
  /** Frozen by a label (spendable: false): left out unless the user includes frozen coins */
  frozen?: boolean;
  /** The label's observer field (who can link the coin to you), when labeled */
  labelObserver?: string;
  /** The label's platform or reason field, when present */
  labelPlatform?: string;
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
  | "change-merge" | "same-tx"
  | "coinjoin-mix" | "coinjoin-merge" | "mixed-change" | "coinjoin-change" | "merges-origins" | "toxic-change" | "mixed-scripts"
  | "extra-fee"
  | "label-kyc" | "label-coinjoin" | "label-origins" | "label-toxic";

/**
 * The labeling convention's spending rules (guide, "Labeling recommendations"):
 * kyc (1) never merge [KYC] with [noKYC]; coinjoin (2) spend [CJ] coins one by
 * one; origin (3) prefer coins of one origin or already linked on-chain;
 * toxic (5) never merge a [toxic] coin. Rule 4 (change inherits its parent's
 * origin) is applied when labels are resolved; rule 6 (spend change on its
 * own) is a hard violation (PlanFacts).
 */
export type LabelRuleId = "kyc" | "coinjoin" | "origin" | "toxic";

export interface PlanWarning {
  id: PlanWarningId;
  severity: Severity;
  /** Number shown in the message (coins, origins, change sats, script types, coin row) */
  count: number;
}

export type PlanStrategy = "single-coin" | "no-change" | "same-origin" | "probably-linked" | "multi-coin";

/** Hard rule violations (tier a), in the guide's order. */
export type ViolationId = "kyc" | "coinjoin" | "change-merge" | "same-tx" | "toxic";
export const VIOLATIONS: readonly ViolationId[] = ["kyc", "coinjoin", "change-merge", "same-tx", "toxic"];

/** Change class (tier c). */
export type ChangeClass = "none" | "small" | "big" | "huge" | "toxic";
const CHANGE_ORDER: Record<ChangeClass, number> = { none: 0, small: 1, big: 2, huge: 3, toxic: 4 };

/** What a plan lets an observer learn: the facts Privacy first compares, in tier order. */
export interface PlanFacts {
  /** a. Hard rule violations, distinct, in VIOLATIONS order */
  violations: ViolationId[];
  /** b. The recipient already knows every input */
  known: boolean;
  /** d. New certain links (clusters joined that nothing linked before) */
  links: number;
  /** d. Those links are known to one label observer already, or join CoinJoin outputs only */
  softLinks: boolean;
  /** c. Change class (compared with the 3-group guard, changeRank) */
  change: ChangeClass;
  /** e. Rules that would point at the change: round payment amount, address type */
  detectable: ("round" | "type")[];
  /** f. Probable links confirmed (clusters an observer could already guess were linked) */
  probable: number;
  /** g. Inputs */
  inputs: number;
  /** h. Fee in sats, absorbed leftover included */
  fee: number;
}

/**
 * One tier of the Privacy-first order, as checked for one plan: ok true
 * (passes), false (a warning) or null (information only).
 */
export type DecisionStepId =
  | "rules-ok" | "violation"
  | "known-used" | "known-partial" | "known-unused"
  | "links-none" | "links" | "links-soft"
  | "change-none" | "change-absorbed" | "change-small" | "change-big" | "change-toxic" | "change-huge"
  | "detect-none" | "detect-round" | "detect-type"
  | "probable";

export interface DecisionStep {
  tier: "a" | "b" | "c" | "d" | "e" | "f";
  id: DecisionStepId;
  /** true passed, false warning, null neutral (information only) */
  ok: boolean | null;
  /** Count shown in the text (links, coins) */
  n?: number;
  /** Sats shown in the text */
  amount?: number;
  /** Change-to-payment ratio */
  ratio?: number;
  /** Violation (violation step) */
  violation?: ViolationId;
}

export interface CoinSelectionPlan {
  strategy: PlanStrategy;
  /** Shown only because no plan without a CoinJoin violation pays */
  fallback: boolean;
  facts: PlanFacts;
  selected: SelectedCoin[];
  inputTotal: number;
  paymentAmount: number;
  /** Fee in sats; includes any leftover absorbed when there is no change */
  fee: number;
  /** Change in sats, 0 when changeless */
  change: number;
  /** Changeless only: leftover sats added to the fee instead of a change output */
  absorbed: number;
  /** The no-change variant of a plan whose change was at most the max extra fee: `absorbed` is that change, paid to miners */
  absorbsChange: boolean;
  /** Distinct certain linkage clusters among the selected coins */
  origins: number;
  /** Distinct groups after merging: inferred clusters, with sibling outputs of one tx kept apart (at most `origins`) */
  groups: number;
  warnings: PlanWarning[];
  /** Label rules that apply to the selected coins, and whether the plan respects each */
  labelRules: { id: LabelRuleId; ok: boolean }[];
  /** The Privacy-first tiers for this plan, in order */
  path: DecisionStep[];
}

/**
 * Context: `known` are the outpoints the recipient already knows
 * (spending-advice.recipientHistory), `recipientType` the recipient address
 * type (getAddressType) when given.
 */
export interface SpendContext {
  known?: ReadonlySet<string>;
  recipientType?: string;
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

const EMPTY: ReadonlySet<string> = new Set();

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
function fewestCoins(cands: Candidate[], amount: number, feeRate: number, budget: { left: number }, maxK = Infinity): Candidate[][] {
  // Smallest k whose k largest coins can pay.
  let k = 0;
  for (let i = 0, sum = 0, vb = 0; i < cands.length; i++) {
    sum += cands[i]!.value;
    vb += cands[i]!.vb;
    if (settle(sum, vb, amount, feeRate)) { k = i + 1; break; }
  }
  if (k === 0 || k > maxK) return [];

  const suffix = new Array<number>(cands.length + 1).fill(0);
  for (let i = cands.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + cands[i]!.value;
  const minFee = Math.ceil((k * INPUT_VB.p2tr + BASE_VB + OUTPUT_VB) * feeRate);

  /** The ALTERNATIVES best leaves, best first */
  const best: { key: RankKey; set: Candidate[] }[] = [];
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
      if (best.length < ALTERNATIVES || better(key, best.at(-1)!.key)) {
        let at = best.findIndex(b => better(key, b.key));
        if (at < 0) at = best.length;
        best.splice(at, 0, { key, set: chosen.map(i => cands[i]!) });
        if (best.length > ALTERNATIVES) best.pop();
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
  return best.map(b => b.set);
}

/**
 * Changeless set of 2 or 3 coins, in the spirit of Bitcoin Core's Branch and Bound:
 * coins whose effective values (value minus own input fee) sum within
 * [target, target + cost of change], where target is the amount plus the fee of a
 * 1-output tx and cost of change is one more output plus CHANGELESS_TOLERANCE
 * (the window in which settle() reports no change). Fewest inputs first, then
 * least fee; up to ALTERNATIVES sets. `budget.left` is shared and decremented.
 */
function changelessSets(cands: Candidate[], amount: number, feeRate: number, budget: { left: number }): Candidate[][] {
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
  const found: { set: Candidate[]; fee: number }[] = [];
  const consider = (idx: number[]) => {
    const set = idx.map(i => cs[i]!);
    // ev uses an unrounded fee; settle() has the final word.
    const s = settle(set.reduce((t, c) => t + c.value, 0), set.reduce((t, c) => t + c.vb, 0), amount, feeRate);
    if (s && s.change === 0) found.push({ set, fee: s.fee });
  };
  const best = () => found.sort((a, b) => a.fee - b.fee).slice(0, ALTERNATIVES).map(f => f.set);

  // Pairs: for each coin the smallest partner that reaches the target (least overpay).
  for (let i = 0; i < n - 1 && e[i]! + e[i + 1]! <= hi; i++) {
    if (budget.left-- <= 0) return best();
    const j = lb(lo - e[i]!, i + 1);
    if (j < n && e[i]! + e[j]! <= hi) consider([i, j]);
  }
  if (found.length > 0) return best();

  // ponytail: budgeted O(n^2 log n) triple scan; past the budget on huge wallets a triple may be missed.
  for (let i = 0; i < n - 2 && e[i]! + e[i + 1]! + e[i + 2]! <= hi; i++) {
    // Skip partners too small to reach the target even with the largest third coin.
    for (let j = Math.max(i + 1, lb(lo - e[i]! - e[n - 1]!, i + 1)); j < n - 1 && e[i]! + e[j]! + e[j + 1]! <= hi; j++) {
      if (budget.left-- <= 0) return best();
      const k = lb(lo - e[i]! - e[j]!, j + 1);
      if (k < n && e[i]! + e[j]! + e[k]! <= hi) consider([i, j, k]);
    }
  }
  return best();
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

/** Plans returned at most. */
export const MAX_PLANS = 8;
/** Sets kept per search (fewest coins, changeless): its best and the next best. */
const ALTERNATIVES = 3;
/**
 * When a single coin pays, sets of coins that cannot pay alone are searched
 * only up to this size: a set past it links too much to beat one coin.
 */
const MAX_SMALL_SET = 6;

/** Change at least this many times the payment is "huge" (tier d). */
const HUGE_CHANGE_RATIO = 10;

/** A single coin is "close" when what it leaves over the payment is at most this share of the payment (checklist). */
export const CLOSE_RATIO = 0.1;

/**
 * What a plan with `change` adds to the fee when its change goes to miners,
 * counted as `absorbed` is (above a 1-output tx's fee): the change plus the
 * change output it no longer pays for. The max extra fee is compared with this.
 */
export const absorbedIf = (change: number, feeRate: number) => change + Math.ceil(OUTPUT_VB * feeRate);

/** Default max extra fee to leave no change: change at or below it can go to miners instead (the tester's 5,000 sats). */
export const DEFAULT_MAX_ABSORB = 5_000;
/** Extra fee above this share of the payment gets a visible note. */
const EXTRA_FEE_NOTE = 0.1;

/**
 * A fee difference below this counts as none (tier h): max(1,000 sats, 1% of
 * the payment). A plan only that much cheaper earns no slot of its own.
 */
export const feeTolerance = (amount: number) => Math.max(1_000, Math.round(0.01 * amount));

interface LabelVerdict {
  rules: { id: LabelRuleId; ok: boolean }[];
  /** Distinct explicit origins not already certainly linked */
  origins: number;
  cj: number;
  /** The [CJ] rule is broken by coins that are not all mixed outputs on-chain */
  cjWarn: boolean;
}

/** Label rules for a set of coins; `cluster` is each coin's certain origin id. */
function labelVerdict(coins: readonly CoinSelectionInput[], cluster: readonly number[]): LabelVerdict {
  const has = (c: CoinSelectionInput, t: LabelTag) => c.labelTags?.includes(t) ?? false;
  const rules: { id: LabelRuleId; ok: boolean }[] = [];
  const kyc = coins.some(c => has(c, "kyc")), nokyc = coins.some(c => has(c, "nokyc"));
  if (kyc || nokyc) rules.push({ id: "kyc", ok: !(kyc && nokyc) });
  const cj = coins.filter(c => has(c, "cj")).length;
  // A merge whose [CJ] coins are all mixed outputs on-chain is covered by the on-chain CoinJoin warning.
  let cjWarn = false;
  if (cj > 0) {
    const ok = coins.length === 1;
    rules.push({ id: "coinjoin", ok });
    cjWarn = !ok && !coins.every(c => !has(c, "cj") || c.origin === "mixed");
  }
  // Origins: keys sharing a certain cluster count once (already linked on-chain).
  const parent = new Map<string, string>();
  const find = (k: string): string => { const p = parent.get(k); return p === undefined || p === k ? k : find(p); };
  const byCluster = new Map<number, string>();
  coins.forEach((c, i) => {
    for (const k of c.labelOrigins ?? []) {
      if (!parent.has(k)) parent.set(k, k);
      const first = byCluster.get(cluster[i]!);
      if (first === undefined) byCluster.set(cluster[i]!, k);
      else parent.set(find(k), find(first));
    }
  });
  const origins = new Set([...parent.keys()].map(find)).size;
  if (origins > 0) rules.push({ id: "origin", ok: origins === 1 });
  if (coins.some(c => has(c, "toxic"))) rules.push({ id: "toxic", ok: coins.length === 1 });
  return { rules, origins, cj, cjWarn };
}

/** The observer (else platform) every coin's label shares, when all coins share one; mixed outputs never count. */
function sharedObserver(coins: readonly CoinSelectionInput[]): string | undefined {
  if (coins.length < 2 || coins.some(c => c.origin === "mixed")) return undefined;
  for (const f of ["labelObserver", "labelPlatform"] as const) {
    const v = coins[0]![f]?.trim();
    if (v && coins.every(c => c[f]?.trim().toLowerCase() === v.toLowerCase())) return v;
  }
  return undefined;
}

/** A change coin (wallet-behavior isChangeClass: change, self-transfer output, CoinJoin change). Same definition as W2. */
const isChangeCoin = (c: CoinSelectionInput) => isChangeClass(c.origin);

/**
 * Links between sibling outputs of one tx the wallet built (change or self-transfer outputs): per txid,
 * distinct certain origins among the picked coins, minus one. Outputs of someone else's tx (a CoinJoin,
 * a batch payout) are not siblings in this sense: they reveal no payment to yourself.
 */
function siblingLinks(picked: readonly Candidate[], by: (c: Candidate) => number = c => c.group): number {
  const byTx = new Map<string, Set<number>>();
  for (const c of picked) {
    if (!isChangeCoin(c.coin)) continue;
    const g = byTx.get(c.coin.utxo.txid);
    if (g) g.add(by(c));
    else byTx.set(c.coin.utxo.txid, new Set([by(c)]));
  }
  let n = 0;
  for (const g of byTx.values()) n += g.size - 1;
  return n;
}

interface Scored {
  picked: Candidate[];
  fee: number;
  change: number;
  origins: number;
  groups: number;
  facts: PlanFacts;
  /** Merges a mixed output with unmixed coins, or a mixed output leaves change at least the payment */
  severe: boolean;
  /** Merges only CoinJoin outputs (rule 9) */
  mixedOnly: boolean;
  labels: LabelVerdict;
  absorbs: boolean;
  /** New links between sibling outputs of one transaction (counted in `groups`) */
  siblings: number;
  /** 1-based row (largest first) of the first change coin in a change merge */
  changeRow: number;
}

/** What tier e knows about the payment: round amount, and whether the recipient's address type differs from the change's. */
interface DetectContext { round: boolean; recipientType?: string }

/**
 * Score a set: its facts. `absorbMax` > 0: the no-change variant instead, only
 * when the set leaves change of at most `absorbMax` (the change goes to the fee).
 */
function score(picked: Candidate[], amount: number, feeRate: number, absorbMax: number, knownSet: ReadonlySet<string>, detect: DetectContext): Scored | null {
  let s = settle(picked.reduce((t, c) => t + c.value, 0), picked.reduce((t, c) => t + c.vb, 0), amount, feeRate);
  if (!s) return null;
  const absorbs = absorbMax > 0;
  if (absorbs) {
    if (s.change === 0 || absorbedIf(s.change, feeRate) > absorbMax) return null;
    s = { fee: s.fee + s.change, change: 0 };
  }
  const coins = picked.map(c => c.coin);
  const origins = new Set(picked.map(c => c.group)).size;
  // Sibling outputs of one transaction (ruling): spending them together shows both were the wallet's,
  // so that payment was to the wallet itself: the same-tx violation, counted once (not also as a
  // probable link, nor as a change merge, which describe the same coin pair).
  const siblings = siblingLinks(picked);
  /** Sibling links between different inferred groups (the rest sit inside one inferred group) */
  const looseSiblings = siblingLinks(picked, c => c.loose);
  // Groups after the merge; siblings count once, as the same-tx violation, not as separate groups.
  const groups = new Set(picked.map(c => c.loose)).size - looseSiblings;
  const mixedCount = coins.filter(c => c.origin === "mixed").length;
  const mixed = mixedCount > 0;
  const mixedOnly = picked.length > 1 && mixedCount === picked.length;
  const fromCoinJoin = mixed || coins.some(c => c.origin === "coinjoin-change");
  const labels = labelVerdict(coins, picked.map(c => c.group));
  const broken = (id: LabelRuleId) => labels.rules.some(r => r.id === id && !r.ok);

  const violations: ViolationId[] = [];
  if (broken("kyc")) violations.push("kyc");
  if (labels.cjWarn || (mixed && !mixedOnly && picked.length > 1)) violations.push("coinjoin");
  // Change merged with coins it is not already linked to on-chain (same certain cluster) and that are
  // not its own siblings (same-tx, below). CoinJoin change is change: no second "toxic" count for it.
  const sorted = [...picked].sort((a, b) => b.value - a.value);
  const changeRow = sorted.findIndex(c => isChangeCoin(c.coin) && sorted.some(o => o !== c && o.group !== c.group && o.coin.utxo.txid !== c.coin.utxo.txid)) + 1;
  if (changeRow > 0) violations.push("change-merge");
  if (siblings > 0) violations.push("same-tx");
  if (broken("toxic")) violations.push("toxic");

  const toxic = s.change > 0 && (s.change < TOXIC_CHANGE_THRESHOLD || fromCoinJoin);
  const change: ChangeClass = s.change === 0 ? "none" : toxic ? "toxic"
    : s.change >= HUGE_CHANGE_RATIO * amount ? "huge" : s.change > amount ? "big" : "small";
  const detectable: PlanFacts["detectable"] = [];
  if (s.change > 0) {
    if (detect.round && !isRoundAmount(s.change)) detectable.push("round");
    if (detect.recipientType && detect.recipientType !== "unknown" && detect.recipientType !== getAddressType(sorted[0]!.coin.address)) detectable.push("type");
  }
  const facts: PlanFacts = {
    violations,
    known: knownSet.size > 0 && coins.every(c => knownSet.has(outpointOf(c))),
    // Siblings in different inferred groups (no inferred cluster joined them) are counted by same-tx, not here.
    links: groups - 1,
    softLinks: groups > 1 && (mixedOnly || sharedObserver(coins) !== undefined),
    change,
    detectable,
    probable: origins - groups - siblings,
    inputs: picked.length,
    fee: s.fee,
  };
  const severe = mixed && ((picked.length > 1 && !mixedOnly) || s.change >= amount);
  return { picked, ...s, origins, groups, facts, severe, mixedOnly, labels, absorbs, siblings, changeRow };
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

/**
 * Sets of up to `maxK` coins with the least change (rules 2 and 4: a small-change
 * consolidation), up to ALTERNATIVES, least change first. Budgeted branch and bound
 * over `small` sorted descending: a branch stops once it pays (more coins only add
 * change) or once its sum is past the best overpay found.
 */
function leastChangeSets(small: Candidate[], amount: number, feeRate: number, budget: { left: number }, maxK: number): Candidate[][] {
  const suffix = new Array<number>(small.length + 1).fill(0);
  for (let i = small.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1]! + small[i]!.value;
  const best: { over: number; set: Candidate[] }[] = [];
  const chosen: Candidate[] = [];
  const worst = () => (best.length < ALTERNATIVES ? Infinity : best.at(-1)!.over);
  function dfs(index: number, sum: number, vb: number): void {
    if (budget.left-- <= 0) return;
    if (chosen.length > 0 && settle(sum, vb, amount, feeRate)) {
      const over = sum - amount;
      if (over < worst()) {
        best.push({ over, set: [...chosen] });
        best.sort((a, b) => a.over - b.over);
        if (best.length > ALTERNATIVES) best.pop();
      }
      return;
    }
    if (chosen.length >= maxK || sum + suffix[index]! < amount || sum - amount >= worst()) return;
    for (let i = index; i < small.length; i++) {
      if (sum + small[i]!.value - amount >= worst()) continue;
      chosen.push(small[i]!);
      dfs(i + 1, sum + small[i]!.value, vb + small[i]!.vb);
      chosen.pop();
      if (budget.left <= 0) return;
    }
  }
  dfs(0, 0, 0);
  return best.map(b => b.set);
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

// ---------- Plans ----------

/** Selector inputs as search candidates (largest first), leaving out dust and uneconomical coins unless `keep`. */
function candidatesOf(utxos: CoinSelectionInput[], feeRate: number, keep?: ReadonlySet<string>): { cands: Candidate[] } & Excluded {
  const kept = (c: CoinSelectionInput) => keep?.has(outpointOf(c)) ?? false;
  const notDust = utxos.filter(u => u.utxo.value >= P2PKH_DUST_LIMIT || kept(u));
  const vbOf = (c: CoinSelectionInput) => INPUT_VB[scriptType(c.address)];
  const usable = notDust.filter(c => c.utxo.value > vbOf(c) * feeRate || kept(c));
  const group = originIds(usable, false);
  const loose = originIds(usable, true);
  const cands = usable
    .map((coin, i) => ({ coin, group: group[i]!, loose: loose[i]!, value: coin.utxo.value, vb: vbOf(coin) }))
    .sort((a, b) => b.value - a.value);
  return { cands, dustExcluded: utxos.length - notDust.length, uneconomical: notDust.length - usable.length };
}

export const outpointOf = (c: CoinSelectionInput) => `${c.utxo.txid}:${c.utxo.vout}`;

/** New links a plan creates: `certain` joins of unrelated groups, `inferred` joins of coins only probably linked already. */
export const planLinks = (p: CoinSelectionPlan) => ({ certain: p.groups - 1, inferred: p.origins - p.groups });

/** How the plan list is ordered. Only the order changes; every plan keeps its warnings. */
export const PLAN_CRITERIA = ["privacy", "least-change", "no-change", "fewest-coins", "lowest-fee"] as const;
export type PlanCriterion = (typeof PLAN_CRITERIA)[number];

type Tier = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";

/** Tier c: the change class, a merge joining 3+ unrelated groups (2+ new links) counting as at least "big" (guard). */
const changeRank = (f: PlanFacts) => Math.max(CHANGE_ORDER[f.change], f.links >= 2 ? CHANGE_ORDER.big : 0);

/**
 * Tier h compares fees in steps of feeTolerance from the lowest fee among the
 * plans compared (`minFee`): a quantized fee keeps the order total (a raw
 * "difference below the tolerance counts as none" is not transitive).
 */
const feeStep = (p: CoinSelectionPlan, minFee: number) => Math.floor((p.facts.fee - minFee) / feeTolerance(p.paymentAmount));

/** Privacy first, step by step: the guide's order (see the module comment and the guide's "How plans are ranked"). */
const STEPS: [Tier, (a: CoinSelectionPlan, b: CoinSelectionPlan, minFee: number) => number][] = [
  ["a", (a, b) => a.facts.violations.length - b.facts.violations.length],
  ["b", (a, b) => Number(!a.facts.known) - Number(!b.facts.known)],
  ["c", (a, b) => changeRank(a.facts) - changeRank(b.facts)],
  ["d", (a, b) => a.facts.links - b.facts.links || Number(!a.facts.softLinks) - Number(!b.facts.softLinks)],
  ["e", (a, b) => a.facts.detectable.length - b.facts.detectable.length],
  ["f", (a, b) => a.facts.probable - b.facts.probable],
  ["g", (a, b) => a.facts.inputs - b.facts.inputs],
  // Fee in steps of the tolerance; then less change, then the coins (a total order).
  ["h", (a, b, minFee) => feeStep(a, minFee) - feeStep(b, minFee) || a.change - b.change || (coinsKey(a) < coinsKey(b) ? -1 : coinsKey(a) > coinsKey(b) ? 1 : 0)],
];

const coinsKey = (p: CoinSelectionPlan) => p.selected.map(outpointOf).sort().join() + (p.absorbsChange ? "+" : "");

/**
 * Privacy first: the first step at which two plans differ decides. `minFee` is
 * the lowest fee among the plans being ranked (rankPlans passes it); by default
 * the lower of the two.
 */
export function comparePrivacy(a: CoinSelectionPlan, b: CoinSelectionPlan, minFee = Math.min(a.facts.fee, b.facts.fee)): number {
  for (const [, cmp] of STEPS) { const d = cmp(a, b, minFee); if (d !== 0) return d; }
  return 0;
}

/** The step (tier) at which `a` ranks before `b`, or null when they tie. */
export function decidingTier(a: CoinSelectionPlan, b: CoinSelectionPlan, minFee = Math.min(a.facts.fee, b.facts.fee)): Tier | null {
  for (const [tier, cmp] of STEPS) if (cmp(a, b, minFee) !== 0) return tier;
  return null;
}

/** One thing a plan avoids that the other plan does (dilemma panel, "What it avoids"). */
export type AvoidItem =
  | { id: "violation"; violation: ViolationId }
  | { id: "recipient" | "no-links" | "no-change" | "undetectable" | "fewer-probable" }
  | { id: "fewer-links"; n: number }
  | { id: "fewer-inputs"; n: number; other: number }
  | { id: "less-change"; amount: number; other: number }
  | { id: "lower-fee"; amount: number; other: number };

/** What `plan` avoids that `other` does, step by step in the guide's order (each fact once). */
export function planAvoids(plan: CoinSelectionPlan, other: CoinSelectionPlan): AvoidItem[] {
  const f = plan.facts, o = other.facts;
  const out: AvoidItem[] = o.violations.filter(v => !f.violations.includes(v)).map(violation => ({ id: "violation" as const, violation }));
  if (f.known && !o.known) out.push({ id: "recipient" });
  if (f.links < o.links) out.push(f.links === 0 ? { id: "no-links" } : { id: "fewer-links", n: plan.groups });
  if (changeRank(f) < changeRank(o)) out.push(plan.change === 0 ? { id: "no-change" } : { id: "less-change", amount: plan.change, other: other.change });
  if (f.detectable.length < o.detectable.length) out.push({ id: "undetectable" });
  if (f.probable < o.probable) out.push({ id: "fewer-probable" });
  if (f.inputs < o.inputs) out.push({ id: "fewer-inputs", n: f.inputs, other: o.inputs });
  if (o.fee - f.fee >= feeTolerance(plan.paymentAmount)) out.push({ id: "lower-fee", amount: f.fee, other: o.fee });
  return out;
}

/** A significant leak: a hard rule violation, or huge change (10x the payment or more). */
export const significantLeak = (p: CoinSelectionPlan) => p.facts.violations.length > 0 || p.facts.change === "huge";

/**
 * No clean option: the top plan under Privacy first still leaks something
 * significant and the best alternative trades it for another significant leak.
 * Then no plan is "Recommended"; the two are shown side by side. Null otherwise.
 * `plans` must be in Privacy-first order.
 */
export function noCleanOption(plans: readonly CoinSelectionPlan[]): { first: CoinSelectionPlan; second: CoinSelectionPlan; tier: Tier | null } | null {
  const first = plans[0];
  if (!first || !significantLeak(first)) return null;
  // The best alternative with other coins: the same coins with and without change are one option.
  const coins = (p: CoinSelectionPlan) => p.selected.map(outpointOf).sort().join();
  const second = plans.find(p => coins(p) !== coins(first));
  if (!second || !significantLeak(second)) return null;
  return { first, second, tier: decidingTier(first, second) };
}

type Order = (a: CoinSelectionPlan, b: CoinSelectionPlan, minFee: number) => number;
const CRITERION_ORDER: Record<PlanCriterion, Order> = {
  privacy: comparePrivacy,
  "least-change": (a, b, m) => a.change - b.change || comparePrivacy(a, b, m),
  // Changeless plans first, each side by privacy (unlike least change, the rest is not ordered by change)
  "no-change": (a, b, m) => Number(a.change > 0) - Number(b.change > 0) || comparePrivacy(a, b, m),
  "fewest-coins": (a, b, m) => a.selected.length - b.selected.length || comparePrivacy(a, b, m),
  "lowest-fee": (a, b, m) => a.fee - b.fee || comparePrivacy(a, b, m),
};

/** The plans ordered by a criterion, best first (a new array). */
export function rankPlans<P extends CoinSelectionPlan>(plans: readonly P[], criterion: PlanCriterion): P[] {
  const minFee = Math.min(...plans.map(p => p.facts.fee));
  const order = CRITERION_ORDER[criterion];
  return [...plans].sort((a, b) => order(a, b, minFee));
}

/** The facts as numbers, lower is better, in tier order; the fee (index FEE) compares with a tolerance; then change. */
const dims = (p: CoinSelectionPlan) => {
  const f = p.facts;
  return [f.violations.length, Number(!f.known), changeRank(f), f.links, Number(!f.softLinks), f.detectable.length, f.probable, f.inputs, f.fee, p.change];
};
const FEE = 8;

/**
 * Pareto pruning over the facts: drops a plan when another is at least as good
 * on every one (a fee within feeTolerance counting as equal) and strictly
 * better on one. Keeps the input order.
 */
function pareto(plans: CoinSelectionPlan[], tolerance: number): CoinSelectionPlan[] {
  const d = plans.map(dims);
  const le = (o: number[], i: number[], k: number) => (k === FEE ? o[k]! <= i[k]! + tolerance : o[k]! <= i[k]!);
  // ponytail: O(n^2) over the scored sets (a few hundred at most on a 1000-coin wallet).
  return plans.filter((_, i) => !d.some((o, j) => j !== i && o.every((_, k) => le(o, d[i]!, k)) && o.some((v, k) => v < d[i]![k]!)));
}

export type SelectionEvaluation =
  | { kind: "plan"; plan: CoinSelectionPlan }
  | { kind: "insufficient"; total: number; shortfall: number }
  | { kind: "invalid" };

/**
 * Evaluate coins the user picked by hand, with the same facts and plan
 * building as the advisor. Origins are resolved over the whole wallet (as the
 * advisor does), so a set the advisor suggested evaluates to the same plan.
 * Dust and uneconomical coins count when picked.
 */
export function evaluateSelection(
  utxos: CoinSelectionInput[],
  outpoints: ReadonlySet<string>,
  paymentAmount: number,
  feeRate: number,
  { maxAbsorb = DEFAULT_MAX_ABSORB, absorb = false, includeFrozen = false, known = EMPTY, recipientType }: { maxAbsorb?: number; absorb?: boolean; includeFrozen?: boolean } & SpendContext = {},
): SelectionEvaluation {
  if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 || !Number.isFinite(feeRate) || feeRate <= 0) return { kind: "invalid" };
  // The advisor's coin set (frozen coins left out unless included), plus the picked coins themselves.
  const pool = includeFrozen ? utxos : utxos.filter(u => !u.frozen || outpoints.has(outpointOf(u)));
  const all = candidatesOf(pool, feeRate, outpoints).cands;
  const picked = all.filter(c => outpoints.has(outpointOf(c.coin)));
  if (picked.length === 0) return { kind: "invalid" };
  const detect = { round: isRoundAmount(paymentAmount), ...(recipientType ? { recipientType } : {}) };
  const x = score(picked, paymentAmount, feeRate, 0, known, detect);
  if (!x) {
    const total = picked.reduce((s, c) => s + c.value, 0);
    const fee = Math.ceil((picked.reduce((s, c) => s + c.vb, 0) + BASE_VB + OUTPUT_VB) * feeRate);
    return { kind: "insufficient", total, shortfall: paymentAmount + fee - total };
  }
  // Absorb asked and possible (change at most maxAbsorb): the no-change variant.
  const v = absorb ? score(picked, paymentAmount, feeRate, maxAbsorb, known, detect) : null;
  return { kind: "plan", plan: buildPlan(v ?? x, paymentAmount, feeRate, false, maxAbsorb, known) };
}

const strategyOf = (x: Scored): PlanStrategy =>
  x.picked.length === 1 ? "single-coin"
  : x.change === 0 ? "no-change"
  : x.origins === 1 ? "same-origin"
  : x.groups === 1 && x.siblings === 0 ? "probably-linked"
  : "multi-coin";

/** The Privacy-first tiers a-f for a plan, each passed, warned or informational (g, h: the inputs and fee figures). */
function decisionPath(x: Scored, change: number, absorbed: number, amount: number, known: ReadonlySet<string>): DecisionStep[] {
  const f = x.facts;
  const steps: DecisionStep[] = f.violations.length === 0
    ? [{ tier: "a", id: "rules-ok", ok: true }]
    : f.violations.map(v => ({ tier: "a" as const, id: "violation" as const, ok: false, violation: v }));
  if (known.size > 0) {
    const k = x.picked.filter(c => known.has(outpointOf(c.coin))).length;
    steps.push(f.known ? { tier: "b", id: "known-used", ok: true }
      : k > 0 ? { tier: "b", id: "known-partial", ok: false, n: k }
      : { tier: "b", id: "known-unused", ok: false, n: known.size });
  }
  const ratio = Math.round((change / amount) * 100) / 100;
  steps.push(
    f.change === "none" ? (x.absorbs ? { tier: "c", id: "change-absorbed", ok: true, amount: absorbed } : { tier: "c", id: "change-none", ok: true })
    : f.change === "small" ? { tier: "c", id: "change-small", ok: null, amount: change, ratio }
    : { tier: "c", id: f.change === "huge" ? "change-huge" : f.change === "toxic" ? "change-toxic" : "change-big", ok: false, amount: change, ratio },
  );
  steps.push(f.links === 0 ? { tier: "d", id: "links-none", ok: true }
    : { tier: "d", id: f.softLinks ? "links-soft" : "links", ok: false, n: x.groups });
  if (change > 0) {
    if (f.detectable.length === 0) steps.push({ tier: "e", id: "detect-none", ok: true });
    for (const d of f.detectable) steps.push({ tier: "e", id: d === "round" ? "detect-round" : "detect-type", ok: false });
  }
  if (f.probable > 0) steps.push({ tier: "f", id: "probable", ok: null, n: f.probable });
  return steps;
}

function buildPlan(x: Scored, amount: number, feeRate: number, fallback: boolean, maxAbsorb: number, known: ReadonlySet<string>): CoinSelectionPlan {
  // Largest first, so one set reads the same whichever search found it.
  const coins = [...x.picked].sort((a, b) => b.value - a.value).map(c => c.coin);
  const inputTotal = x.picked.reduce((s, c) => s + c.value, 0);
  const inVb = x.picked.reduce((s, c) => s + c.vb, 0);
  const { fee, change, origins, groups } = x;
  const absorbed = change === 0 ? fee - Math.ceil((inVb + BASE_VB + OUTPUT_VB) * feeRate) : 0;
  const warnings: PlanWarning[] = [];

  // The spend-change-on-its-own rule first: it outranks everything but the label rules, which unshift below.
  if (x.changeRow > 0) warnings.push({ id: "change-merge", severity: "high", count: x.changeRow });
  if (x.siblings > 0) warnings.push({ id: "same-tx", severity: "high", count: x.siblings + 1 });
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
  if (x.absorbs && absorbed > EXTRA_FEE_NOTE * amount) warnings.push({ id: "extra-fee", severity: "low", count: Math.round((absorbed / amount) * 100) });
  const scripts = new Set(coins.map(c => scriptType(c.address))).size;
  if (scripts > 1) warnings.push({ id: "mixed-scripts", severity: "low", count: scripts });
  for (const r of x.labels.rules) {
    if (r.ok) continue;
    if (r.id === "kyc") warnings.unshift({ id: "label-kyc", severity: "critical", count: coins.length });
    else if (r.id === "coinjoin") { if (x.labels.cjWarn) warnings.push({ id: "label-coinjoin", severity: "high", count: x.labels.cj }); }
    else if (r.id === "origin") warnings.push({ id: "label-origins", severity: "medium", count: x.labels.origins });
    else warnings.push({ id: "label-toxic", severity: "medium", count: coins.length });
  }

  return {
    strategy: strategyOf(x), fallback, facts: x.facts,
    selected: withHints(coins), inputTotal, paymentAmount: amount, fee, change, absorbed, absorbsChange: x.absorbs, origins, groups, warnings,
    labelRules: x.labels.rules,
    path: decisionPath(x, change, absorbed, amount, known),
  };
}

/**
 * Recommend which coins to spend for a payment.
 *
 * @param utxos - Wallet UTXOs with address and origin info
 * @param paymentAmount - Payment amount in sats
 * @param feeRate - Fee rate in sat/vB
 * @param maxAbsorb - Max extra fee to leave no change: a plan with change up to this also comes as a no-change variant
 * @param ctx - Coins the recipient already knows (tier b), searched on their own too; the recipient's address type (tier e)
 */
export function adviseCoinSelection(
  utxos: CoinSelectionInput[],
  paymentAmount: number,
  feeRate = 5,
  maxAbsorb = DEFAULT_MAX_ABSORB,
  { known = EMPTY, recipientType }: SpendContext = {},
): CoinSelectionAdvice {
  if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 || !Number.isFinite(feeRate) || feeRate <= 0) {
    return { kind: "invalid" };
  }

  const { cands, ...excluded } = candidatesOf(utxos, feeRate);
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
  sets.push(...changelessSets(cands, paymentAmount, feeRate, budget));
  for (const g of groupBy(cands)) if (g.length > 1) sets.push(...changelessSets(g, paymentAmount, feeRate, groupBudget));
  // Coins that are not change, on their own: the sets that respect "spend change on its own".
  const plain = cands.filter(c => !isChangeCoin(c.coin));
  if (plain.length > 1 && plain.length < cands.length) sets.push(...changelessSets(plain, paymentAmount, feeRate, { left: MAX_ITERATIONS }));
  const plainSmall = small.filter(c => !isChangeCoin(c.coin));
  if (pays(small)) {
    // No single coin: the first DFS leaf is the top-k set, so a result always exists.
    const maxK = singles.length > 0 ? MAX_SMALL_SET : Infinity;
    sets.push(...fewestCoins(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }, maxK));
    sets.push(smallestFirst(small, paymentAmount, feeRate));
    sets.push(...smallestPartners(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }));
    sets.push(...leastChangeSets(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }, Math.min(maxK, MAX_SMALL_SET)));
    const sameBudget = { left: MAX_ITERATIONS };
    for (const g of groupBy(small)) if (g.length > 1 && pays(g)) sets.push(...fewestCoins(g, paymentAmount, feeRate, sameBudget, maxK));
  }
  if (plainSmall.length > 1 && plainSmall.length < small.length && pays(plainSmall)) {
    const maxK = singles.length > 0 ? MAX_SMALL_SET : Infinity;
    sets.push(...fewestCoins(plainSmall, paymentAmount, feeRate, { left: MAX_ITERATIONS }, maxK));
    sets.push(...leastChangeSets(plainSmall, paymentAmount, feeRate, { left: MAX_ITERATIONS }, Math.min(maxK, MAX_SMALL_SET)));
  }
  // Tier b: the coins the recipient already knows, on their own (singles are already in).
  const knownCands = cands.filter(c => known.has(outpointOf(c.coin)));
  if (knownCands.length > 1 && pays(knownCands)) {
    const knownBudget = { left: MAX_ITERATIONS };
    sets.push(...changelessSets(knownCands, paymentAmount, feeRate, knownBudget));
    sets.push(...fewestCoins(knownCands.filter(c => !pays([c])), paymentAmount, feeRate, knownBudget, MAX_SMALL_SET));
  }

  const detect = { round: isRoundAmount(paymentAmount), ...(recipientType ? { recipientType } : {}) };
  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (const set of sets) {
    if (!set) continue;
    const id = set.map(c => outpointOf(c.coin)).sort().join();
    if (seen.has(id)) continue;
    seen.add(id);
    const x = score(set, paymentAmount, feeRate, 0, known, detect);
    // Small change: also the same coins with the change paid to miners. Toxic change with that
    // twin is not kept: the twin is the same coins without a change output nobody should create.
    const v = maxAbsorb > 0 ? score(set, paymentAmount, feeRate, maxAbsorb, known, detect) : null;
    if (x && !(v && x.change < TOXIC_CHANGE_THRESHOLD)) scored.push(x);
    if (v) scored.push(v);
  }

  // Severe plans only when nothing else pays. A merge of only CoinJoin outputs (rule 9) is the
  // least-bad merge when a merge is needed, never when one coin pays alone.
  const avoidable = scored.some(x => x.picked.length === 1 && !x.severe);
  const safe = scored.filter(x => !x.severe && !(x.mixedOnly && avoidable));
  const fallback = safe.length === 0;
  const front = pareto(rankPlans((fallback ? scored : safe).map(x => buildPlan(x, paymentAmount, feeRate, fallback, maxAbsorb, known)), "privacy"), feeTolerance(paymentAmount));
  // Each criterion's best plan is kept, then the rest in Privacy-first order, up to MAX_PLANS.
  const keep = new Set(PLAN_CRITERIA.map(c => rankPlans(front, c)[0]!));
  for (const p of front) if (keep.size < MAX_PLANS) keep.add(p);
  const plans = front.filter(p => keep.has(p));

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

/**
 * Linkage-group letters for the UTXO list and exported labels. Coins are
 * lettered by value (largest first); each inferred cluster of 2+ coins gets a
 * letter, `inferred` when it spans several certain clusters (only probably
 * linked). One group for the whole wallet is reported as `allLinked` and gets
 * no letters.
 */
export function groupLetters(coins: readonly CoinSelectionInput[]): {
  letters: Map<string, { letter: string; inferred: boolean }>;
  allLinked: "certain" | "inferred" | null;
} {
  const op = outpointOf;
  const sorted = [...coins].sort((a, b) => b.utxo.value - a.utxo.value);
  const groupOf = (c: CoinSelectionInput) => c.group ?? op(c);
  const members = new Map<string, CoinSelectionInput[]>();
  for (const c of sorted) {
    const m = members.get(groupOf(c));
    if (m) m.push(c);
    else members.set(groupOf(c), [c]);
  }
  const certainOne = (m: CoinSelectionInput[]) => new Set(m.map(c => c.cluster)).size === 1;
  const letters = new Map<string, { letter: string; inferred: boolean }>();
  if (sorted.length > 1 && members.size === 1) {
    return { letters, allLinked: certainOne(sorted) ? "certain" : "inferred" };
  }
  let i = 0;
  for (const m of members.values()) {
    if (m.length < 2) continue;
    const letter = i < 26 ? String.fromCharCode(65 + i) : String(i + 1);
    for (const c of m) letters.set(op(c), { letter, inferred: !certainOne(m) });
    i++;
  }
  return { letters, allLinked: null };
}
