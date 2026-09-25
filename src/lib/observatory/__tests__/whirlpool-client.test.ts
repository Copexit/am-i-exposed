import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { _resetForTest } from "@/lib/api/idb-cache";
import {
  getWhirlpoolSummary,
  getWhirlpoolCharts,
  getWhirlpoolTxs,
} from "../whirlpool-client";
import summaryFixture from "./fixtures/whirlpool-summary.json";
import chartsFixture from "./fixtures/whirlpool-charts.json";
import txsFixture from "./fixtures/whirlpool-txs.json";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

beforeEach(async () => {
  mockFetch.mockReset();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
  await _resetForTest();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("aie-cache");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonOk<T>(body: T) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const BASE = "https://example.test/whirlpool";

describe("getWhirlpoolSummary", () => {
  it("fetches and parses the summary endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(summaryFixture));
    const result = await getWhirlpoolSummary(BASE);
    expect(result.tip_height).toBe(957629);
    expect(result.is_synced).toBe(true);
    expect(result.pools).toHaveLength(2);
    expect(result.pools[0]?.unspent_utxos).toBe(546);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/summary`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("serves the second call from cache without a second fetch", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(summaryFixture));
    await getWhirlpoolSummary(BASE);
    const second = await getWhirlpoolSummary(BASE);
    expect(second.tip_height).toBe(957629);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("getWhirlpoolCharts", () => {
  it("fetches and parses the charts endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(chartsFixture));
    const result = await getWhirlpoolCharts(BASE);
    const cap = result.capacity;
    expect(cap.blocks[cap.blocks.length - 1]).toBe(957310);
    expect(cap.series["0.025_BTC_Pool"]?.[cap.blocks.length - 1]).toBe(13.65);
    expect(cap.series["0.25_BTC_Pool"]?.[cap.blocks.length - 1]).toBe(62.75);
    expect(result.utxos.total_utxos.length).toBe(result.utxos.blocks.length);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/charts`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("getWhirlpoolTxs", () => {
  it("fetches the requested page of cycle history", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(txsFixture));
    const result = await getWhirlpoolTxs(BASE, 1);
    expect(result.items).toHaveLength(3);
    expect(result.total_pages).toBe(29);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/txs?page=1`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("defaults to page 1 and caches per page", async () => {
    mockFetch.mockResolvedValue(jsonOk(txsFixture));
    await getWhirlpoolTxs(BASE);
    await getWhirlpoolTxs(BASE, 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/txs?page=1`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
