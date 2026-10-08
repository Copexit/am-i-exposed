/**
 * Wallet behaviour model: the scanned history as one graph, each coin paid to
 * the wallet classified by where it came from, and the transactions the
 * wallet built alone. Pure: computed from the scan data only, no requests.
 * See docs/spec-wallet-heuristics.md.
 */
import type { MempoolTransaction, MempoolVout } from "@/lib/api/types";
import type { WalletAddressInfo } from "./wallet-audit";
import { isCoinJoinTx } from "./heuristics/coinjoin";
import { detectTx0, type Tx0Match } from "./heuristics/coinjoin-premix";
import { detectWhirlpool } from "./heuristics/coinjoin-detectors";
import { getSpendableOutputs } from "./heuristics/tx-utils";

export type CoinClass = "mixed" | "coinjoin-change" | "change" | "self" | "received" | "unknown";
/**
 * Change, for the "spend change on its own" rule (coin selector) and W2 alike:
 * change of a payment, an output of a self-transfer, CoinJoin change.
 */
export const isChangeClass = (c: CoinClass | undefined): boolean => c === "change" || c === "self" || c === "coinjoin-change";
export const COIN_CLASSES: readonly CoinClass[] = ["mixed", "coinjoin-change", "change", "self", "received", "unknown"];
export type OriginCounts = Record<CoinClass, { count: number; sats: number }>;

export interface WalletGraph {
  own: ReadonlySet<string>;
  /** Every scanned tx once, by txid */
  txs: ReadonlyMap<string, MempoolTransaction>;
  /**
   * isCoinJoinTx, memoized per txid. A tx funded only by the wallet counts
   * only when an equal-value output returns to the wallet (a solo Stonewall's
   * decoy): an own batch paying several people the same amount is not one.
   */
  isCoinJoin: (tx: MempoolTransaction) => boolean;
  /** detectTx0, memoized per txid */
  tx0: (tx: MempoolTransaction) => Tx0Match | null;
}

export function buildWalletGraph(infos: readonly WalletAddressInfo[]): WalletGraph {
  const own = new Set(infos.map((i) => i.derived.address));
  const txs = new Map<string, MempoolTransaction>();
  for (const info of infos) for (const tx of info.txs) if (!txs.has(tx.txid)) txs.set(tx.txid, tx);
  const mine = (a: string | undefined) => a !== undefined && own.has(a);
  const coinJoinTx = (tx: MempoolTransaction) => {
    if (!isCoinJoinTx(tx)) return false;
    if (!tx.vin.every((v) => mine(v.prevout?.scriptpubkey_address))) return true;
    return tx.vout.some((o) => mine(o.scriptpubkey_address) && tx.vout.some((p) => p !== o && p.value === o.value));
  };
  const cjMemo = new Map<string, boolean>();
  const isCoinJoin = (tx: MempoolTransaction) => {
    let v = cjMemo.get(tx.txid);
    if (v === undefined) cjMemo.set(tx.txid, (v = coinJoinTx(tx)));
    return v;
  };
  const tx0Memo = new Map<string, Tx0Match | null>();
  const tx0 = (tx: MempoolTransaction) => {
    let v = tx0Memo.get(tx.txid);
    if (v === undefined) tx0Memo.set(tx.txid, (v = detectTx0(tx)));
    return v;
  };
  return { own, txs, isCoinJoin, tx0 };
}

export const isOwn = (g: WalletGraph, address: string | undefined): boolean =>
  address !== undefined && g.own.has(address);

/**
 * Where output `vout` of `txid` came from. "unknown" when that tx is not in
 * the scanned history (truncated history), or when the wallet funded only
 * part of it (collaborative or PayJoin-shaped: never labelled). Unknown never
 * triggers a finding.
 */
export function coinClass(g: WalletGraph, txid: string, vout: number): CoinClass {
  const tx = g.txs.get(txid);
  const out = tx?.vout[vout];
  if (!tx || !out) return "unknown";
  const ownInputs = tx.vin.filter((v) => isOwn(g, v.prevout?.scriptpubkey_address)).length;
  if (g.isCoinJoin(tx)) {
    // Paid by someone else's CoinJoin (a JoinMarket taker, a payment in a
    // round): a receipt. Whirlpool still mixes into another account (postmix)
    // with no input from it, so its equal outputs stay mixed.
    if (ownInputs === 0 && !detectWhirlpool(getSpendableOutputs(tx.vout).map((o) => o.value))) return "received";
    return tx.vout.filter((o) => o.value === out.value).length >= 2 ? "mixed" : "coinjoin-change";
  }
  if (ownInputs === 0) return "received";
  if (ownInputs < tx.vin.length) return "unknown";
  const toxic = g.tx0(tx)?.toxicChange;
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
    if (mine.length !== 1 || theirs.length !== 1 || g.tx0(tx)) continue;
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
