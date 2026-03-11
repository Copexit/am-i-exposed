import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMempoolClient } from "../mempool";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200 });
}

/** Generate a valid 64-char hex txid with a unique suffix. */
function hexTxid(n: number): string {
  const hex = n.toString(16).padStart(8, "0");
  return "a".repeat(56) + hex;
}

function makeTx(n: number) {
  return { txid: hexTxid(n), vin: [], vout: [], size: 100, fee: 100, status: { confirmed: true } };
}

const BASE = "https://mempool.space/api";
const VALID_TXID = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";
const VALID_ADDR = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

describe("createMempoolClient", () => {
  describe("getTransaction", () => {
    it("fetches a transaction by txid", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ txid: VALID_TXID }));
      const client = createMempoolClient(BASE);
      const tx = await client.getTransaction(VALID_TXID);
      expect(tx.txid).toBe(VALID_TXID);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE}/tx/${VALID_TXID}`,
        expect.anything(),
      );
    });

    it("rejects invalid txid format", () => {
      const client = createMempoolClient(BASE);
      expect(() => client.getTransaction("not-a-txid")).toThrow("Invalid txid");
    });
  });

  describe("getTxHex", () => {
    it("fetches raw hex", async () => {
      mockFetch.mockResolvedValueOnce(new Response("0200000001...", { status: 200 }));
      const client = createMempoolClient(BASE);
      const hex = await client.getTxHex(VALID_TXID);
      expect(hex).toBe("0200000001...");
    });
  });

  describe("getAddress", () => {
    it("fetches address info", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ address: VALID_ADDR }));
      const client = createMempoolClient(BASE);
      const addr = await client.getAddress(VALID_ADDR);
      expect(addr.address).toBe(VALID_ADDR);
    });

    it("rejects invalid address format", () => {
      const client = createMempoolClient(BASE);
      expect(() => client.getAddress("xyz")).toThrow("Invalid address");
    });
  });

  describe("getAddressTxs - pagination", () => {
    it("returns single page when fewer than 25 txs", async () => {
      const txs = Array.from({ length: 10 }, (_, i) => makeTx(i));
      mockFetch.mockResolvedValueOnce(jsonResponse(txs));
      const client = createMempoolClient(BASE);
      const result = await client.getAddressTxs(VALID_ADDR);
      expect(result).toHaveLength(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("paginates when first page has exactly 25 txs", async () => {
      const page1 = Array.from({ length: 25 }, (_, i) => makeTx(i));
      const page2 = Array.from({ length: 10 }, (_, i) => makeTx(100 + i));
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page1))
        .mockResolvedValueOnce(jsonResponse(page2));

      const client = createMempoolClient(BASE);
      const result = await client.getAddressTxs(VALID_ADDR);
      expect(result).toHaveLength(35);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("stops at maxPages limit", async () => {
      const makePage = (offset: number) =>
        Array.from({ length: 25 }, (_, i) => makeTx(offset * 100 + i));
      mockFetch
        .mockResolvedValueOnce(jsonResponse(makePage(0)))
        .mockResolvedValueOnce(jsonResponse(makePage(1)))
        .mockResolvedValueOnce(jsonResponse(makePage(2)))
        .mockResolvedValueOnce(jsonResponse(makePage(3)));

      const client = createMempoolClient(BASE);
      const result = await client.getAddressTxs(VALID_ADDR, 4);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(4);
    });

    it("stops when empty page is returned", async () => {
      const page1 = Array.from({ length: 25 }, (_, i) => makeTx(i));
      mockFetch
        .mockResolvedValueOnce(jsonResponse(page1))
        .mockResolvedValueOnce(jsonResponse([]));

      const client = createMempoolClient(BASE);
      const result = await client.getAddressTxs(VALID_ADDR);
      expect(result).toHaveLength(25);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("respects AbortSignal", async () => {
      const page1 = Array.from({ length: 25 }, (_, i) => makeTx(i));
      mockFetch.mockResolvedValueOnce(jsonResponse(page1));

      const controller = new AbortController();
      controller.abort();

      const client = createMempoolClient(BASE, { signal: controller.signal });
      const result = await client.getAddressTxs(VALID_ADDR);
      // Should return first page but not attempt pagination (signal aborted)
      expect(result).toHaveLength(25);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAddressUtxos", () => {
    it("fetches UTXOs", async () => {
      const utxos = [{ txid: VALID_TXID, vout: 0, value: 10000, status: { confirmed: true } }];
      mockFetch.mockResolvedValueOnce(jsonResponse(utxos));
      const client = createMempoolClient(BASE);
      const result = await client.getAddressUtxos(VALID_ADDR);
      expect(result).toHaveLength(1);
    });
  });
});
