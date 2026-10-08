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
 *   pays with it; the smallest coins added up; the fewest coins; and the
 *   fewest coins within each linkage cluster.
 *
 * Ranked by privacy cost (COST), then inputs, then fee, then change. The
 * searches keep their next-best sets too; Pareto pruning drops a plan that
 * another beats on cost, fee, change and new links, and up to MAX_PLANS plans
 * are returned: the best under each ranking criterion (rankPlans), then the
 * rest by privacy cost. A plan that merges CoinJoin outputs with unmixed coins,
 * or a mixed output leaving change at least the payment, is shown only when
 * no other set pays. Merging only CoinJoin outputs (checklist rule 9) keeps
 * its high-severity warning and is never shown when one coin pays alone;
 * when a merge is needed it is the least-bad one: each such link costs a
 * little less than one between coins with history.
 *
 * Spending checklist (guide, "Spending checklist"): coins the recipient
 * already knows rank up (rule 1), coins one label observer already knows
 * merge at half a link (rule 5), a merge with small change beats one coin
 * with change 10x the payment (rule 4, bigChangeCost), and each plan carries
 * its decision path.
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
  | "coinjoin-mix" | "coinjoin-merge" | "mixed-change" | "coinjoin-change" | "merges-origins" | "toxic-change" | "mixed-scripts"
  | "absorb-change" | "extra-fee"
  | "label-kyc" | "label-coinjoin" | "label-origins" | "label-toxic";

/**
 * The labeling convention's spending rules (guide, "Labeling recommendations"):
 * kyc (1) never merge [KYC] with [noKYC]; coinjoin (2) spend [CJ] coins one by
 * one; origin (3) merge only coins of one origin or already linked on-chain;
 * toxic (5) never merge a [toxic] coin. Rule 4 (change inherits its parent's
 * origin) is applied when labels are resolved.
 */
export type LabelRuleId = "kyc" | "coinjoin" | "origin" | "toxic";

export interface PlanWarning {
  id: PlanWarningId;
  severity: Severity;
  /** Number shown in the message (coins, origins, change sats, script types) */
  count: number;
}

export type PlanStrategy = "single-coin" | "no-change" | "same-origin" | "probably-linked" | "multi-coin";

/** Why a plan ranks where it does, in one line. */
export type PlanReason = "fallback" | "recipient-knows" | "links" | "inferred-links" | "bad-change" | "big-change" | "clean" | "small-change";

/**
 * One step of the spending decision tree (guide, "Spending checklist"), as
 * checked for one plan: the checklist rule it comes from and whether the
 * plan passes it. Rules 6-8 are about the recipient and the amount, not the
 * coins: they are alerts (spending-advice.ts), not steps.
 */
export type DecisionStepId =
  | "known-used" | "known-partial" | "known-unused"
  | "close-single" | "far-single" | "no-close-single" | "close-single-skipped"
  | "no-change" | "change-left"
  | "merge-no-change" | "merge-absorbed" | "merge-small-change" | "merge-big-change" | "huge-change"
  | "already-linked" | "same-observer" | "new-links"
  | "coinjoin-only" | "coinjoin-mixed";

export interface DecisionStep {
  rule: 1 | 2 | 3 | 4 | 5 | 9;
  id: DecisionStepId;
  ok: boolean;
  /** Count shown in the text (coins, origins, change-to-payment ratio) */
  n?: number;
  /** Sats shown in the text */
  amount?: number;
  /** Observer or platform name (same-observer) */
  name?: string;
}

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
  /** Changeless only: leftover sats added to the fee instead of a change output */
  absorbed: number;
  /** The no-change variant of a plan whose change was at most the max extra fee: `absorbed` is that change, paid to miners */
  absorbsChange: boolean;
  /** Distinct certain linkage clusters among the selected coins */
  origins: number;
  /** Distinct inferred linkage clusters (at most `origins`) */
  groups: number;
  warnings: PlanWarning[];
  /** Label rules that apply to the selected coins, and whether the plan respects each */
  labelRules: { id: LabelRuleId; ok: boolean }[];
  /** The decision tree's steps for this plan, in order */
  path: DecisionStep[];
}

/**
 * Context for the decision tree: `known` are the outpoints the recipient
 * already knows (spending-advice.knownToRecipient); empty when no recipient
 * is given or it knows none of the coins.
 */
export interface SpendContext {
  known?: ReadonlySet<string>;
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

/** Change at least this many times the payment counts as "much larger". */
const BIG_CHANGE_RATIO = 3;
/** Plans returned at most. */
export const MAX_PLANS = 8;
/** Sets kept per search (fewest coins, changeless): its best and the next best. */
const ALTERNATIVES = 3;
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
 * from 3x it costs bigChange, from 10x bigChange + half a link (rule 4). The ratios keep the earlier rulings: a changeless
 * merge of 2 origins beats a single coin whose change is toxic or 3x the
 * payment, never one with ordinary change, and never a merge of 3 origins.
 * coinjoinLink: a link between CoinJoin outputs only (rule 9). known: the
 * bonus for a plan of only coins the recipient already knows (rule 1).
 */
const COST = { link: 12, change: 4, badChange: 10, bigChange: 9, coinjoinMerge: 40, extraFee: 12, coinjoinLink: 11, known: 12 } as const;

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
 * Label rule costs, on top of the on-chain costs: [KYC] with [noKYC] ties an
 * identity to coins kept away from it (as bad as undoing a CoinJoin); [CJ]
 * with other coins, or several [CJ] coins, undoes the mix the label claims;
 * a [toxic] coin merged spreads its taint; each extra explicit origin not
 * already certainly linked costs half a link (the on-chain link is counted
 * separately).
 */
const LABEL_COST = { kyc: 40, coinjoin: 30, toxic: COST.badChange, origin: COST.link / 2 } as const;

interface LabelVerdict {
  rules: { id: LabelRuleId; ok: boolean }[];
  cost: number;
  /** Distinct explicit origins not already certainly linked */
  origins: number;
  cj: number;
  /** The [CJ] rule is broken and not already covered by the on-chain CoinJoin penalty */
  cjWarn: boolean;
}

/** Label rules for a set of coins; `cluster` is each coin's certain origin id. */
function labelVerdict(coins: readonly CoinSelectionInput[], cluster: readonly number[]): LabelVerdict {
  const has = (c: CoinSelectionInput, t: LabelTag) => c.labelTags?.includes(t) ?? false;
  const rules: { id: LabelRuleId; ok: boolean }[] = [];
  let cost = 0;
  const kyc = coins.some(c => has(c, "kyc")), nokyc = coins.some(c => has(c, "nokyc"));
  if (kyc || nokyc) {
    rules.push({ id: "kyc", ok: !(kyc && nokyc) });
    if (kyc && nokyc) cost += LABEL_COST.kyc;
  }
  const cj = coins.filter(c => has(c, "cj")).length;
  // The on-chain CoinJoin merge cost (COST.coinjoinMerge) already covers a merge whose [CJ] coins
  // are all mixed outputs on-chain: no second penalty, no second warning.
  let cjWarn = false;
  if (cj > 0) {
    const ok = coins.length === 1;
    rules.push({ id: "coinjoin", ok });
    cjWarn = !ok && !coins.every(c => !has(c, "cj") || c.origin === "mixed");
    if (cjWarn) cost += LABEL_COST.coinjoin;
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
  if (origins > 0) {
    rules.push({ id: "origin", ok: origins === 1 });
    cost += (origins - 1) * LABEL_COST.origin;
  }
  if (coins.some(c => has(c, "toxic"))) {
    const ok = coins.length === 1;
    rules.push({ id: "toxic", ok });
    if (!ok) cost += LABEL_COST.toxic;
  }
  return { rules, cost, origins, cj, cjWarn };
}

/**
 * Big-change cost for a change-to-payment ratio: bigChange from 3x, and from
 * 10x the cap (bigChange + half a link).
 *
 * Checklist rule 4 (ruling): under Privacy first, a merge of 2 origins (one
 * new link, 12) that leaves no change or change of at most the payment
 * (+4, 16 in all) beats one coin whose change is at least 10x the payment
 * (4 + 15 = 19). A merge of 3 origins (24), a merge that breaks the KYC or
 * CJ label rules (+40 / +30) or one that also leaves toxic change (+10)
 * still loses, and so does the 2-origin merge with change against one coin
 * whose change is 3x-10x (13).
 */
function bigChangeCost(ratio: number): number {
  if (ratio < BIG_CHANGE_RATIO) return 0;
  return ratio < HUGE_CHANGE_RATIO ? COST.bigChange : COST.bigChange + COST.link / 2;
}

/** A single coin is "close" when what it leaves over the payment (change or absorbed) is at most this share of the payment. */
export const CLOSE_RATIO = 0.1;

/** The observer (else platform) every coin's label names, when all coins share one; mixed outputs never count. */
function sharedObserver(coins: readonly CoinSelectionInput[]): string | undefined {
  if (coins.length < 2 || coins.some(c => c.origin === "mixed")) return undefined;
  for (const f of ["labelObserver", "labelPlatform"] as const) {
    const v = coins[0]![f]?.trim();
    if (v && coins.every(c => c[f]?.trim().toLowerCase() === v.toLowerCase())) return v;
  }
  return undefined;
}

interface Scored {
  picked: Candidate[];
  fee: number;
  change: number;
  origins: number;
  groups: number;
  cost: number;
  /** Merges a mixed output with unmixed coins, or a mixed output leaves change at least the payment */
  severe: boolean;
  /** Merges only CoinJoin outputs (rule 9) */
  mixedOnly: boolean;
  badChange: boolean;
  labels: LabelVerdict;
  absorbs: boolean;
  /** Every coin is known to the recipient (rule 1) */
  known: boolean;
  /** The observer or platform every coin's label shares (rule 5) */
  observer?: string;
}

/**
 * Score a set. `absorbMax` > 0: the no-change variant instead, only when the
 * set leaves change of at most `absorbMax` (the change goes to the fee).
 */
function score(picked: Candidate[], amount: number, feeRate: number, absorbMax = 0, knownSet: ReadonlySet<string> = EMPTY): Scored | null {
  let s = settle(picked.reduce((t, c) => t + c.value, 0), picked.reduce((t, c) => t + c.vb, 0), amount, feeRate);
  if (!s) return null;
  const absorbs = absorbMax > 0;
  if (absorbs) {
    if (s.change === 0 || absorbedIf(s.change, feeRate) > absorbMax) return null;
    s = { fee: s.fee + s.change, change: 0 };
  }
  const origins = new Set(picked.map(c => c.group)).size;
  const groups = new Set(picked.map(c => c.loose)).size;
  const mixedCount = picked.filter(c => c.coin.origin === "mixed").length;
  const mixed = mixedCount > 0;
  /** Rule 9 (ruling): only CoinJoin outputs merged, the least-bad merge when one is needed */
  const mixedOnly = picked.length > 1 && mixedCount === picked.length;
  const fromCoinJoin = mixed || picked.some(c => c.coin.origin === "coinjoin-change");
  const badChange = s.change > 0 && (s.change < TOXIC_CHANGE_THRESHOLD || fromCoinJoin);
  const observer = sharedObserver(picked.map(c => c.coin));
  // Rule 5: one observer already knows every coin, so a merge tells it nothing new; it still links them
  // for everyone else, so each new link costs half (as an inferred one). Rule 9: a link between
  // CoinJoin outputs (no history behind them) costs a little less than one between coins with history.
  const linkCost = observer ? COST.link / 2 : mixedOnly ? COST.coinjoinLink : COST.link;
  let cost = (groups - 1) * linkCost + (origins - groups) * (COST.link / 2);
  if (mixed && picked.length > 1 && !mixedOnly) cost += COST.coinjoinMerge;
  if (s.change > 0) cost += COST.change;
  if (badChange) cost += COST.badChange;
  cost += bigChangeCost(s.change / amount);
  const severe = mixed && ((picked.length > 1 && !mixedOnly) || s.change >= amount);
  const labels = labelVerdict(picked.map(c => c.coin), picked.map(c => c.group));
  cost += labels.cost;
  // Rule 1: paying with coins the recipient already knows tells it nothing new about your activity.
  const known = knownSet.size > 0 && picked.every(c => knownSet.has(outpointOf(c.coin)));
  if (known) cost -= COST.known;
  // The extra fee costs in proportion to the payment, so a large donation never wins by default.
  if (absorbs) cost += COST.extraFee * (s.fee - Math.ceil((picked.reduce((t, c) => t + c.vb, 0) + BASE_VB + OUTPUT_VB) * feeRate)) / amount;
  return { picked, ...s, origins, groups, cost, severe, badChange, labels, absorbs, known, mixedOnly, ...(observer ? { observer } : {}) };
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
  if (x.known) return "recipient-knows";
  if (x.groups > 1) return "links";
  if (x.origins > 1) return "inferred-links";
  if (x.badChange) return "bad-change";
  if (x.change >= BIG_CHANGE_RATIO * amount) return "big-change";
  return x.change === 0 ? "clean" : "small-change";
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

const mixedIn = (p: CoinSelectionPlan) => p.selected.filter(c => c.origin === "mixed").length;
/** Privacy cost, then CoinJoin change before a mixed output, then fewer inputs, less fee, less change. */
const byPrivacy = (a: CoinSelectionPlan, b: CoinSelectionPlan) =>
  a.cost - b.cost || mixedIn(a) - mixedIn(b) || a.selected.length - b.selected.length || a.fee - b.fee || a.change - b.change;
const CRITERION_ORDER: Record<PlanCriterion, (a: CoinSelectionPlan, b: CoinSelectionPlan) => number> = {
  privacy: byPrivacy,
  "least-change": (a, b) => a.change - b.change || byPrivacy(a, b),
  // Changeless plans first, each side by privacy (unlike least change, the rest is not ordered by change)
  "no-change": (a, b) => Number(a.change > 0) - Number(b.change > 0) || byPrivacy(a, b),
  "fewest-coins": (a, b) => a.selected.length - b.selected.length || byPrivacy(a, b),
  "lowest-fee": (a, b) => a.fee - b.fee || byPrivacy(a, b),
};

/** The plans ordered by a criterion, best first (a new array). */
export function rankPlans<P extends CoinSelectionPlan>(plans: readonly P[], criterion: PlanCriterion): P[] {
  return [...plans].sort(CRITERION_ORDER[criterion]);
}

/**
 * Pareto pruning: drops a plan when another is at least as good on cost, fee,
 * change and new links, and strictly better on one. Keeps the input order.
 */
function pareto(plans: CoinSelectionPlan[]): CoinSelectionPlan[] {
  const dims = (p: CoinSelectionPlan) => { const l = planLinks(p); return [p.cost, p.fee, p.change, l.certain + l.inferred / 2]; };
  const d = plans.map(dims);
  // ponytail: O(n^2) over the scored sets (a few hundred at most on a 1000-coin wallet).
  return plans.filter((_, i) => !d.some((o, j) => j !== i && o.every((v, k) => v <= d[i]![k]!) && o.some((v, k) => v < d[i]![k]!)));
}

export type SelectionEvaluation =
  | { kind: "plan"; plan: CoinSelectionPlan }
  | { kind: "insufficient"; total: number; shortfall: number }
  | { kind: "invalid" };

/**
 * Evaluate coins the user picked by hand, with the same scoring and plan
 * building as the advisor. Origins are resolved over the whole wallet (as the
 * advisor does), so a set the advisor suggested evaluates to the same plan.
 * Dust and uneconomical coins count when picked.
 */
export function evaluateSelection(
  utxos: CoinSelectionInput[],
  outpoints: ReadonlySet<string>,
  paymentAmount: number,
  feeRate: number,
  { maxAbsorb = DEFAULT_MAX_ABSORB, absorb = false, includeFrozen = false, known = EMPTY }: { maxAbsorb?: number; absorb?: boolean; includeFrozen?: boolean } & SpendContext = {},
): SelectionEvaluation {
  if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0 || !Number.isFinite(feeRate) || feeRate <= 0) return { kind: "invalid" };
  // The advisor's coin set (frozen coins left out unless included), plus the picked coins themselves.
  const pool = includeFrozen ? utxos : utxos.filter(u => !u.frozen || outpoints.has(outpointOf(u)));
  const all = candidatesOf(pool, feeRate, outpoints).cands;
  const picked = all.filter(c => outpoints.has(outpointOf(c.coin)));
  if (picked.length === 0) return { kind: "invalid" };
  const x = score(picked, paymentAmount, feeRate, 0, known);
  if (!x) {
    const total = picked.reduce((s, c) => s + c.value, 0);
    const fee = Math.ceil((picked.reduce((s, c) => s + c.vb, 0) + BASE_VB + OUTPUT_VB) * feeRate);
    return { kind: "insufficient", total, shortfall: paymentAmount + fee - total };
  }
  // Absorb asked and possible (change at most maxAbsorb): the no-change variant.
  const v = absorb ? score(picked, paymentAmount, feeRate, maxAbsorb, known) : null;
  const ctx = { known, closeSingles: closeSingles(all, paymentAmount, feeRate) };
  return { kind: "plan", plan: buildPlan(v ?? x, paymentAmount, feeRate, false, maxAbsorb, ctx) };
}

const strategyOf = (x: Scored): PlanStrategy =>
  x.picked.length === 1 ? "single-coin"
  : x.change === 0 ? "no-change"
  : x.origins === 1 ? "same-origin"
  : x.groups === 1 ? "probably-linked"
  : "multi-coin";

/** Coins that pay alone leaving at most CLOSE_RATIO of the payment over (rule 2). */
function closeSingles(cands: readonly Candidate[], amount: number, feeRate: number): number {
  return cands.filter(c => { const s = settle(c.value, c.vb, amount, feeRate); return s !== null && s.change <= CLOSE_RATIO * amount; }).length;
}

interface PathContext { known: ReadonlySet<string>; closeSingles: number }

/** The decision tree's steps for a plan (rules 1, 2, 3, 4, 5 and 9 of the spending checklist). */
function decisionPath(x: Scored, coins: readonly CoinSelectionInput[], change: number, absorbed: number, amount: number, ctx: PathContext): DecisionStep[] {
  const steps: DecisionStep[] = [];
  if (ctx.known.size > 0) {
    const k = coins.filter(c => ctx.known.has(outpointOf(c))).length;
    steps.push(k === coins.length ? { rule: 1, id: "known-used", ok: true, n: k }
      : k > 0 ? { rule: 1, id: "known-partial", ok: false, n: k }
      : { rule: 1, id: "known-unused", ok: false, n: ctx.known.size });
  }
  const single = coins.length === 1;
  const left = change + absorbed;
  if (single) steps.push(left <= CLOSE_RATIO * amount ? { rule: 2, id: "close-single", ok: true, amount: left } : { rule: 2, id: "far-single", ok: false, amount: left });
  else steps.push(ctx.closeSingles === 0 ? { rule: 2, id: "no-close-single", ok: true } : { rule: 2, id: "close-single-skipped", ok: false, n: ctx.closeSingles });
  steps.push(change === 0 ? { rule: 3, id: "no-change", ok: true } : { rule: 3, id: "change-left", ok: false, amount: change });
  const ratio = Math.round(change / amount);
  if (!single) {
    steps.push(change === 0 ? (absorbed > 0 && x.absorbs ? { rule: 4, id: "merge-absorbed", ok: true, amount: absorbed } : { rule: 4, id: "merge-no-change", ok: true })
      : change <= amount ? { rule: 4, id: "merge-small-change", ok: true, amount: change }
      : { rule: 4, id: "merge-big-change", ok: false, n: Math.max(1, ratio) });
    steps.push(x.groups === 1 ? { rule: 5, id: "already-linked", ok: true }
      : x.observer ? { rule: 5, id: "same-observer", ok: true, name: x.observer }
      : { rule: 5, id: "new-links", ok: false, n: x.groups });
    const mixed = coins.filter(c => c.origin === "mixed").length;
    if (mixed > 0) steps.push(mixed === coins.length ? { rule: 9, id: "coinjoin-only", ok: false, n: mixed } : { rule: 9, id: "coinjoin-mixed", ok: false, n: mixed });
  } else if (change >= HUGE_CHANGE_RATIO * amount) {
    steps.push({ rule: 4, id: "huge-change", ok: false, n: ratio });
  }
  return steps;
}

function buildPlan(x: Scored, amount: number, feeRate: number, fallback: boolean, maxAbsorb: number, ctx: PathContext): CoinSelectionPlan {
  // Largest first, so one set reads the same whichever search found it.
  const coins = [...x.picked].sort((a, b) => b.value - a.value).map(c => c.coin);
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
  // Small change: the no-change variant (listed too) pays it to miners instead.
  if (change > 0 && absorbedIf(change, feeRate) <= maxAbsorb) warnings.push({ id: "absorb-change", severity: "low", count: change });
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
    strategy: strategyOf(x), reason: reasonOf(x, amount, fallback), cost: x.cost,
    selected: withHints(coins), inputTotal, paymentAmount: amount, fee, change, absorbed, absorbsChange: x.absorbs, origins, groups, warnings,
    labelRules: x.labels.rules,
    path: decisionPath(x, coins, change, absorbed, amount, ctx),
  };
}

/**
 * Recommend which coins to spend for a payment.
 *
 * @param utxos - Wallet UTXOs with address and origin info
 * @param paymentAmount - Payment amount in sats
 * @param feeRate - Fee rate in sat/vB
 * @param maxAbsorb - Max extra fee to leave no change: a plan with change up to this also comes as a no-change variant
 * @param ctx - Coins the recipient already knows (rule 1): searched on their own too, and a plan of only those ranks up
 */
export function adviseCoinSelection(
  utxos: CoinSelectionInput[],
  paymentAmount: number,
  feeRate = 5,
  maxAbsorb = DEFAULT_MAX_ABSORB,
  { known = EMPTY }: SpendContext = {},
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
  if (pays(small)) {
    // No single coin: the first DFS leaf is the top-k set, so a result always exists.
    const maxK = singles.length > 0 ? MAX_SMALL_SET : Infinity;
    sets.push(...fewestCoins(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }, maxK));
    sets.push(smallestFirst(small, paymentAmount, feeRate));
    sets.push(...smallestPartners(small, paymentAmount, feeRate, { left: MAX_ITERATIONS }));
    const sameBudget = { left: MAX_ITERATIONS };
    for (const g of groupBy(small)) if (g.length > 1 && pays(g)) sets.push(...fewestCoins(g, paymentAmount, feeRate, sameBudget, maxK));
  }
  // Rule 1: the coins the recipient already knows, on their own (singles are already in).
  const knownCands = cands.filter(c => known.has(outpointOf(c.coin)));
  if (knownCands.length > 1 && pays(knownCands)) {
    const knownBudget = { left: MAX_ITERATIONS };
    sets.push(...changelessSets(knownCands, paymentAmount, feeRate, knownBudget));
    sets.push(...fewestCoins(knownCands.filter(c => !pays([c])), paymentAmount, feeRate, knownBudget, MAX_SMALL_SET));
  }

  const seen = new Set<string>();
  const scored: Scored[] = [];
  for (const set of sets) {
    if (!set) continue;
    const id = set.map(c => outpointOf(c.coin)).sort().join();
    if (seen.has(id)) continue;
    seen.add(id);
    const x = score(set, paymentAmount, feeRate, 0, known);
    if (x) scored.push(x);
    // Small change: also the same coins with the change paid to miners.
    const v = maxAbsorb > 0 ? score(set, paymentAmount, feeRate, maxAbsorb, known) : null;
    if (v) scored.push(v);
  }

  // Severe plans only when nothing else pays. A merge of only CoinJoin outputs (rule 9) is the
  // least-bad merge when a merge is needed, never when one coin pays alone.
  const avoidable = scored.some(x => x.picked.length === 1 && !x.severe);
  const safe = scored.filter(x => !x.severe && !(x.mixedOnly && avoidable));
  const fallback = safe.length === 0;
  const ctx = { known, closeSingles: closeSingles(cands, paymentAmount, feeRate) };
  const front = pareto(rankPlans((fallback ? scored : safe).map(x => buildPlan(x, paymentAmount, feeRate, fallback, maxAbsorb, ctx)), "privacy"));
  // Each criterion's best plan is kept, then the rest by privacy cost, up to MAX_PLANS.
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
