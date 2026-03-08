import { createMempoolClient, type MempoolClient } from "./mempool";
import { ApiError } from "./fetch-with-retry";
import type { NetworkConfig } from "@/lib/bitcoin/networks";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
  MempoolOutspend,
} from "./types";

/**
 * Unified API client that tries the primary API (mempool.space) first,
 * then falls back to Esplora (blockstream.info) on mainnet.
 *
 * Both mempool.space and blockstream.info implement the same Esplora REST API,
 * so both use createMempoolClient with different base URLs.
 */
export function createApiClient(config: NetworkConfig, signal?: AbortSignal) {
  const mempool = createMempoolClient(config.mempoolBaseUrl, signal);

  // Esplora fallback only available on mainnet (same API, different host)
  const esplora: MempoolClient | null =
    config.esploraBaseUrl !== config.mempoolBaseUrl
      ? createMempoolClient(config.esploraBaseUrl, signal)
      : null;

  async function withFallback<T>(
    primary: (client: MempoolClient) => Promise<T>,
    fallback?: (client: MempoolClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await primary(mempool);
    } catch (error) {
      if (
        esplora &&
        fallback &&
        error instanceof ApiError &&
        (error.code === "API_UNAVAILABLE" || error.code === "NETWORK_ERROR")
      ) {
        return fallback(esplora);
      }
      throw error;
    }
  }

  return {
    getTransaction(txid: string): Promise<MempoolTransaction> {
      return withFallback(
        (c) => c.getTransaction(txid),
        (c) => c.getTransaction(txid),
      );
    },

    getTxHex(txid: string): Promise<string> {
      return withFallback(
        (c) => c.getTxHex(txid),
        (c) => c.getTxHex(txid),
      );
    },

    getAddress(address: string): Promise<MempoolAddress> {
      return withFallback(
        (c) => c.getAddress(address),
        (c) => c.getAddress(address),
      );
    },

    getAddressTxs(address: string): Promise<MempoolTransaction[]> {
      return withFallback(
        (c) => c.getAddressTxs(address),
        (c) => c.getAddressTxs(address),
      );
    },

    getAddressUtxos(address: string): Promise<MempoolUtxo[]> {
      return withFallback(
        (c) => c.getAddressUtxos(address),
        (c) => c.getAddressUtxos(address),
      );
    },

    getTxOutspends(txid: string): Promise<MempoolOutspend[]> {
      return withFallback(
        (c) => c.getTxOutspends(txid),
        (c) => c.getTxOutspends(txid),
      );
    },

    getHistoricalPrice(timestamp: number): Promise<number | null> {
      // Price API is mempool.space-specific, no Esplora fallback
      return mempool.getHistoricalPrice(timestamp);
    },

    getHistoricalEurPrice(timestamp: number): Promise<number | null> {
      return mempool.getHistoricalEurPrice(timestamp);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
