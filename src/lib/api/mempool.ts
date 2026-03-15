import { fetchWithRetry, ApiError } from "./fetch-with-retry";
import { ADDR_RE, TXID_RE } from "@/lib/constants";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
  MempoolOutspend,
} from "./types";

function assertTxid(txid: string): void {
  if (!TXID_RE.test(txid)) throw new ApiError("INVALID_INPUT", "Invalid txid format");
}
function assertAddress(address: string): void {
  if (!ADDR_RE.test(address)) throw new ApiError("INVALID_INPUT", "Invalid address format");
}

export interface MempoolClientOptions {
  signal?: AbortSignal;
  /** Per-request timeout in ms. Defaults to 15s. Use longer for local Electrs backends. */
  timeoutMs?: number;
}

/** Shared implementation for historical price fetching by currency. */
async function getHistoricalCurrencyPrice(
  get: <R>(path: string) => Promise<R>,
  timestamp: number,
  currency: string,
): Promise<number | null> {
  try {
    const data = await get<{ prices: Array<Record<string, number>> }>(
      `/v1/historical-price?currency=${currency}&timestamp=${Math.floor(timestamp)}`,
    );
    const price = data.prices?.[0]?.[currency];
    // API returns 0 for timestamps before price data existed
    return price && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export function createMempoolClient(baseUrl: string, options?: MempoolClientOptions) {
  const base = baseUrl.replace(/\/+$/, "");
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs;

  async function get<T>(path: string): Promise<T> {
    const res = await fetchWithRetry(`${base}${path}`, { signal, timeoutMs });
    try {
      return await res.json();
    } catch {
      throw new ApiError("API_UNAVAILABLE", "Invalid JSON response");
    }
  }

  async function getText(path: string): Promise<string> {
    const res = await fetchWithRetry(`${base}${path}`, { signal, timeoutMs });
    return res.text();
  }

  return {
    getTransaction(txid: string): Promise<MempoolTransaction> {
      assertTxid(txid);
      return get(`/tx/${txid}`);
    },

    getTxHex(txid: string): Promise<string> {
      assertTxid(txid);
      return getText(`/tx/${txid}/hex`);
    },

    getAddress(address: string): Promise<MempoolAddress> {
      assertAddress(address);
      return get(`/address/${address}`);
    },

    async getAddressTxs(address: string, maxPages = 4): Promise<MempoolTransaction[]> {
      assertAddress(address);
      const allTxs: MempoolTransaction[] = [];

      // First page
      const firstPage = await get<MempoolTransaction[]>(`/address/${address}/txs`);
      allTxs.push(...firstPage);

      // Paginate using chain/:last_seen_txid (25 txs per page)
      let page = 1;
      while (firstPage.length === 25 && page < maxPages && allTxs.length < 200 && !signal?.aborted) {
        const lastTxid = allTxs[allTxs.length - 1].txid;
        assertTxid(lastTxid);
        const nextPage = await get<MempoolTransaction[]>(
          `/address/${address}/txs/chain/${lastTxid}`,
        );
        if (nextPage.length === 0) break;
        allTxs.push(...nextPage);
        if (nextPage.length < 25) break;
        page++;
      }

      return allTxs;
    },

    getAddressUtxos(address: string): Promise<MempoolUtxo[]> {
      assertAddress(address);
      return get(`/address/${address}/utxo`);
    },

    getTxOutspends(txid: string): Promise<MempoolOutspend[]> {
      assertTxid(txid);
      return get(`/tx/${txid}/outspends`);
    },

    /** Search for addresses starting with the given prefix. Returns up to 10 matches.
     *  Bech32 prefixes are lowercased automatically. Fails silently on unsupported backends. */
    async getAddressPrefix(prefix: string): Promise<string[]> {
      // Only lowercase bech32 prefixes (bc1/tb1) - legacy addresses are case-sensitive
      const normalized = /^(bc1|tb1)/i.test(prefix) ? prefix.toLowerCase() : prefix;
      if (normalized.length < 1) return [];
      try {
        return await get<string[]>(`/address-prefix/${normalized}`);
      } catch {
        return [];
      }
    },

    async getHistoricalPrice(timestamp: number): Promise<number | null> {
      return getHistoricalCurrencyPrice(get, timestamp, "USD");
    },

    async getHistoricalEurPrice(timestamp: number): Promise<number | null> {
      return getHistoricalCurrencyPrice(get, timestamp, "EUR");
    },
  };
}

export type MempoolClient = ReturnType<typeof createMempoolClient>;
