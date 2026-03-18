/**
 * Cached mempool client for CLI.
 *
 * Mirrors src/lib/api/cached-client.ts but uses SQLite instead of IndexedDB.
 * Same cache key format, same TTL strategy, same withCache pattern.
 */

import {
  createMempoolClient,
  type MempoolClient,
  type MempoolClientOptions,
} from "@/lib/api/mempool";
import type { MempoolTransaction } from "@/lib/api/types";
import { cacheGet, cacheSet } from "./sqlite-cache";

/** TTL constants in milliseconds (same as cached-client.ts). */
const TTL_10_MIN = 10 * 60 * 1000;
const TTL_1_HOUR = 60 * 60 * 1000;
const TTL_12_HOURS = 12 * 60 * 60 * 1000;

/** Derive network name from URL (same as cached-client.ts). */
function networkFromUrl(url: string): string {
  if (url.includes("/testnet4")) return "testnet4";
  if (url.includes("/signet")) return "signet";
  return "mainnet";
}

/** Adaptive TTL for address txs based on activity recency. */
function computeAddressTxsTtl(txs: MempoolTransaction[]): number {
  if (txs.length === 0) return TTL_10_MIN;
  if (txs.some((tx) => !tx.status?.confirmed)) return TTL_10_MIN;

  const mostRecentBlockTime = Math.max(
    ...txs.map((tx) => tx.status?.block_time ?? 0),
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
 * Cache-or-fetch helper. Checks SQLite cache first, falls back to fetch,
 * then stores the result. Same pattern as withIdbCache in cached-client.ts.
 */
async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttlFn?: (value: T) => number | undefined,
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;

  const value = await fn();
  const ttl = ttlFn ? ttlFn(value) : undefined;
  // Negative TTL signals "don't cache"
  if (ttl === undefined || ttl >= 0) {
    cacheSet(key, value, ttl);
  }
  return value;
}

/**
 * Create a MempoolClient with transparent SQLite caching.
 * Same interface as createCachedMempoolClient in cached-client.ts.
 */
export function createCachedNodeClient(
  baseUrl: string,
  network?: string,
  options?: MempoolClientOptions,
): MempoolClient {
  const inner = createMempoolClient(baseUrl, options);
  const net = network ?? networkFromUrl(baseUrl);

  return {
    getTransaction(txid: string) {
      return withCache(
        `${net}:tx:${txid}`,
        () => inner.getTransaction(txid),
        (tx) => (tx.status?.confirmed ? undefined : TTL_10_MIN),
      );
    },

    getTxHex(txid: string) {
      return withCache(`${net}:txhex:${txid}`, () => inner.getTxHex(txid));
    },

    getAddress(address: string) {
      return withCache(
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
      return withCache(
        `${net}:addrtxs:${address}:${maxPages ?? 4}`,
        () => inner.getAddressTxs(address, maxPages),
        (txs) => computeAddressTxsTtl(txs),
      );
    },

    getAddressUtxos(address: string) {
      return withCache(
        `${net}:utxo:${address}`,
        () => inner.getAddressUtxos(address),
        (utxos) => {
          const allConfirmed =
            utxos.length > 0 && utxos.every((u) => u.status?.confirmed);
          return allConfirmed ? TTL_1_HOUR : TTL_10_MIN;
        },
      );
    },

    getTxOutspends(txid: string) {
      return withCache(
        `${net}:outspend:${txid}`,
        () => inner.getTxOutspends(txid),
        () => TTL_1_HOUR,
      );
    },

    getHistoricalPrice(timestamp: number) {
      return withCache(
        `${net}:price:usd:${Math.floor(timestamp)}`,
        () => inner.getHistoricalPrice(timestamp),
        (price) => (price !== null ? undefined : -1),
      );
    },

    getHistoricalEurPrice(timestamp: number) {
      return withCache(
        `${net}:price:eur:${Math.floor(timestamp)}`,
        () => inner.getHistoricalEurPrice(timestamp),
        (price) => (price !== null ? undefined : -1),
      );
    },

    getAddressPrefix(prefix: string) {
      // Not cached - used for autocomplete, always fresh
      return inner.getAddressPrefix(prefix);
    },
  };
}
