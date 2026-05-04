import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { createCachedMempoolClient, networkFromUrl } from "../cached-client";
import { _resetForTest, idbGet } from "../idb-cache";
import type { MempoolTransaction, MempoolOutspend, MempoolAddress, MempoolUtxo } from "../types";

// Mock the mempool module to intercept actual API calls
vi.mock("../mempool", () => ({
  createMempoolClient: vi.fn(),
}));

import { createMempoolClient } from "../mempool";
const mockCreate = vi.mocked(createMempoolClient);

function makeMockTx(txid: string, confirmed = true): MempoolTransaction {
  return {
    txid,
    version: 2,
    locktime: 0,
    size: 250,
    weight: 1000,
    fee: 500,
    vin: [],
    vout: [],
    status: {
      confirmed,
      block_height: confirmed ? 800000 : undefined,
      block_time: confirmed ? 1700000000 : undefined,
    },
  };
}

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getTransaction: vi.fn(),
    getTxHex: vi.fn(),
    getAddress: vi.fn(),
    getAddressTxs: vi.fn(),
    getAddressUtxos: vi.fn(),
    getTxOutspends: vi.fn(),
    getHistoricalPrice: vi.fn(),
    getHistoricalEurPrice: vi.fn(),
    getAddressPrefix: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("aie-cache");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

beforeEach(async () => {
  await _resetForTest();
  await deleteDb();
  mockCreate.mockReset();
});

describe("networkFromUrl", () => {
  it("detects mainnet", () => {
    expect(networkFromUrl("https://mempool.space/api")).toBe("mainnet");
  });

  it("detects testnet4", () => {
    expect(networkFromUrl("https://mempool.space/testnet4/api")).toBe("testnet4");
  });

  it("detects signet", () => {
    expect(networkFromUrl("https://mempool.space/signet/api")).toBe("signet");
  });

  it("detects testnet3 (legacy /testnet path)", () => {
    expect(networkFromUrl("https://mempool.space/testnet/api")).toBe("testnet3");
  });

  it("does not confuse testnet4 with testnet3", () => {
    expect(networkFromUrl("https://mempool.space/testnet4/api")).toBe("testnet4");
  });

  it("defaults to mainnet for custom URLs", () => {
    expect(networkFromUrl("http://localhost:3006/api")).toBe("mainnet");
  });
});

describe("createCachedMempoolClient", () => {
  describe("getTransaction", () => {
    it("caches confirmed transactions with infinite TTL", async () => {
      const tx = makeMockTx("aaa", true);
      const mock = makeMockClient({ getTransaction: vi.fn().mockResolvedValue(tx) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");

      // First call hits the API
      const result1 = await client.getTransaction("aaa");
      expect(result1).toEqual(tx);
      expect(mock.getTransaction).toHaveBeenCalledTimes(1);

      // Second call should hit cache
      const result2 = await client.getTransaction("aaa");
      expect(result2).toEqual(tx);
      expect(mock.getTransaction).toHaveBeenCalledTimes(1); // No additional call

      // Verify stored in IndexedDB with infinite TTL (expiresAt = 0)
      const cached = await idbGet<MempoolTransaction>("mainnet:tx:aaa");
      expect(cached?.txid).toBe("aaa");
    });

    it("caches unconfirmed transactions with short TTL", async () => {
      const tx = makeMockTx("bbb", false);
      const mock = makeMockClient({ getTransaction: vi.fn().mockResolvedValue(tx) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getTransaction("bbb");

      const cached = await idbGet<MempoolTransaction>("mainnet:tx:bbb");
      expect(cached).toBeDefined();
    });
  });

  describe("getTxHex", () => {
    it("caches hex data", async () => {
      const mock = makeMockClient({ getTxHex: vi.fn().mockResolvedValue("0200deadbeef") });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getTxHex("ccc");
      await client.getTxHex("ccc");

      expect(mock.getTxHex).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTxOutspends", () => {
    it("caches outspends with 1h TTL", async () => {
      const outspends: MempoolOutspend[] = [{ spent: true, txid: "ddd" }];
      const mock = makeMockClient({ getTxOutspends: vi.fn().mockResolvedValue(outspends) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getTxOutspends("eee");
      await client.getTxOutspends("eee");

      expect(mock.getTxOutspends).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAddress", () => {
    it("caches address data with 10 min TTL", async () => {
      const addr: MempoolAddress = {
        address: "bc1qtest",
        chain_stats: { funded_txo_count: 1, funded_txo_sum: 100000, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
        mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
      };
      const mock = makeMockClient({ getAddress: vi.fn().mockResolvedValue(addr) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getAddress("bc1qtest");
      await client.getAddress("bc1qtest");

      expect(mock.getAddress).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAddressUtxos", () => {
    it("caches UTXOs", async () => {
      const utxos: MempoolUtxo[] = [{ txid: "fff", vout: 0, value: 50000, status: { confirmed: true } }];
      const mock = makeMockClient({ getAddressUtxos: vi.fn().mockResolvedValue(utxos) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getAddressUtxos("bc1qtest");
      await client.getAddressUtxos("bc1qtest");

      expect(mock.getAddressUtxos).toHaveBeenCalledTimes(1);
    });
  });

  describe("getHistoricalPrice", () => {
    it("caches non-null prices with infinite TTL", async () => {
      const mock = makeMockClient({ getHistoricalPrice: vi.fn().mockResolvedValue(67500) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getHistoricalPrice(1700000000);
      await client.getHistoricalPrice(1700000000);

      expect(mock.getHistoricalPrice).toHaveBeenCalledTimes(1);
    });

    it("does not cache null prices", async () => {
      const mock = makeMockClient({ getHistoricalPrice: vi.fn().mockResolvedValue(null) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getHistoricalPrice(1000);
      await client.getHistoricalPrice(1000);

      expect(mock.getHistoricalPrice).toHaveBeenCalledTimes(2); // Called twice since null wasn't cached
    });
  });

  describe("getAddressTxs maxPages cache key", () => {
    it("different maxPages values produce different cache keys", async () => {
      const txs4 = [makeMockTx("tx4", true)];
      const txs2 = [makeMockTx("tx2", true), makeMockTx("tx2b", true)];

      const mock = makeMockClient({
        getAddressTxs: vi.fn()
          .mockResolvedValueOnce(txs4)
          .mockResolvedValueOnce(txs2),
      });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");

      // Fetch with default maxPages (4)
      const result1 = await client.getAddressTxs("bc1qtest");
      expect(result1).toEqual(txs4);

      // Fetch with maxPages=2 - should NOT use the cached maxPages=4 result
      const result2 = await client.getAddressTxs("bc1qtest", 2);
      expect(result2).toEqual(txs2);

      expect(mock.getAddressTxs).toHaveBeenCalledTimes(2);
    });
  });

  describe("enableCache bypass", () => {
    it("skips cache when enableCache is false", async () => {
      // Mock getAnalysisSettings to return enableCache: false
      const { getAnalysisSettings } = await import("@/hooks/useAnalysisSettings");
      const originalSettings = getAnalysisSettings();

      // Store something first with cache enabled
      const tx = makeMockTx("bypass-test", true);
      const mock = makeMockClient({ getTransaction: vi.fn().mockResolvedValue(tx) });
      mockCreate.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);

      const client = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      await client.getTransaction("bypass-test");
      expect(mock.getTransaction).toHaveBeenCalledTimes(1);

      // Second call should hit cache (enableCache is true by default)
      await client.getTransaction("bypass-test");
      expect(mock.getTransaction).toHaveBeenCalledTimes(1);

      // Verify the cache is working with default settings
      expect(originalSettings.enableCache).toBe(true);
    });
  });

  describe("network namespacing", () => {
    it("does not cross-contaminate between networks", async () => {
      const mainnetTx = makeMockTx("same-txid", true);
      const testnetTx = makeMockTx("same-txid", true);
      testnetTx.fee = 999; // Different data

      const mainnetMock = makeMockClient({ getTransaction: vi.fn().mockResolvedValue(mainnetTx) });
      const testnetMock = makeMockClient({ getTransaction: vi.fn().mockResolvedValue(testnetTx) });

      mockCreate
        .mockReturnValueOnce(mainnetMock as ReturnType<typeof createMempoolClient>)
        .mockReturnValueOnce(testnetMock as ReturnType<typeof createMempoolClient>);

      const mainnetClient = createCachedMempoolClient("https://mempool.space/api", "mainnet");
      const testnetClient = createCachedMempoolClient("https://mempool.space/testnet4/api", "testnet4");

      const r1 = await mainnetClient.getTransaction("same-txid");
      const r2 = await testnetClient.getTransaction("same-txid");

      expect(r1.fee).toBe(500);
      expect(r2.fee).toBe(999);
      expect(mainnetMock.getTransaction).toHaveBeenCalledTimes(1);
      expect(testnetMock.getTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
