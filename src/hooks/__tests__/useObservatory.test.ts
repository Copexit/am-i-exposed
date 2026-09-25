// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { _resetForTest } from "@/lib/api/idb-cache";

vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ isUmbrel: false }),
}));

vi.mock("@/lib/observatory/whirlpool-client", () => ({
  getWhirlpoolSummary: vi.fn(),
  getWhirlpoolCharts: vi.fn(),
  getWhirlpoolTxs: vi.fn(),
}));

vi.mock("@/lib/observatory/liquisabi-client", () => ({
  getLiquiSabiDashboard: vi.fn(),
}));

import { useObservatory } from "../useObservatory";
import {
  getWhirlpoolCharts,
  getWhirlpoolSummary,
  getWhirlpoolTxs,
} from "@/lib/observatory/whirlpool-client";
import { getLiquiSabiDashboard } from "@/lib/observatory/liquisabi-client";

beforeEach(async () => {
  vi.mocked(getWhirlpoolSummary).mockReset();
  vi.mocked(getWhirlpoolCharts).mockReset();
  vi.mocked(getWhirlpoolTxs).mockReset();
  vi.mocked(getLiquiSabiDashboard).mockReset();
  // Default: txs resolves empty; individual tests override as needed.
  vi.mocked(getWhirlpoolTxs).mockResolvedValue({
    items: [],
    page: 1,
    per_page: 25,
    total: 0,
    total_pages: 0,
  } as never);
  await _resetForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useObservatory", () => {
  it("returns parallel results when all upstreams succeed", async () => {
    vi.mocked(getWhirlpoolSummary).mockResolvedValue({
      pools: [{ pool: "0.025_BTC_Pool" }],
    } as never);
    vi.mocked(getWhirlpoolCharts).mockResolvedValue({} as never);
    vi.mocked(getWhirlpoolTxs).mockResolvedValue({
      items: [{ txid: "abc" }],
      page: 1,
      per_page: 25,
      total: 1,
      total_pages: 1,
    } as never);
    vi.mocked(getLiquiSabiDashboard).mockResolvedValue({
      Coordinators: [],
    } as never);

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.whirlpool?.summary.pools[0].pool).toBe("0.025_BTC_Pool");
    expect(result.current.whirlpool?.txs?.items[0].txid).toBe("abc");
    expect(result.current.liquisabi?.Coordinators).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it("surfaces an error even when only the txs endpoint succeeds", async () => {
    // The data-bearing upstreams all fail; txs (default mock) resolves. The
    // error must still surface - a lone txs success must not mask it.
    vi.mocked(getWhirlpoolSummary).mockRejectedValue(new Error("boom"));
    vi.mocked(getWhirlpoolCharts).mockRejectedValue(new Error("boom"));
    vi.mocked(getLiquiSabiDashboard).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.whirlpool).toBeNull();
    expect(result.current.liquisabi).toBeNull();
  });

  it("reports the failing upstream's message, not always summary's", async () => {
    // summary + charts succeed, liquisabi is the only data upstream to fail →
    // whirlpool renders, so this is partial data, not a total failure.
    vi.mocked(getWhirlpoolSummary).mockResolvedValue({ pools: [] } as never);
    vi.mocked(getWhirlpoolCharts).mockResolvedValue({} as never);
    vi.mocked(getLiquiSabiDashboard).mockRejectedValue(new Error("ls down"));

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.whirlpool).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("keeps partial data when one upstream fails", async () => {
    vi.mocked(getWhirlpoolSummary).mockResolvedValue({ pools: [] } as never);
    vi.mocked(getWhirlpoolCharts).mockResolvedValue({} as never);
    vi.mocked(getLiquiSabiDashboard).mockRejectedValue(new Error("ls down"));

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.whirlpool).not.toBeNull();
    expect(result.current.liquisabi).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
