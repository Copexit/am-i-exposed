import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { _resetForTest } from "../idb-cache";
import {
  buildResultCacheKey,
  getCachedResult,
  putCachedResult,
  TTL_24_HOURS,
  INCOMPLETE_RESULT_FINDING_IDS,
} from "../analysis-cache";
import type { MempoolTransaction } from "@/lib/api/types";
import type { AnalysisSettings } from "@/lib/analysis/settings";
import type { AnalysisState } from "@/lib/analysis/analysis-state";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";

function deleteDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("aie-cache");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

const defaultSettings: AnalysisSettings = {
  maxDepth: 6,
  minSats: 1000,
  skipLargeClusters: false,
  skipCoinJoins: false,
  timeout: 10,
  walletGapLimit: 5,
  enableCache: true,
  boltzmannTimeout: 300,
};

function makeMinimalState(overrides: Partial<AnalysisState> = {}): AnalysisState {
  return {
    phase: "complete",
    query: "abc123",
    inputType: "txid",
    steps: [],
    result: { score: 70, grade: "B", findings: [] },
    txData: null,
    addressData: null,
    addressTxs: null,
    addressUtxos: null,
    txBreakdown: null,
    preSendResult: null,
    error: null,
    errorCode: null,
    durationMs: 1234,
    usdPrice: null,
    outspends: null,
    psbtData: null,
    fetchProgress: null,
    backwardLayers: null,
    forwardLayers: null,
    boltzmannResult: null,
    boltzmannStatus: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await _resetForTest();
  await deleteDb();
});

describe("analysis-cache", () => {
  describe("buildResultCacheKey", () => {
    it("produces correct format with all settings embedded", () => {
      const key = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      expect(key).toBe("result:v3:mainnet:abc123:6:1000:0:0");
    });

    it("different maxDepth values produce different keys", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "abc123", {
        ...defaultSettings,
        maxDepth: 10,
      });
      expect(key1).not.toBe(key2);
      expect(key2).toBe("result:v3:mainnet:abc123:10:1000:0:0");
    });

    it("different minSats values produce different keys", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "abc123", {
        ...defaultSettings,
        minSats: 5000,
      });
      expect(key1).not.toBe(key2);
      expect(key2).toBe("result:v3:mainnet:abc123:6:5000:0:0");
    });

    it("different skipCoinJoins values produce different keys", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "abc123", {
        ...defaultSettings,
        skipCoinJoins: true,
      });
      expect(key1).not.toBe(key2);
      expect(key2).toBe("result:v3:mainnet:abc123:6:1000:1:0");
    });

    it("different skipLargeClusters values produce different keys", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "abc123", {
        ...defaultSettings,
        skipLargeClusters: true,
      });
      expect(key1).not.toBe(key2);
      expect(key2).toBe("result:v3:mainnet:abc123:6:1000:0:1");
    });

    it("same settings and query produce the same key", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      expect(key1).toBe(key2);
    });

    it("different networks produce different keys", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("testnet4", "abc123", defaultSettings);
      expect(key1).not.toBe(key2);
    });

    it("different queries produce different keys", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "def456", defaultSettings);
      expect(key1).not.toBe(key2);
    });

    it("timeout and walletGapLimit do not affect the key", () => {
      const key1 = buildResultCacheKey("mainnet", "abc123", defaultSettings);
      const key2 = buildResultCacheKey("mainnet", "abc123", {
        ...defaultSettings,
        timeout: 60,
        walletGapLimit: 20,
      });
      expect(key1).toBe(key2);
    });
  });

  describe("getCachedResult", () => {
    it("returns undefined when enableCache is false", async () => {
      const state = makeMinimalState();
      await putCachedResult("mainnet", "abc123", defaultSettings, state);

      const result = await getCachedResult("mainnet", "abc123", {
        ...defaultSettings,
        enableCache: false,
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for missing entry", async () => {
      const result = await getCachedResult("mainnet", "nonexistent", defaultSettings);
      expect(result).toBeUndefined();
    });
  });

  describe("putCachedResult", () => {
    it("is a no-op when enableCache is false", async () => {
      const state = makeMinimalState();
      await putCachedResult("mainnet", "abc123", {
        ...defaultSettings,
        enableCache: false,
      }, state);

      const result = await getCachedResult("mainnet", "abc123", defaultSettings);
      expect(result).toBeUndefined();
    });
  });

  describe("round-trip", () => {
    it("put then get returns the same data", async () => {
      const state = makeMinimalState({
        result: { score: 45, grade: "D", findings: [{ id: "h1-round-amount", severity: "high", title: "Test", description: "desc", recommendation: "rec", scoreImpact: -10 }] },
        usdPrice: 50000,
        durationMs: 2500,
      });

      await putCachedResult("mainnet", "abc123", defaultSettings, state);
      const cached = await getCachedResult("mainnet", "abc123", defaultSettings);

      expect(cached).toBeDefined();
      expect(cached!.phase).toBe("complete");
      expect(cached!.query).toBe("abc123");
      expect(cached!.inputType).toBe("txid");
      expect(cached!.result).toEqual(state.result);
      expect(cached!.usdPrice).toBe(50000);
      expect(cached!.backwardLayers).toBeNull();
      expect(cached!.forwardLayers).toBeNull();
    });

    it("TraceLayer.txs Map serialization round-trips correctly", async () => {
      const fakeTx = {
        txid: "tx1",
        version: 2,
        locktime: 0,
        vin: [],
        vout: [],
        size: 100,
        weight: 400,
        fee: 1000,
        status: { confirmed: true, block_height: 100000, block_hash: "hash", block_time: 1700000000 },
      } as import("@/lib/api/types").MempoolTransaction;

      const backwardLayers: TraceLayer[] = [
        { depth: 1, txs: new Map([["tx1", fakeTx]]) },
      ];
      const forwardLayers: TraceLayer[] = [
        { depth: 1, txs: new Map([["tx1", fakeTx]]) },
        { depth: 2, txs: new Map() },
      ];

      const state = makeMinimalState({ backwardLayers, forwardLayers });
      await putCachedResult("mainnet", "abc123", defaultSettings, state);
      const cached = await getCachedResult("mainnet", "abc123", defaultSettings);

      expect(cached).toBeDefined();

      // Verify backward layers
      expect(cached!.backwardLayers).toHaveLength(1);
      expect(cached!.backwardLayers?.[0]?.depth).toBe(1);
      expect(cached!.backwardLayers?.[0]?.txs).toBeInstanceOf(Map);
      expect(cached!.backwardLayers?.[0]?.txs.size).toBe(1);
      expect(cached!.backwardLayers?.[0]?.txs.get("tx1")).toEqual(fakeTx);

      // Verify forward layers
      expect(cached!.forwardLayers).toHaveLength(2);
      expect(cached!.forwardLayers?.[0]?.txs).toBeInstanceOf(Map);
      expect(cached!.forwardLayers?.[0]?.txs.get("tx1")).toEqual(fakeTx);
      expect(cached!.forwardLayers?.[1]?.txs).toBeInstanceOf(Map);
      expect(cached!.forwardLayers?.[1]?.txs.size).toBe(0);
    });

    it("address analysis data round-trips correctly", async () => {
      const state = makeMinimalState({
        inputType: "address",
        query: "bc1qtest",
        addressData: {
          address: "bc1qtest",
          chain_stats: { funded_txo_count: 5, funded_txo_sum: 100000, spent_txo_count: 3, spent_txo_sum: 50000, tx_count: 8 },
          mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
        },
        addressTxs: [],
        addressUtxos: [],
        txBreakdown: [],
        preSendResult: {
          riskLevel: "LOW",
          summary: "Low risk",
          summaryKey: "presend.adviceLow",
          findings: [],
          txCount: 8,
          timesReceived: 5,
          totalReceived: 100000,
        },
      });

      await putCachedResult("mainnet", "bc1qtest", defaultSettings, state);
      const cached = await getCachedResult("mainnet", "bc1qtest", defaultSettings);

      expect(cached).toBeDefined();
      expect(cached!.inputType).toBe("address");
      expect(cached!.addressData?.address).toBe("bc1qtest");
      expect(cached!.preSendResult?.riskLevel).toBe("LOW");
      expect(cached!.txBreakdown).toEqual([]);
    });

    it("settings isolation - different settings miss cache", async () => {
      const state = makeMinimalState();
      await putCachedResult("mainnet", "abc123", defaultSettings, state);

      // Same query but different maxDepth - should miss
      const cached = await getCachedResult("mainnet", "abc123", {
        ...defaultSettings,
        maxDepth: 10,
      });
      expect(cached).toBeUndefined();
    });
  });

  describe("TTL expiry", () => {
    it("expired entries return undefined", async () => {
      const state = makeMinimalState();
      await putCachedResult("mainnet", "abc123", defaultSettings, state);

      // Verify it exists first
      const fresh = await getCachedResult("mainnet", "abc123", defaultSettings);
      expect(fresh).toBeDefined();

      // Mock Date.now to be 25 hours in the future
      const originalNow = Date.now;
      vi.spyOn(Date, "now").mockReturnValue(originalNow() + TTL_24_HOURS + 3600_000);

      const expired = await getCachedResult("mainnet", "abc123", defaultSettings);
      expect(expired).toBeUndefined();

      vi.restoreAllMocks();
    });

    const ELEVEN_MIN = 11 * 60_000;
    const tx = (confirmed: boolean, blockTime?: number) =>
      ({ txid: "abc123", status: { confirmed, block_time: blockTime } }) as MempoolTransaction;

    async function presentAfter(query: string, state: AnalysisState, ms: number) {
      await putCachedResult("mainnet", query, defaultSettings, state);
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + ms);
      const cached = await getCachedResult("mainnet", query, defaultSettings);
      vi.restoreAllMocks();
      return cached !== undefined;
    }

    it("unconfirmed tx results expire after 10 min", async () => {
      expect(await presentAfter("abc123", makeMinimalState({ txData: tx(false) }), ELEVEN_MIN)).toBe(false);
    });

    it("confirmed tx results are kept for 24h", async () => {
      expect(await presentAfter("abc123", makeMinimalState({ txData: tx(true, 1_600_000_000) }), ELEVEN_MIN)).toBe(true);
    });

    it("address results use the adaptive address TTL, not 24h", async () => {
      const recent = Math.floor(Date.now() / 1000) - 86_400;
      const state = makeMinimalState({ query: "bc1qtest", inputType: "address", addressTxs: [tx(true, recent)] });
      expect(await presentAfter("bc1qtest", state, ELEVEN_MIN)).toBe(false);
    });
  });

  describe("incomplete results", () => {
    it("covers failed prevout enrichment", () => {
      expect(INCOMPLETE_RESULT_FINDING_IDS).toContain("api-incomplete-prevout");
    });

    it.each(INCOMPLETE_RESULT_FINDING_IDS)("does not cache a result carrying %s", async (id) => {
      const state = makeMinimalState({
        txData: { txid: "abc123", status: { confirmed: true } } as MempoolTransaction,
        result: { score: 70, grade: "B", findings: [{ id, severity: "low", title: "", description: "", recommendation: "", scoreImpact: 0 }] },
      });
      await putCachedResult("mainnet", "abc123", defaultSettings, state);
      expect(await getCachedResult("mainnet", "abc123", defaultSettings)).toBeUndefined();
    });
  });
});
