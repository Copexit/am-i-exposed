/**
 * Quick refresh of a saved wallet scan: only what can have changed since the
 * snapshot is fetched, instead of walking the whole gap limit again.
 *
 * Phase 1 (quickRefresh, blocking):
 * 1. Tip height (confirmations are computed from it).
 * 2. Addresses holding an unconfirmed tx, or a tx with fewer than
 *    CONFIRM_DEPTH confirmations at the saved tip (reorg-safe), are refetched.
 * 3. Saved addresses with no history at or below the last used index (invoice
 *    addresses handed out earlier) get one cheap address check each.
 * 4. Per chain, the addresses after the last used index are checked in a window
 *    of min(REFRESH_WINDOW, gap limit), extended past each used one found.
 * 5. An address whose saved coin is spent by a tx fetched above is refetched too.
 *
 * Phase 2 (background, cancellable):
 * - verifyCoins: every other address holding a saved coin gets one UTXO-list
 *   request; a spent coin or a new one (a payment to that reused address)
 *   refetches the address.
 * - extendFrontier: on a chain where phase 1 found activity, the walk goes on
 *   until the full saved gap limit of consecutive unused addresses, as the full scan does.
 *
 * Not seen until the weekly full rescan (FULL_RESCAN_AFTER_MS):
 * - a new payment to an address that already has history but holds no saved coin;
 * - activity more than REFRESH_WINDOW unused addresses past the last used one,
 *   when the saved gap limit is larger and nothing nearer is used (the window
 *   trades that depth for a short phase 1 on hosted APIs).
 */

import { deriveOneAddress, type DerivedAddress, type ParsedXpub } from "@/lib/bitcoin/descriptor";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { MempoolClient } from "@/lib/api/mempool";
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
  /** Where phase 1 stopped per chain, for extendFrontier (only chains with new activity) */
  frontier: Frontier[];
}

/** A chain's walk position: next index to check, and unused addresses in a row before it. */
export interface Frontier { chain: 0 | 1; next: number; unused: number }

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

/** Run `fn` over `items` with at most `n` in flight; results keep input order. The first failure stops all workers. */
async function mapPool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (e) {
        failed = true;
        throw e;
      }
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
  { signal, local, window = Math.min(REFRESH_WINDOW, snap.gapLimit), pace = refreshPacer(local, signal) }:
    { signal?: AbortSignal; local: boolean; window?: number; pace?: Pace },
): Promise<RefreshResult> {
  const concurrency = local ? 6 : 3;
  const paced = pacedClient(api, pace);

  const byAddr = new Map(snap.infos.map(i => [i.derived.address, i]));
  const dirty = new Map<string, DerivedAddress>();
  const mark = (d: DerivedAddress) => dirty.set(d.address, d);
  const fetched = new Set<string>();
  /** Refetch every marked address not fetched yet. */
  const fetchDirty = () => mapPool([...dirty.values()].filter(d => !fetched.has(d.address)), concurrency, async d => {
    fetched.add(d.address);
    byAddr.set(d.address, await fetchAddress(paced, d));
  });

  const tipHeight = (await pace(getTipHeight)) ?? snap.tipHeight;

  // Unconfirmed and shallow txs
  const savedTip = snap.tipHeight ?? tipHeight;
  for (const info of snap.infos) {
    for (const tx of info.txs) {
      const h = tx.status?.block_height;
      if (!tx.status?.confirmed || h === undefined || (savedTip !== null && h > savedTip - CONFIRM_DEPTH)) mark(info.derived);
    }
  }

  // Unused addresses below the frontier (late payments to earlier invoices)
  const gaps = snap.infos.filter(i => !isUsed(i) && i.derived.index <= snap.lastUsed[i.derived.isChange ? 1 : 0]);
  await mapPool(gaps, concurrency, async (i) => {
    const addressData = await paced.getAddress(i.derived.address);
    if (isUsed({ addressData, txs: [] })) mark(i.derived);
    else byAddr.set(i.derived.address, { ...i, addressData });
  });

  // Frontier: past the last used index on each chain
  const frontier: Frontier[] = [];
  for (const chain of chains) {
    const f = await walk(parsed, chain, snap.lastUsed[chain] + 1, 0, window, paced, concurrency, signal, byAddr, mark);
    if (f.found) frontier.push({ chain, next: f.next, unused: f.unused });
  }

  await fetchDirty();

  // A fetched tx spending a saved coin: refetch the coin's address (stats, history, coins)
  const owner = new Map<string, WalletAddressInfo>();
  for (const info of snap.infos) for (const u of info.utxos) owner.set(coinId(u.txid, u.vout), info);
  for (const a of fetched) {
    for (const tx of byAddr.get(a)!.txs) {
      for (const vin of tx.vin) {
        const info = owner.get(coinId(vin.txid, vin.vout));
        if (info) mark(info.derived);
      }
    }
  }
  await fetchDirty();

  const saved = snap.infos.flatMap(i => i.utxos.map(u => ({ txid: u.txid, vout: u.vout, address: i.derived.address })));
  const pending = saved.filter(c => !fetched.has(c.address));
  return { infos: sortInfos(byAddr.values()), tipHeight, pending, coins: saved.length, frontier };
}

/** Check addresses from `next` until `limit` consecutive unused ones; used ones are marked for a refetch. */
async function walk(
  parsed: ParsedXpub, chain: 0 | 1, next: number, unused: number, limit: number, api: MempoolClient, concurrency: number,
  signal: AbortSignal | undefined, byAddr: Map<string, WalletAddressInfo>, mark: (d: DerivedAddress) => void,
): Promise<{ next: number; unused: number; found: boolean }> {
  let found = false;
  while (unused < limit) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = Array.from({ length: limit - unused }, (_, k) => deriveOneAddress(parsed, chain, next + k));
    next += batch.length;
    const data = await mapPool(batch, concurrency, d => api.getAddress(d.address));
    batch.forEach((derived, k) => {
      const addressData = data[k]!;
      if (isUsed({ addressData, txs: [] })) {
        mark(derived);
        unused = 0;
        found = true;
      } else {
        unused++;
        byAddr.set(derived.address, { derived, txs: [], utxos: [], addressData });
      }
    });
  }
  return { next, unused, found };
}

/**
 * Phase 2, after new activity on a chain: continue phase 1's walk until the
 * saved gap limit of consecutive unused addresses (the full scan's stop rule).
 */
export async function extendFrontier(
  infos: readonly WalletAddressInfo[],
  parsed: ParsedXpub,
  frontier: readonly Frontier[],
  gapLimit: number,
  api: MempoolClient,
  { signal, local, pace = refreshPacer(local, signal) }: { signal?: AbortSignal; local: boolean; pace?: Pace },
): Promise<WalletAddressInfo[]> {
  const concurrency = local ? 6 : 3;
  const paced = pacedClient(api, pace);
  const byAddr = new Map(infos.map(i => [i.derived.address, i]));
  const dirty = new Map<string, DerivedAddress>();
  for (const f of frontier) {
    await walk(parsed, f.chain, f.next, f.unused, gapLimit, paced, concurrency, signal, byAddr, (d) => dirty.set(d.address, d));
  }
  await mapPool([...dirty.values()], concurrency, async d => { byAddr.set(d.address, await fetchAddress(paced, d)); });
  return sortInfos(byAddr.values());
}

/**
 * Phase 2: verify `pending` coins with one UTXO-list request per address (so a
 * new payment to that address is caught too), reporting progress after each
 * request and the updated infos whenever an address changed. Throws AbortError
 * when cancelled; the first failure stops all workers.
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
  const byAddress = new Map<string, number>();
  for (const c of pending) byAddress.set(c.address, (byAddress.get(c.address) ?? 0) + 1);
  let done = 0;

  await mapPool([...byAddress], concurrency, async ([address, count]) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const now = (await paced.getAddressUtxos(address)).map(u => coinId(u.txid, u.vout)).sort();
    const before = cur.get(address)!.utxos.map(u => coinId(u.txid, u.vout)).sort();
    const changed = now.join() !== before.join();
    if (changed) cur.set(address, await fetchAddress(paced, cur.get(address)!.derived));
    done += count;
    onProgress(done, changed ? sortInfos(cur.values()) : null);
  });
  return sortInfos(cur.values());
}
