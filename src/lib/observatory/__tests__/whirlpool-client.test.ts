import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { _resetForTest } from "@/lib/api/idb-cache";
import { getWhirlpoolSummary, getWhirlpoolCharts } from "../whirlpool-client";
import summaryFixture from "./fixtures/whirlpool-summary.json";
import chartsFixture from "./fixtures/whirlpool-charts.json";

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
    expect(result.tip_block_height).toBe(951952);
    expect(result.pools).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/summary`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("serves the second call from cache without a second fetch", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(summaryFixture));
    await getWhirlpoolSummary(BASE);
    const second = await getWhirlpoolSummary(BASE);
    expect(second.tip_block_height).toBe(951952);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("getWhirlpoolCharts", () => {
  it("fetches and parses the charts endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonOk(chartsFixture));
    const result = await getWhirlpoolCharts(BASE);
    expect(result.blocks).toEqual([899205, 899336, 911228, 920000, 935000, 945000, 951952]);
    expect(result.capacity_btc["0.025_BTC_Pool"][result.blocks.length - 1]).toBe(22.95);
    expect(result.capacity_btc["0.25_BTC_Pool"][result.blocks.length - 1]).toBe(95.5);
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/charts`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
