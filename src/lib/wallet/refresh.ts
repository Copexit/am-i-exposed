/**
 * Quick refresh of a saved wallet scan: only what can have changed since the
 * snapshot is fetched, instead of walking the whole gap limit again.
 *
 * 1. Tip height (confirmations are computed from it).
 * 2. Outspends of each saved UTXO's funding tx (one request per txid): a spent
 *    coin marks its address for a refetch, which brings in the spending tx.
 * 3. Addresses holding an unconfirmed tx, or a tx with fewer than
 *    CONFIRM_DEPTH confirmations at the saved tip (reorg-safe), are refetched.
 * 4. Per chain, the addresses after the last used index are checked in a
 *    window of REFRESH_WINDOW; a used one is refetched and the window extends
 *    until REFRESH_WINDOW consecutive unused addresses.
 *
 * Not seen: a new payment to an already used address below the frontier that
 * holds no saved coin. The weekly full rescan (FULL_RESCAN_AFTER_MS) covers it.
 */

import { deriveOneAddress, type DerivedAddress, type ParsedXpub } from "@/lib/bitcoin/descriptor";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { MempoolClient } from "@/lib/api/mempool";
import type { MempoolOutspend } from "@/lib/api/types";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { abortableSleep } from "@/lib/abort-signal";
import { fetchAddress } from "./scan";
import type { WalletSnapshot } from "./saved-wallets";

/** Consecutive unused addresses checked past the last used one. */
export const REFRESH_WINDOW = 20;
/** Txs shallower than this at the saved tip are rechecked (reorgs). */
export const CONFIRM_DEPTH = 6;
/** Hosted API budget, as the full scan: a burst of 18 requests, then one every 3 s. */
const HOSTED_BURST = 18;
const HOSTED_INTERVAL_MS = 3000;

export interface RefreshResult {
  infos: WalletAddressInfo[];
  tipHeight: number | null;
  /** Txids not in the snapshot */
  newTxids: string[];
}

type Pace = <T>(fn: () => Promise<T>) => Promise<T>;

/** Token bucket: `burst` immediate calls, then one per `intervalMs`. */
export function createPacer(burst: number, intervalMs: number, signal?: AbortSignal): Pace {
  let tokens = burst;
  let last = Date.now();
  let queue: Promise<void> = Promise.resolve();
  return (fn) => {
    const turn = queue.then(async () => {
      const now = Date.now();
      tokens = Math.min(burst, tokens + (now - last) / intervalMs);
      last = now;
      if (tokens < 1) {
        await abortableSleep((1 - tokens) * intervalMs, signal);
        tokens = 1;
        last = Date.now();
      }
      tokens -= 1;
    });
    queue = turn.catch(() => {});
    return turn.then(fn);
  };
}

/** Run `fn` over `items` with at most `n` in flight; results keep input order. */
async function mapPool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const isUsed = (i: Pick<WalletAddressInfo, "addressData" | "txs">) =>
  i.txs.length > 0 || (!!i.addressData && i.addressData.chain_stats.tx_count + i.addressData.mempool_stats.tx_count > 0);

/**
 * `api` must not be served from the response cache (address and outspend
 * entries live up to 12 h there): pass an uncached client.
 */
export async function quickRefresh(
  snap: WalletSnapshot,
  parsed: ParsedXpub,
  chains: readonly (0 | 1)[],
  api: MempoolClient,
  getTipHeight: () => Promise<number | null>,
  { signal, local, window = REFRESH_WINDOW }: { signal?: AbortSignal; local: boolean; window?: number },
): Promise<RefreshResult> {
  const pace: Pace = local ? (fn) => fn() : createPacer(HOSTED_BURST, HOSTED_INTERVAL_MS, signal);
  const concurrency = local ? 6 : 3;
  const paced: MempoolClient = {
    ...api,
    getAddress: (a) => pace(() => api.getAddress(a)),
    getAddressUtxos: (a) => pace(() => api.getAddressUtxos(a)),
    getAddressTxs: (a, p) => pace(() => api.getAddressTxs(a, p)),
    getTxOutspends: (t) => pace(() => api.getTxOutspends(t)),
  };

  const byAddr = new Map(snap.infos.map(i => [i.derived.address, i]));
  const dirty = new Map<string, DerivedAddress>();
  const mark = (d: DerivedAddress) => dirty.set(d.address, d);

  const tipHeight = (await pace(getTipHeight)) ?? snap.tipHeight;

  // Spends of saved coins
  const owners = new Map<string, { vout: number; info: WalletAddressInfo }[]>();
  for (const info of snap.infos) {
    for (const u of info.utxos) owners.set(u.txid, [...(owners.get(u.txid) ?? []), { vout: u.vout, info }]);
  }
  await mapPool([...owners], concurrency, async ([txid, coins]) => {
    let outs: MempoolOutspend[] | null;
    try {
      outs = await paced.getTxOutspends(txid);
    } catch (e) {
      // A dropped or replaced unconfirmed funding tx: refetch its addresses
      if (!(e instanceof ApiError && e.code === "NOT_FOUND")) throw e;
      outs = null;
    }
    for (const { vout, info } of coins) if (!outs || outs[vout]?.spent) mark(info.derived);
  });

  // Unconfirmed and shallow txs
  const savedTip = snap.tipHeight ?? tipHeight;
  for (const info of snap.infos) {
    for (const tx of info.txs) {
      const h = tx.status?.block_height;
      if (!tx.status?.confirmed || h === undefined || (savedTip !== null && h > savedTip - CONFIRM_DEPTH)) mark(info.derived);
    }
  }

  // Frontier: past the last used index on each chain
  for (const chain of chains) {
    let next = snap.lastUsed[chain] + 1;
    let unused = 0;
    while (unused < window) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const batch = Array.from({ length: window - unused }, (_, k) => deriveOneAddress(parsed, chain, next + k));
      next += batch.length;
      const data = await mapPool(batch, concurrency, d => paced.getAddress(d.address));
      batch.forEach((derived, k) => {
        const addressData = data[k]!;
        if (isUsed({ addressData, txs: [] })) {
          mark(derived);
          unused = 0;
        } else {
          unused++;
          byAddr.set(derived.address, { derived, txs: [], utxos: [], addressData });
        }
      });
    }
  }

  await mapPool([...dirty.values()], concurrency, async d => {
    byAddr.set(d.address, await fetchAddress(paced, d));
  });

  const infos = [...byAddr.values()].sort((a, b) =>
    Number(a.derived.isChange) - Number(b.derived.isChange) || a.derived.index - b.derived.index);
  const known = new Set(snap.infos.flatMap(i => i.txs.map(t => t.txid)));
  const newTxids = [...new Set(infos.flatMap(i => i.txs.map(t => t.txid)))].filter(id => !known.has(id));
  return { infos, tipHeight, newTxids };
}
