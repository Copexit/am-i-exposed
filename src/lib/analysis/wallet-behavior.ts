/**
 * Wallet behaviour model: the scanned history as one graph, each coin paid to
 * the wallet classified by where it came from, and the transactions the
 * wallet built alone. Pure: computed from the scan data only, no requests.
 * See docs/spec-wallet-heuristics.md.
 */
import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";
import type { WalletAddressInfo } from "./wallet-audit";
import { isCoinJoinTx } from "./heuristics/coinjoin";
import { detectTx0 } from "./heuristics/coinjoin-premix";

export type CoinClass = "mixed" | "coinjoin-change" | "change" | "self" | "received" | "unknown";
export const COIN_CLASSES: readonly CoinClass[] = ["mixed", "coinjoin-change", "change", "self", "received", "unknown"];
export type OriginCounts = Record<CoinClass, { count: number; sats: number }>;

export interface WalletGraph {
  own: ReadonlySet<string>;
  /** Every scanned tx once, by txid */
  txs: ReadonlyMap<string, MempoolTransaction>;
  /** isCoinJoinTx, memoized per txid */
  isCoinJoin: (tx: MempoolTransaction) => boolean;
}

export function buildWalletGraph(infos: readonly WalletAddressInfo[]): WalletGraph {
  const own = new Set(infos.map((i) => i.derived.address));
  const txs = new Map<string, MempoolTransaction>();
  for (const info of infos) for (const tx of info.txs) if (!txs.has(tx.txid)) txs.set(tx.txid, tx);
  const memo = new Map<string, boolean>();
  const isCoinJoin = (tx: MempoolTransaction) => {
    let v = memo.get(tx.txid);
    if (v === undefined) memo.set(tx.txid, (v = isCoinJoinTx(tx)));
    return v;
  };
  return { own, txs, isCoinJoin };
}

export const isOwn = (g: WalletGraph, address: string | undefined): boolean =>
  address !== undefined && g.own.has(address);

/**
 * Where output `vout` of `txid` came from. "unknown" when that tx is not in
 * the scanned history (truncated history): unknown never triggers a finding.
 */
export function coinClass(g: WalletGraph, txid: string, vout: number): CoinClass {
  const tx = g.txs.get(txid);
  const out = tx?.vout[vout];
  if (!tx || !out) return "unknown";
  if (g.isCoinJoin(tx)) {
    return tx.vout.filter((o) => o.value === out.value).length >= 2 ? "mixed" : "coinjoin-change";
  }
  if (!tx.vin.some((v) => isOwn(g, v.prevout?.scriptpubkey_address))) return "received";
  const toxic = detectTx0(tx)?.toxicChange;
  if (toxic && tx.vout.indexOf(toxic) === vout) return "coinjoin-change";
  const paysOthers = tx.vout.some((o) => o.scriptpubkey_address !== undefined && !g.own.has(o.scriptpubkey_address));
  return paysOthers ? "change" : "self";
}

/** Oldest first (unconfirmed last), ties by txid, so finding tx lists are stable. */
function chronological(a: MempoolTransaction, b: MempoolTransaction): number {
  const h = (t: MempoolTransaction) => t.status.block_height ?? Number.MAX_SAFE_INTEGER;
  return h(a) - h(b) || (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : 0);
}

/**
 * Transactions the wallet built alone: every input is the wallet's and it is
 * not a CoinJoin. A tx with any outside input is skipped, never labelled.
 */
export function soloSpends(g: WalletGraph): MempoolTransaction[] {
  return [...g.txs.values()]
    .filter((tx) => tx.vin.length > 0 && tx.vin.every((v) => isOwn(g, v.prevout?.scriptpubkey_address)) && !g.isCoinJoin(tx))
    .sort(chronological);
}

export interface SimplePayment {
  tx: MempoolTransaction;
  change: MempoolVout;
  payment: MempoolVout;
}

/** Solo spends with exactly one output to the wallet (change) and one to someone else; tx0s excluded. */
export function simplePayments(g: WalletGraph, spends: readonly MempoolTransaction[]): SimplePayment[] {
  const out: SimplePayment[] = [];
  for (const tx of spends) {
    const addressed = tx.vout.filter((o) => o.scriptpubkey_address !== undefined);
    const mine = addressed.filter((o) => isOwn(g, o.scriptpubkey_address));
    const theirs = addressed.filter((o) => !isOwn(g, o.scriptpubkey_address));
    if (mine.length !== 1 || theirs.length !== 1 || detectTx0(tx)) continue;
    out.push({ tx, change: mine[0]!, payment: theirs[0]! });
  }
  return out;
}

/** Unspent coins by class: count and sats. */
export function utxoOrigins(g: WalletGraph, infos: readonly WalletAddressInfo[]): OriginCounts {
  const r = Object.fromEntries(COIN_CLASSES.map((c) => [c, { count: 0, sats: 0 }])) as OriginCounts;
  for (const info of infos) {
    for (const u of info.utxos) {
      const slot = r[coinClass(g, u.txid, u.vout)];
      slot.count++;
      slot.sats += u.value;
    }
  }
  return r;
}
