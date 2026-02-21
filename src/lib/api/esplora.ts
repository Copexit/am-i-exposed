import { fetchWithRetry, ApiError } from "./fetch-with-retry";
import type {
  MempoolTransaction,
  MempoolAddress,
  MempoolUtxo,
} from "./types";

const TXID_RE = /^[a-fA-F0-9]{64}$/;
const ADDR_RE = /^[a-zA-Z0-9]{25,90}$/;

function assertTxid(txid: string): void {
  if (!TXID_RE.test(txid)) throw new ApiError("INVALID_INPUT", "Invalid txid format");
}
function assertAddress(address: string): void {
  if (!ADDR_RE.test(address)) throw new ApiError("INVALID_INPUT", "Invalid address format");
}

export function createEsploraClient(baseUrl: string, signal?: AbortSignal) {
  async function get<T>(path: string): Promise<T> {
    const res = await fetchWithRetry(`${baseUrl}${path}`, { signal });
    try {
      return await res.json();
    } catch {
      throw new ApiError("API_UNAVAILABLE", "Invalid JSON response");
    }
  }

  async function getText(path: string): Promise<string> {
    const res = await fetchWithRetry(`${baseUrl}${path}`, { signal });
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

      const firstPage = await get<MempoolTransaction[]>(`/address/${address}/txs`);
      allTxs.push(...firstPage);

      let page = 1;
      while (firstPage.length === 25 && page < maxPages && allTxs.length < 200 && !signal?.aborted) {
        const lastTxid = allTxs[allTxs.length - 1].txid;
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
  };
}

export type EsploraClient = ReturnType<typeof createEsploraClient>;
