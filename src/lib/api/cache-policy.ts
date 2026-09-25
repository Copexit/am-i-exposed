/**
 * Cache keys and TTL policy for mempool API responses.
 *
 * Storage-agnostic and free of browser/React imports so the web client
 * (IndexedDB, cached-client.ts) and the CLI (SQLite, cached-client-node.ts)
 * share one implementation.
 *
 * Cache key format: {network}@{baseUrl}:{type}:{identifier}
 * - Confirmed transactions: infinite TTL (immutable)
 * - Unconfirmed transactions: 10 min TTL
 * - Tx hex: infinite TTL
 * - Outspends: 1h TTL
 * - Historical prices: infinite TTL
 * - Address data/UTXOs/txs: adaptive TTL (10 min to 12h based on activity)
 */

import type { MempoolClient } from "./mempool";
import type { MempoolTransaction } from "./types";

/** TTL constants in milliseconds. */
export const TTL_10_MIN = 10 * 60 * 1000;
const TTL_1_HOUR = 60 * 60 * 1000;
const TTL_12_HOURS = 12 * 60 * 60 * 1000;

/**
 * Derive the network name from a mempool.space base URL.
 * - Contains "/testnet4/" -> "testnet4"
 * - Contains "/signet/" -> "signet"
 * - Contains "/testnet/" -> "testnet3" (mempool.space legacy path for testnet3)
 * - Otherwise -> "mainnet"
 *
 * Order matters: "/testnet4" must be checked before "/testnet" since the
 * former contains the latter as a substring.
 */
export function networkFromUrl(url: string): string {
  if (url.includes("/testnet4")) return "testnet4";
  if (url.includes("/signet")) return "signet";
  if (url.includes("/testnet")) return "testnet3";
  return "mainnet";
}

/**
 * Key prefix for one backend. Includes the normalized base URL so custom,
 * Umbrel and onion backends (whose network cannot be read from the URL)
 * never share entries with each other or with mempool.space.
 */
export function cacheKeyPrefix(baseUrl: string, network?: string): string {
  return `${network ?? networkFromUrl(baseUrl)}@${baseUrl.replace(/\/+$/, "")}`;
}

/** Compute adaptive TTL for address txs based on activity recency. */
export function computeAddressTxsTtl(txs: MempoolTransaction[]): number {
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
 * Cache-or-fetch function supplied by the storage layer. The ttlFn receives
 * the fetched value; undefined = infinite, negative = do not cache.
 */
export type WithCache = <T>(
  key: string,
  fn: () => Promise<T>,
  ttlFn?: (value: T) => number | undefined,
) => Promise<T>;

/** Wrap a MempoolClient so every call goes through `withCache` with the shared keys and TTLs. */
export function withCachePolicy(
  inner: MempoolClient,
  prefix: string,
  withCache: WithCache,
): MempoolClient {
  return {
    getTransaction(txid: string) {
      return withCache(
        `${prefix}:tx:${txid}`,
        () => inner.getTransaction(txid),
        (tx) => tx.status?.confirmed ? undefined : TTL_10_MIN,
      );
    },

    getTxHex(txid: string) {
      return withCache(`${prefix}:txhex:${txid}`, () => inner.getTxHex(txid));
    },

    getAddress(address: string) {
      return withCache(
        `${prefix}:addr:${address}`,
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
        `${prefix}:addrtxs:${address}:${maxPages ?? 4}`,
        () => inner.getAddressTxs(address, maxPages),
        (txs) => computeAddressTxsTtl(txs),
      );
    },

    getAddressUtxos(address: string) {
      return withCache(
        `${prefix}:utxo:${address}`,
        () => inner.getAddressUtxos(address),
        (utxos) => {
          const allConfirmed = utxos.length > 0 && utxos.every(u => u.status?.confirmed);
          return allConfirmed ? TTL_1_HOUR : TTL_10_MIN;
        },
      );
    },

    getTxOutspends(txid: string) {
      return withCache(
        `${prefix}:outspend:${txid}`,
        () => inner.getTxOutspends(txid),
        () => TTL_1_HOUR,
      );
    },

    getHistoricalPrice(timestamp: number) {
      return withCache(
        `${prefix}:price:usd:${Math.floor(timestamp)}`,
        () => inner.getHistoricalPrice(timestamp),
        (price) => price !== null ? undefined : -1,
      );
    },

    getHistoricalEurPrice(timestamp: number) {
      return withCache(
        `${prefix}:price:eur:${Math.floor(timestamp)}`,
        () => inner.getHistoricalEurPrice(timestamp),
        (price) => price !== null ? undefined : -1,
      );
    },

    getAddressPrefix(prefixQuery: string) {
      // Not cached - used for autocomplete, always fresh
      return inner.getAddressPrefix(prefixQuery);
    },
  };
}
