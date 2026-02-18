import { fetchWithRetry, ApiError } from "./fetch-with-retry";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "./types";

export function createEsploraClient(baseUrl: string) {
  async function get<T>(path: string): Promise<T> {
    const res = await fetchWithRetry(`${baseUrl}${path}`);
    try {
      return await res.json();
    } catch {
      throw new ApiError("API_UNAVAILABLE", "Invalid JSON response");
    }
  }

  async function getText(path: string): Promise<string> {
    const res = await fetchWithRetry(`${baseUrl}${path}`);
    return res.text();
  }

  return {
    getTransaction(txid: string): Promise<MempoolTransaction> {
      return get(`/tx/${txid}`);
    },

    getTxHex(txid: string): Promise<string> {
      return getText(`/tx/${txid}/hex`);
    },

    getAddress(address: string): Promise<MempoolAddress> {
      return get(`/address/${address}`);
    },

    getAddressTxs(address: string): Promise<MempoolTransaction[]> {
      return get(`/address/${address}/txs`);
    },

    getAddressUtxos(address: string): Promise<MempoolUtxo[]> {
      return get(`/address/${address}/utxo`);
    },
  };
}

export type EsploraClient = ReturnType<typeof createEsploraClient>;
