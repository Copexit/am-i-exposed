/**
 * Linkage clusters: which of the wallet's coins its own history already links
 * on-chain. Union-find over outpoints; two coins share a cluster when
 * - they sit on the same address, or
 * - a solo spend (every input the wallet's, not a CoinJoin) spent them
 *   together, or one descends from the other through solo spends: the
 *   wallet outputs of a solo spend join its inputs (same funding tx, common
 *   wallet-owned ancestors).
 * - it is a CoinJoin's change (wallet-behavior "coinjoin-change"): it stays
 *   linked to the wallet's inputs of that CoinJoin, which is what makes it toxic.
 * Never linked: a CoinJoin's mixed outputs (to anything), coins received
 * from outside (a batch payout to two wallet addresses is not known to link
 * them), and txs with an outside input (skipped, never labelled).
 *
 * Merging coins of one cluster reveals nothing new. Used by the coin
 * selection advisor and by W2 (docs/spec-wallet-heuristics.md).
 */
import type { MempoolTransaction } from "@/lib/api/types";
import { coinClass, isOwn, soloSpends, type WalletGraph } from "./wallet-behavior";

export interface WalletClusters {
  /** Cluster id of a wallet coin; a coin the history never links has its own. */
  of(txid: string, vout: number): string;
  /**
   * Solo spends whose inputs came from 2+ clusters, with each input's cluster
   * just before the spend. A spend absent here linked nothing new.
   */
  linking: ReadonlyMap<string, readonly string[]>;
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

export function buildClusters(g: WalletGraph): WalletClusters {
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

  // Same address
  for (const tx of g.txs.values()) {
    tx.vout.forEach((o, i) => {
      if (isOwn(g, o.scriptpubkey_address)) union(key(tx.txid, i), `a:${o.scriptpubkey_address}`);
    });
    for (const v of tx.vin) {
      const a = v.prevout?.scriptpubkey_address;
      if (isOwn(g, a)) union(key(v.txid, v.vout), `a:${a}`);
    }
  }

  // Oldest first. CoinJoin: its change joins the wallet's inputs.
  // Solo spend: inputs together, then its wallet outputs with them.
  const solo = new Set(soloSpends(g));
  const joined = [...g.txs.values()].filter((tx) => g.isCoinJoin(tx) && tx.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address)));
  const linking = new Map<string, string[]>();
  for (const tx of topological([...solo, ...joined])) {
    if (!solo.has(tx)) {
      const own = tx.vin.filter((v) => isOwn(g, v.prevout?.scriptpubkey_address));
      tx.vout.forEach((o, i) => {
        if (isOwn(g, o.scriptpubkey_address) && coinClass(g, tx.txid, i) === "coinjoin-change") {
          for (const v of own) union(key(tx.txid, i), key(v.txid, v.vout));
        }
      });
      continue;
    }
    const before = tx.vin.map((v) => find(key(v.txid, v.vout)));
    if (new Set(before).size > 1) linking.set(tx.txid, before);
    const root = key(tx.vin[0]!.txid, tx.vin[0]!.vout);
    for (const v of tx.vin) union(key(v.txid, v.vout), root);
    tx.vout.forEach((o, i) => {
      if (isOwn(g, o.scriptpubkey_address)) union(key(tx.txid, i), root);
    });
  }

  return { of: (txid, vout) => find(key(txid, vout)), linking };
}
