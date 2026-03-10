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

import { createMempoolClient, type MempoolClient } from "./mempool";
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
 * Create a MempoolClient with transparent IndexedDB caching.
 * All methods have the same signature as the base MempoolClient.
 */
export function createCachedMempoolClient(
  baseUrl: string,
  network?: string,
  signal?: AbortSignal,
): MempoolClient {
  const inner = createMempoolClient(baseUrl, signal);
  const net = network ?? networkFromUrl(baseUrl);

  return {
    async getTransaction(txid: string) {
      const key = `${net}:tx:${txid}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<MempoolTransaction>(key);
        if (cached !== undefined) return cached;
      }

      const tx = await inner.getTransaction(txid);
      if (getAnalysisSettings().enableCache) {
        // Confirmed txs get infinite TTL, unconfirmed get 10 min
        const ttl = tx.status?.confirmed ? undefined : TTL_10_MIN;
        idbPut(key, tx, ttl).catch(() => {});
      }
      return tx;
    },

    async getTxHex(txid: string) {
      const key = `${net}:txhex:${txid}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<string>(key);
        if (cached !== undefined) return cached;
      }

      const hex = await inner.getTxHex(txid);
      if (getAnalysisSettings().enableCache) {
        idbPut(key, hex).catch(() => {});
      }
      return hex;
    },

    async getAddress(address: string) {
      const key = `${net}:addr:${address}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<Awaited<ReturnType<MempoolClient["getAddress"]>>>(key);
        if (cached !== undefined) return cached;
      }

      const data = await inner.getAddress(address);
      if (getAnalysisSettings().enableCache) {
        // Adaptive TTL: pending mempool txs -> 10 min, has chain txs -> 1 hour, unused -> 10 min
        let ttl = TTL_10_MIN;
        if (data.mempool_stats?.tx_count > 0) {
          ttl = TTL_10_MIN;
        } else if (data.chain_stats?.tx_count > 0) {
          ttl = TTL_1_HOUR;
        }
        idbPut(key, data, ttl).catch(() => {});
      }
      return data;
    },

    async getAddressTxs(address: string, maxPages?: number) {
      const key = `${net}:addrtxs:${address}:${maxPages ?? 4}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<Awaited<ReturnType<MempoolClient["getAddressTxs"]>>>(key);
        if (cached !== undefined) return cached;
      }

      const txs = await inner.getAddressTxs(address, maxPages);
      if (getAnalysisSettings().enableCache) {
        const ttl = computeAddressTxsTtl(txs);
        idbPut(key, txs, ttl).catch(() => {});
      }
      return txs;
    },

    async getAddressUtxos(address: string) {
      const key = `${net}:utxo:${address}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<Awaited<ReturnType<MempoolClient["getAddressUtxos"]>>>(key);
        if (cached !== undefined) return cached;
      }

      const utxos = await inner.getAddressUtxos(address);
      if (getAnalysisSettings().enableCache) {
        // All confirmed and non-empty -> 1 hour, otherwise 10 min
        const allConfirmed = utxos.length > 0 && utxos.every(u => u.status?.confirmed);
        idbPut(key, utxos, allConfirmed ? TTL_1_HOUR : TTL_10_MIN).catch(() => {});
      }
      return utxos;
    },

    async getTxOutspends(txid: string) {
      const key = `${net}:outspend:${txid}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<Awaited<ReturnType<MempoolClient["getTxOutspends"]>>>(key);
        if (cached !== undefined) return cached;
      }

      const outspends = await inner.getTxOutspends(txid);
      if (getAnalysisSettings().enableCache) {
        idbPut(key, outspends, TTL_1_HOUR).catch(() => {});
      }
      return outspends;
    },

    async getHistoricalPrice(timestamp: number) {
      const key = `${net}:price:usd:${Math.floor(timestamp)}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<number | null>(key);
        if (cached !== undefined) return cached;
      }

      const price = await inner.getHistoricalPrice(timestamp);
      if (getAnalysisSettings().enableCache) {
        // Only cache non-null results with infinite TTL
        if (price !== null) {
          idbPut(key, price).catch(() => {});
        }
      }
      return price;
    },

    async getHistoricalEurPrice(timestamp: number) {
      const key = `${net}:price:eur:${Math.floor(timestamp)}`;
      if (getAnalysisSettings().enableCache) {
        const cached = await idbGet<number | null>(key);
        if (cached !== undefined) return cached;
      }

      const price = await inner.getHistoricalEurPrice(timestamp);
      if (getAnalysisSettings().enableCache) {
        if (price !== null) {
          idbPut(key, price).catch(() => {});
        }
      }
      return price;
    },
  };
}
