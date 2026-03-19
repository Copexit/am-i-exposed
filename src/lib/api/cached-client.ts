/**
 * Cached mempool client wrapper.
 *
 * Wraps a MempoolClient with transparent IndexedDB caching.
 * Returns the same interface so consumers need zero code changes.
 *
 * Cache key format: {network}:{type}:{identifier}
 * - Confirmed transactions: infinite TTL (immutable)
 * - Unconfirmed transactions: 10 min TTL
 * - Tx hex: infinite TTL
 * - Outspends: 1h TTL
 * - Historical prices: infinite TTL
 * - Address data/UTXOs/txs: adaptive TTL (10 min to 12h based on activity)
 */

import { createMempoolClient, type MempoolClient, type MempoolClientOptions } from "./mempool";
import { idbGet, idbPut } from "./idb-cache";
import { getAnalysisSettings } from "@/hooks/useAnalysisSettings";
import type { MempoolTransaction } from "./types";

/** TTL constants in milliseconds. */
const TTL_10_MIN = 10 * 60 * 1000;
const TTL_1_HOUR = 60 * 60 * 1000;
const TTL_12_HOURS = 12 * 60 * 60 * 1000;

/**
 * Derive the network name from a mempool.space base URL.
 * - Contains "/testnet4/" -> "testnet4"
 * - Contains "/signet/" -> "signet"
 * - Otherwise -> "mainnet"
 */
export function networkFromUrl(url: string): string {
  if (url.includes("/testnet4")) return "testnet4";
  if (url.includes("/signet")) return "signet";
  return "mainnet";
}

/** Compute adaptive TTL for address txs based on activity recency. */
function computeAddressTxsTtl(txs: MempoolTransaction[]): number {
  if (txs.length === 0) return TTL_10_MIN;

  // Any unconfirmed tx -> short TTL
  if (txs.some(tx => !tx.status?.confirmed)) return TTL_10_MIN;

  // All confirmed - check most recent block_time
  const mostRecentBlockTime = Math.max(
    ...txs.map(tx => tx.status?.block_time ?? 0),
  );
  if (mostRecentBlockTime === 0) return TTL_10_MIN;

  const ageMs = Date.now() - mostRecentBlockTime * 1000;
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  if (ageMs > THIRTY_DAYS) return TTL_12_HOURS;
  if (ageMs > SEVEN_DAYS) return TTL_1_HOUR;
  return TTL_10_MIN;
}

/**
 * Cache-or-fetch helper. Checks IDB cache first (if caching is enabled),
 * falls back to the fetch function, then stores the result with the given TTL.
 * The ttlFn receives the fetched value so TTL can adapt to the data.
 */
async function withIdbCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttlFn?: (value: T) => number | undefined,
): Promise<T> {
  const { enableCache } = getAnalysisSettings();
  if (enableCache) {
    const cached = await idbGet<T>(key);
    if (cached !== undefined) return cached;
  }

  const value = await fn();
  if (enableCache) {
    const ttl = ttlFn ? ttlFn(value) : undefined;
    // Negative TTL signals "don't cache this result"
    if (ttl === undefined || ttl >= 0) {
      idbPut(key, value, ttl).catch((e) => console.warn("cache write failed:", e));
    }
  }
  return value;
}

/**
 * Create a MempoolClient with transparent IndexedDB caching.
 * All methods have the same signature as the base MempoolClient.
 */
export function createCachedMempoolClient(
  baseUrl: string,
  network?: string,
  options?: MempoolClientOptions,
): MempoolClient {
  const inner = createMempoolClient(baseUrl, options);
  const net = network ?? networkFromUrl(baseUrl);

  return {
    getTransaction(txid: string) {
      return withIdbCache(
        `${net}:tx:${txid}`,
        () => inner.getTransaction(txid),
        (tx) => tx.status?.confirmed ? undefined : TTL_10_MIN,
      );
    },

    getTxHex(txid: string) {
      return withIdbCache(`${net}:txhex:${txid}`, () => inner.getTxHex(txid));
    },

    getAddress(address: string) {
      return withIdbCache(
        `${net}:addr:${address}`,
        () => inner.getAddress(address),
        (data) => {
          if (data.mempool_stats?.tx_count > 0) return TTL_10_MIN;
          if (data.chain_stats?.tx_count > 0) return TTL_1_HOUR;
          return TTL_10_MIN;
        },
      );
    },

    getAddressTxs(address: string, maxPages?: number) {
      return withIdbCache(
        `${net}:addrtxs:${address}:${maxPages ?? 4}`,
        () => inner.getAddressTxs(address, maxPages),
        (txs) => computeAddressTxsTtl(txs),
      );
    },

    getAddressUtxos(address: string) {
      return withIdbCache(
        `${net}:utxo:${address}`,
        () => inner.getAddressUtxos(address),
        (utxos) => {
          const allConfirmed = utxos.length > 0 && utxos.every(u => u.status?.confirmed);
          return allConfirmed ? TTL_1_HOUR : TTL_10_MIN;
        },
      );
    },

    getTxOutspends(txid: string) {
      return withIdbCache(
        `${net}:outspend:${txid}`,
        () => inner.getTxOutspends(txid),
        () => TTL_1_HOUR,
      );
    },

    getHistoricalPrice(timestamp: number) {
      return withIdbCache(
        `${net}:price:usd:${Math.floor(timestamp)}`,
        () => inner.getHistoricalPrice(timestamp),
        (price) => price !== null ? undefined : -1,
      );
    },

    getHistoricalEurPrice(timestamp: number) {
      return withIdbCache(
        `${net}:price:eur:${Math.floor(timestamp)}`,
        () => inner.getHistoricalEurPrice(timestamp),
        (price) => price !== null ? undefined : -1,
      );
    },

    getAddressPrefix(prefix: string) {
      return inner.getAddressPrefix(prefix);
    },
  };
}
