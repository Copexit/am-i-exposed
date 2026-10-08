/**
 * Quick refresh of a saved wallet scan: only what can have changed since the
 * snapshot is fetched, instead of walking the whole gap limit again.
 *
 * Phase 1 (quickRefresh, blocking, a few dozen requests):
 * 1. Tip height (confirmations are computed from it).
 * 2. Addresses holding an unconfirmed tx, or a tx with fewer than
 *    CONFIRM_DEPTH confirmations at the saved tip (reorg-safe), are refetched.
 * 3. Per chain, the addresses after the last used index are checked in a
 *    window of REFRESH_WINDOW (or the saved gap limit, if lower); a used one is
 *    refetched and the window extends until that many consecutive unused addresses.
 * 4. A fetched tx that spends a saved coin marks it spent at once (its inputs are known).
 *
 * Phase 2 (verifyCoins, background, cancellable): every other saved coin is
 * verified, with one UTXO-list request per address or one outspends request
 * per funding tx, whichever needs fewer; an address with a change is refetched.
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

/** A saved coin and the address holding it. */
export interface Coin { txid: string; vout: number; address: string }

export interface RefreshResult {
  infos: WalletAddressInfo[];
  tipHeight: number | null;
  /** Saved coins phase 1 did not verify: phase 2's input */
  pending: Coin[];
  /** Saved coins in total */
  coins: number;
}

export type Pace = <T>(fn: () => Promise<T>) => Promise<T>;

/** One pacer for both phases (hosted APIs share one budget). */
export function refreshPacer(local: boolean, signal?: AbortSignal): Pace {
  return local ? (fn) => fn() : createPacer(HOSTED_BURST, HOSTED_INTERVAL_MS, signal);
}

function pacedClient(api: MempoolClient, pace: Pace): MempoolClient {
  return {
    ...api,
    getAddress: (a) => pace(() => api.getAddress(a)),
    getAddressUtxos: (a) => pace(() => api.getAddressUtxos(a)),
    getAddressTxs: (a, p) => pace(() => api.getAddressTxs(a, p)),
    getTxOutspends: (t) => pace(() => api.getTxOutspends(t)),
  };
}

const coinId = (txid: string, vout: number) => `${txid}:${vout}`;
const sortInfos = (infos: Iterable<WalletAddressInfo>) => [...infos].sort((a, b) =>
  Number(a.derived.isChange) - Number(b.derived.isChange) || a.derived.index - b.derived.index);

/** Txids in `infos` that `before` did not have. */
export function newTxids(before: readonly WalletAddressInfo[], infos: readonly WalletAddressInfo[]): string[] {
  const known = new Set(before.flatMap(i => i.txs.map(t => t.txid)));
  return [...new Set(infos.flatMap(i => i.txs.map(t => t.txid)))].filter(id => !known.has(id));
}

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
 * Phase 1. `api` must not be served from the response cache (address and
 * outspend entries live up to 12 h there): pass an uncached client.
 */
export async function quickRefresh(
  snap: WalletSnapshot,
  parsed: ParsedXpub,
  chains: readonly (0 | 1)[],
  api: MempoolClient,
  getTipHeight: () => Promise<number | null>,
  // Never looks further ahead than the full scan did (hosted scans default to a gap of 5)
  { signal, local, window = Math.min(REFRESH_WINDOW, snap.gapLimit), pace = refreshPacer(local, signal) }:
    { signal?: AbortSignal; local: boolean; window?: number; pace?: Pace },
): Promise<RefreshResult> {
  const concurrency = local ? 6 : 3;
  const paced = pacedClient(api, pace);

  const byAddr = new Map(snap.infos.map(i => [i.derived.address, i]));
  const dirty = new Map<string, DerivedAddress>();
  const mark = (d: DerivedAddress) => dirty.set(d.address, d);

  const tipHeight = (await pace(getTipHeight)) ?? snap.tipHeight;

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

  // A fetched tx spending a saved coin: the coin is spent, its address gets the tx
  const owner = new Map<string, WalletAddressInfo>();
  for (const info of snap.infos) {
    if (dirty.has(info.derived.address)) continue;
    for (const u of info.utxos) owner.set(coinId(u.txid, u.vout), info);
  }
  const verified = new Set<string>();
  for (const d of dirty.keys()) {
    for (const tx of byAddr.get(d)!.txs) {
      for (const vin of tx.vin) {
        const id = coinId(vin.txid, vin.vout);
        const info = owner.get(id);
        if (!info) continue;
        const cur = byAddr.get(info.derived.address)!;
        // ponytail: address stats stay as saved until the next refetch; the audit reads txs and utxos
        byAddr.set(info.derived.address, {
          ...cur,
          utxos: cur.utxos.filter(u => coinId(u.txid, u.vout) !== id),
          txs: cur.txs.some(t => t.txid === tx.txid) ? cur.txs : [tx, ...cur.txs],
        });
        verified.add(id);
      }
    }
  }

  const saved = snap.infos.flatMap(i => i.utxos.map(u => ({ txid: u.txid, vout: u.vout, address: i.derived.address })));
  const pending = saved.filter(c => !dirty.has(c.address) && !verified.has(coinId(c.txid, c.vout)));
  return { infos: sortInfos(byAddr.values()), tipHeight, pending, coins: saved.length };
}

/**
 * Phase 2: verify `pending` coins, reporting progress after each request and
 * the updated infos whenever an address changed. Throws AbortError when cancelled.
 */
export async function verifyCoins(
  infos: readonly WalletAddressInfo[],
  pending: readonly Coin[],
  api: MempoolClient,
  { signal, local, pace = refreshPacer(local, signal) }: { signal?: AbortSignal; local: boolean; pace?: Pace },
  onProgress: (done: number, infos: WalletAddressInfo[] | null) => void,
): Promise<WalletAddressInfo[]> {
  const concurrency = local ? 6 : 3;
  const paced = pacedClient(api, pace);
  const cur = new Map(infos.map(i => [i.derived.address, i]));
  const group = (key: (c: Coin) => string) => {
    const m = new Map<string, Coin[]>();
    for (const c of pending) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
    return m;
  };
  const byAddress = group(c => c.address);
  const byTx = group(c => c.txid);
  const useAddresses = byAddress.size <= byTx.size;
  let done = 0;

  await mapPool([...(useAddresses ? byAddress : byTx)], concurrency, async ([key, coins]) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const changed = new Set<string>();
    if (useAddresses) {
      const now = new Set((await paced.getAddressUtxos(key)).map(u => coinId(u.txid, u.vout)));
      const before = new Set(cur.get(key)!.utxos.map(u => coinId(u.txid, u.vout)));
      // A spent coin, or a new one (a payment to this already used address)
      if (coins.some(c => !now.has(coinId(c.txid, c.vout))) || [...now].some(id => !before.has(id))) changed.add(key);
    } else {
      let outs: MempoolOutspend[] | null;
      try {
        outs = await paced.getTxOutspends(key);
      } catch (e) {
        // A dropped or replaced unconfirmed funding tx
        if (!(e instanceof ApiError && e.code === "NOT_FOUND")) throw e;
        outs = null;
      }
      for (const c of coins) if (!outs || outs[c.vout]?.spent) changed.add(c.address);
    }
    for (const a of changed) cur.set(a, await fetchAddress(paced, cur.get(a)!.derived));
    done += coins.length;
    onProgress(done, changed.size > 0 ? sortInfos(cur.values()) : null);
  });
  return sortInfos(cur.values());
}
