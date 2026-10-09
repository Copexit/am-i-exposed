/**
 * Linkage clusters: which of the wallet's coins its own history already links
 * on-chain, in two tiers (union-find over outpoints).
 *
 * Certain: anyone sees the link without guessing.
 * - the same address;
 * - inputs co-spent in a solo spend (every input the wallet's, not a CoinJoin);
 * - a solo spend with exactly one wallet output: that output joins its inputs,
 *   when an observer can tell it is the change (changeIdentifiable);
 * - a CoinJoin's change (wallet-behavior "coinjoin-change") joins the wallet's
 *   inputs of that CoinJoin, when those inputs were already one certain
 *   cluster (that link is what makes it toxic).
 * Inferred (a superset of certain): a solo spend with 2+ wallet outputs joins
 * them with each other and with its inputs; so does a solo spend's only wallet
 * output when it is ambiguous change. An observer who guesses which
 * output was the change links them; one who does not, does not.
 * Never linked: a CoinJoin's mixed outputs (to anything), coins received
 * from outside (a batch payout to two wallet addresses is not known to link
 * them), and txs with an outside input (skipped, never labelled).
 *
 * Used by the coin selection advisor and by W2 (docs/spec-wallet-heuristics.md).
 */
import type { MempoolTransaction } from "@/lib/api/types";
import { coinClass, isOwn, soloSpends, type WalletGraph } from "./wallet-behavior";
import { changeIdentifiable } from "./change-identifiable";

export interface WalletClusters {
  /** Certain cluster id of a wallet coin; a coin the history never links has its own. */
  of(txid: string, vout: number): string;
  /** Inferred cluster id: certain links plus sibling wallet outputs of one tx and their descendants. */
  inferredOf(txid: string, vout: number): string;
  /**
   * Solo spends whose inputs came from 2+ certain clusters, with each input's
   * certain and inferred cluster just before the spend. A spend absent here
   * linked nothing new.
   */
  linking: ReadonlyMap<string, { certain: readonly string[]; inferred: readonly string[] }>;
}

const key = (txid: string, vout: number) => `${txid}:${vout}`;

/** Parents before children, so a spend sees the clusters as they were when it was made. */
function topological(spends: readonly MempoolTransaction[]): MempoolTransaction[] {
  const byId = new Map(spends.map((tx) => [tx.txid, tx]));
  const done = new Set<string>();
  const out: MempoolTransaction[] = [];
  const visit = (tx: MempoolTransaction) => {
    // Iterative DFS: a long peel chain would overflow a recursive one
    const stack: [MempoolTransaction, number][] = [[tx, 0]];
    done.add(tx.txid);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const [cur, i] = top;
      if (i < cur.vin.length) {
        top[1]++;
        const parent = byId.get(cur.vin[i]!.txid);
        if (parent && !done.has(parent.txid)) {
          done.add(parent.txid);
          stack.push([parent, 0]);
        }
      } else {
        stack.pop();
        out.push(cur);
      }
    }
  };
  for (const tx of spends) if (!done.has(tx.txid)) visit(tx);
  return out;
}

function unionFind() {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    for (let p = parent.get(root); p !== undefined && p !== root; p = parent.get(root)) root = p;
    for (let cur = k; cur !== root; ) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { find, union };
}

export function buildClusters(g: WalletGraph): WalletClusters {
  const certain = unionFind();
  const inferred = unionFind();
  const both = (a: string, b: string) => { certain.union(a, b); inferred.union(a, b); };

  // Same address
  for (const tx of g.txs.values()) {
    tx.vout.forEach((o, i) => {
      if (isOwn(g, o.scriptpubkey_address)) both(key(tx.txid, i), `a:${o.scriptpubkey_address}`);
    });
    for (const v of tx.vin) {
      const a = v.prevout?.scriptpubkey_address;
      if (isOwn(g, a)) both(key(v.txid, v.vout), `a:${a}`);
    }
  }

  // Oldest first, so each spend sees the clusters as they were when it was made.
  const solo = new Set(soloSpends(g));
  const joined = [...g.txs.values()].filter((tx) => g.isCoinJoin(tx) && tx.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address)));
  const linking = new Map<string, { certain: string[]; inferred: string[] }>();
  for (const tx of topological([...solo, ...joined])) {
    const outIdx = tx.vout.flatMap((o, i) => (isOwn(g, o.scriptpubkey_address) ? [i] : []));
    const outs = outIdx.map((i) => key(tx.txid, i));
    if (!solo.has(tx)) {
      // CoinJoin: its change joins the wallet's inputs, only when they were one certain cluster
      const own = tx.vin.filter((v) => isOwn(g, v.prevout?.scriptpubkey_address)).map((v) => key(v.txid, v.vout));
      if (new Set(own.map(certain.find)).size !== 1) continue;
      for (const i of outIdx) if (coinClass(g, tx.txid, i) === "coinjoin-change") both(key(tx.txid, i), own[0]!);
      continue;
    }
    const ins = tx.vin.map((v) => key(v.txid, v.vout));
    const before = ins.map(certain.find);
    if (new Set(before).size > 1) linking.set(tx.txid, { certain: before, inferred: ins.map(inferred.find) });
    for (const i of ins) both(i, ins[0]!);
    // A payment's only wallet output joins its inputs for certain only when an observer can tell it is the
    // change (changeIdentifiable); ambiguous change, like sibling outputs, only in the inferred tier.
    if (outs.length === 1 && changeIdentifiable(g, tx.txid, outIdx[0]!) !== null) both(outs[0]!, ins[0]!);
    else for (const o of outs) inferred.union(o, ins[0]!);
  }

  return { of: (txid, vout) => certain.find(key(txid, vout)), inferredOf: (txid, vout) => inferred.find(key(txid, vout)), linking };
}
