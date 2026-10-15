/**
 * Bounded bidirectional connection search between two sets of transactions.
 *
 * Four frontiers grow level by level: forward(A) via outspends, backward(A)
 * via vin[].txid, forward(B) and backward(B). Within a level the smallest
 * frontier goes first. A tx reached on two complementary sides is a meeting
 * point, and the path is rebuilt from each side's predecessor links.
 *
 * Transactions are fetched lazily: a reached tx is only fetched when its side
 * expands through it (or, with stopAtCoinJoins, when it is a meeting point),
 * so the deepest level costs no budget. Pure: no UI imports, all I/O goes
 * through the injected fetcher.
 */

import type { MempoolOutspend, MempoolTransaction } from "@/lib/api/types";
import type { GraphExpansionFetcher } from "./graph-reducer";

export type ConnectionKind = "direct" | "a-funds-b" | "b-funds-a" | "shared-ancestor" | "shared-descendant";

/**
 * One tx on a path. Indices keep their chain meaning on every path shape:
 * inIndex is the vin linking this tx to its funding neighbour on the path,
 * outIndex the vout linking it to its spending neighbour (undefined where the
 * path has no such neighbour, e.g. inIndex at a linear path's start). The
 * pivot of a bent path carries its link to the A-side neighbour here; its
 * link to the B-side neighbour is in `ConnectionPath.pivotLink`.
 */
export interface PathHop { txid: string; inIndex?: number; outIndex?: number }

export interface ConnectionPath {
  kind: ConnectionKind;
  /** a-funds-b: A to B in chain order; b-funds-a: B to A; direct: chain order; shared-*: A, through the meet tx, to B. */
  hops: PathHop[];
  meetTxid: string;
  /** Index of the meet tx in `hops`, set for shared-ancestor and shared-descendant. */
  pivot?: number;
  /**
   * The meet tx's link toward the B-side neighbour, set with `pivot`, chain meaning:
   * shared-ancestor: `outIndex` is the pivot's vout spent toward B;
   * shared-descendant: `inIndex` is the pivot's vin funded from the B side.
   */
  pivotLink?: { inIndex?: number; outIndex?: number };
  /**
   * Set when stopAtCoinJoins is on but an interior hop (the meet tx) could not be
   * fetched (budget, time or fetch error), so it was not checked for CoinJoin.
   */
  unverified?: true;
}

export interface ConnectionSearchOptions {
  maxHops: number;
  maxTxs: number;
  timeoutMs: number;
  stopAtCoinJoins: boolean;
  /** Txs with more outputs (searching forward) or more inputs (searching backward) are not expanded. */
  branchCap: number;
  concurrency?: number;
  /** Clock override for tests; defaults to performance.now(). */
  now?: () => number;
}

export const DEFAULT_CONNECTION_OPTIONS: ConnectionSearchOptions = {
  maxHops: 4,
  maxTxs: 150,
  timeoutMs: 45_000,
  stopAtCoinJoins: true,
  branchCap: 60,
  concurrency: 3,
};

export interface ConnectionProgress { txsFetched: number; depthA: number; depthB: number; elapsedMs: number }

export interface SearchSummary {
  txsFetched: number;
  stoppedBy: "done" | "hops" | "budget" | "time" | "aborted";
  branchLimited: number;
  coinJoinStops: number;
  /** Failed getTransaction and getTxOutspends calls; each was treated as a chain end, so results may be incomplete. */
  fetchErrors: number;
}

const MAX_PER_KIND = 5;

/** How a tx was reached: `from` is the neighbour one step closer to the seed. */
interface Link { from: string | null; outIndex?: number; inIndex?: number }

interface Side { forward: boolean; reached: Map<string, Link>; frontier: string[]; depth: number }

type Stop = Exclude<SearchSummary["stoppedBy"], "done" | "hops">;

export async function findConnections(
  fromTxids: string[],
  toTxids: string[],
  fetcher: GraphExpansionFetcher,
  options: ConnectionSearchOptions,
  callbacks: {
    onResult(path: ConnectionPath): void;
    onProgress?(p: ConnectionProgress): void;
    isCoinJoin(tx: MempoolTransaction): boolean;
  },
  signal?: AbortSignal,
): Promise<SearchSummary> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const from = [...new Set(fromTxids)];
  const fromSet = new Set(from);
  const to = [...new Set(toTxids)].filter((t) => !fromSet.has(t));

  const txs = new Map<string, MempoolTransaction>();
  const failed = new Set<string>();
  const coinJoins = new Set<string>();
  const branchLimited = new Set<string>();
  let txsFetched = 0;
  let fetchErrors = 0;
  let stop: Stop | null = null;

  function checkStop(): boolean {
    if (stop) return true;
    if (signal?.aborted) stop = "aborted";
    else if (now() - start >= options.timeoutMs) stop = "time";
    return stop !== null;
  }

  async function pool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
    let i = 0;
    const worker = async () => {
      for (let item = items[i]; item !== undefined && !stop; item = items[i]) {
        i++;
        await fn(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  }

  async function fetchTx(txid: string): Promise<void> {
    if (txs.has(txid) || failed.has(txid) || checkStop()) return;
    if (txsFetched >= options.maxTxs) {
      stop = "budget";
      return;
    }
    txsFetched++;
    // Mark as pending so a concurrent worker never fetches the same txid twice
    failed.add(txid);
    try {
      txs.set(txid, await fetcher.getTransaction(txid));
      failed.delete(txid);
    } catch {
      fetchErrors++;
    }
    if (signal?.aborted) stop = "aborted";
  }

  const summary = (stoppedBy: SearchSummary["stoppedBy"]): SearchSummary => ({
    txsFetched, stoppedBy, branchLimited: branchLimited.size, coinJoinStops: coinJoins.size, fetchErrors,
  });

  if (from.length === 0 || to.length === 0) return summary("done");

  // Seeds first; they count toward the budget
  await pool([...from, ...to], fetchTx);
  if (stop === "aborted") return summary("aborted");
  const seedsA = from.filter((t) => txs.has(t));
  const seedsB = to.filter((t) => txs.has(t));
  const newSide = (forward: boolean, seeds: string[]): Side => ({
    forward, reached: new Map(seeds.map((t) => [t, { from: null }])), frontier: seeds, depth: 0,
  });
  const fA = newSide(true, seedsA);
  const bA = newSide(false, seedsA);
  const fB = newSide(true, seedsB);
  const bB = newSide(false, seedsB);
  const sides = [fA, bA, fB, bB];

  /** Hops from the seed to `txid` (forward side) or from `txid` to the seed (backward side), in chain order. */
  function chainHops(side: Side, txid: string): PathHop[] {
    const hops: PathHop[] = [];
    let cur: string | null = txid;
    let carry: number | undefined;
    while (cur !== null) {
      const link: Link = side.reached.get(cur) ?? { from: null };
      // Forward: walking back to the seed, `carry` is this tx's outIndex. Backward: its inIndex.
      const hop: PathHop = { txid: cur };
      if (side.forward) {
        if (carry !== undefined) hop.outIndex = carry;
        if (link.inIndex !== undefined) hop.inIndex = link.inIndex;
        carry = link.outIndex;
      } else {
        if (carry !== undefined) hop.inIndex = carry;
        if (link.outIndex !== undefined) hop.outIndex = link.outIndex;
        carry = link.inIndex;
      }
      hops.push(hop);
      cur = link.from;
    }
    return side.forward ? hops.reverse() : hops;
  }

  function buildPath(kind: ConnectionKind, m: string): ConnectionPath | null {
    let hops: PathHop[];
    let pivot: number | undefined;
    let pivotLink: PathHop | undefined;
    if (kind === "a-funds-b" || kind === "b-funds-a") {
      const [fwd, bwd] = kind === "a-funds-b" ? [fA, bB] : [fB, bA];
      const head = chainHops(fwd, m);
      const tail = chainHops(bwd, m);
      const meet: PathHop = { ...head[head.length - 1], ...tail[0], txid: m };
      hops = [...head.slice(0, -1), meet, ...tail.slice(1)];
      if (hops.length === 2) kind = "direct";
    } else if (kind === "shared-ancestor") {
      const aHalf = chainHops(bA, m).reverse();
      const bHalf = chainHops(bB, m);
      hops = [...aHalf, ...bHalf.slice(1)];
      pivot = aHalf.length - 1;
      pivotLink = bHalf[0];
    } else {
      const aHalf = chainHops(fA, m);
      const bHalf = chainHops(fB, m).reverse();
      hops = [...aHalf, ...bHalf.slice(1)];
      pivot = aHalf.length - 1;
      pivotLink = bHalf[0];
    }
    if (hops.length < 2 || new Set(hops.map((h) => h.txid)).size !== hops.length) return null;
    if (pivot === undefined || !pivotLink) return { kind, hops, meetTxid: m };
    const { txid: _pivotTxid, ...link } = pivotLink;
    return { kind, hops, meetTxid: m, pivot, pivotLink: link };
  }

  const pending: ConnectionPath[] = [];
  const seen = new Set<string>();
  const emitted = new Map<ConnectionKind, number>();

  function findMeets(txid: string): void {
    const at = (s: Side) => s.reached.has(txid);
    const notSeed = (s: Side) => s.reached.get(txid)?.from != null;
    const candidates: ConnectionKind[] = [];
    if (at(fA) && at(bB)) candidates.push("a-funds-b");
    if (at(fB) && at(bA)) candidates.push("b-funds-a");
    // A seed on either side means the pair is a funding path, found above
    if (at(bA) && at(bB) && notSeed(bA) && notSeed(bB)) candidates.push("shared-ancestor");
    if (at(fA) && at(fB) && notSeed(fA) && notSeed(fB)) candidates.push("shared-descendant");
    for (const kind of candidates) {
      const path = buildPath(kind, txid);
      if (!path) continue;
      const key = `${path.kind}|${path.hops.map((h) => h.txid).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push(path);
    }
  }

  /** Emit buffered paths shortest first, capped per kind. Called once per completed level. */
  async function flush(): Promise<void> {
    if (pending.length === 0) return;
    const batch = pending.splice(0).sort((x, y) => x.hops.length - y.hops.length);
    if (options.stopAtCoinJoins) {
      // Interior txs are fetched already except the meet tx; fetch meets to check them
      await pool([...new Set(batch.map((p) => p.meetTxid))], fetchTx);
    }
    if (signal?.aborted) return;
    for (const path of batch) {
      const n = emitted.get(path.kind) ?? 0;
      if (n >= MAX_PER_KIND) continue;
      if (options.stopAtCoinJoins) {
        const interior = path.hops.slice(1, -1).map((h) => txs.get(h.txid));
        if (interior.some((tx) => tx && callbacks.isCoinJoin(tx))) continue;
        // Never fetched (budget, time or error): emit, but flag it as not checked
        if (interior.includes(undefined)) path.unverified = true;
      }
      emitted.set(path.kind, n + 1);
      callbacks.onResult(path);
    }
  }

  async function expand(side: Side): Promise<void> {
    await pool(side.frontier, fetchTx);
    const expandable = side.frontier.filter((t) => {
      const tx = txs.get(t);
      if (!tx) return false;
      if (options.stopAtCoinJoins && side.depth > 0 && callbacks.isCoinJoin(tx)) {
        coinJoins.add(t);
        return false;
      }
      if ((side.forward ? tx.vout.length : tx.vin.length) > options.branchCap) {
        branchLimited.add(t);
        return false;
      }
      return true;
    });

    const next = new Map<string, Link>();
    const add = (txid: string, link: Link) => {
      if (!side.reached.has(txid) && !next.has(txid)) next.set(txid, link);
    };
    if (side.forward) {
      const outspends = new Map<string, MempoolOutspend[]>();
      await pool(expandable, async (t) => {
        if (checkStop()) return;
        try {
          outspends.set(t, await fetcher.getTxOutspends(t));
        } catch {
          fetchErrors++;
        }
        if (signal?.aborted) stop = "aborted";
      });
      for (const t of expandable) {
        (outspends.get(t) ?? []).forEach((o, vout) => {
          // Unspent, or spent with no known spender: a natural end
          if (o.spent && o.txid) add(o.txid, { from: t, outIndex: vout, inIndex: o.vin });
        });
      }
    } else {
      for (const t of expandable) {
        txs.get(t)?.vin.forEach((v, i) => {
          if (!v.is_coinbase) add(v.txid, { from: t, outIndex: v.vout, inIndex: i });
        });
      }
    }

    for (const [txid, link] of next) side.reached.set(txid, link);
    side.frontier = [...next.keys()];
    side.depth++;
    for (const txid of next.keys()) findMeets(txid);
  }

  for (const t of [...seedsA, ...seedsB]) findMeets(t);

  let level = 0;
  for (;;) {
    const open = sides.filter((s) => s.frontier.length > 0 && s.depth < options.maxHops);
    if (open.length === 0 || stop) break;
    const minDepth = Math.min(...open.map((s) => s.depth));
    if (minDepth > level) {
      await flush();
      level = minDepth;
    }
    const side = open
      .filter((s) => s.depth === minDepth)
      .reduce((x, y) => (y.frontier.length < x.frontier.length ? y : x));
    await expand(side);
    callbacks.onProgress?.({
      txsFetched,
      depthA: Math.max(fA.depth, bA.depth),
      depthB: Math.max(fB.depth, bB.depth),
      elapsedMs: now() - start,
    });
  }

  if (stop === "aborted" || signal?.aborted) return summary("aborted");
  // A budget or time stop hit only while checking meets in this last flush does not change why the search ended
  const searchStop = stop;
  await flush();
  if (signal?.aborted) return summary("aborted");
  if (searchStop) return summary(searchStop);
  return summary(sides.some((s) => s.frontier.length > 0) ? "hops" : "done");
}
