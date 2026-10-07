// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { _resetForTest } from "@/lib/api/idb-cache";

const network = { isUmbrel: false, apiReady: true };
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => network,
}));

vi.mock("@/lib/observatory/whirlpool-client", () => ({
  getWhirlpoolSummary: vi.fn(),
  getWhirlpoolCharts: vi.fn(),
  getWhirlpoolTxs: vi.fn(),
}));

import { useObservatory } from "../useObservatory";
import {
  getWhirlpoolCharts,
  getWhirlpoolSummary,
  getWhirlpoolTxs,
} from "@/lib/observatory/whirlpool-client";

beforeEach(async () => {
  vi.mocked(getWhirlpoolSummary).mockReset();
  vi.mocked(getWhirlpoolCharts).mockReset();
  vi.mocked(getWhirlpoolTxs).mockReset();
  // Default: txs resolves empty; individual tests override as needed.
  vi.mocked(getWhirlpoolTxs).mockResolvedValue({
    items: [],
    page: 1,
    per_page: 25,
    total: 0,
    total_pages: 0,
  } as never);
  await _resetForTest();
  Object.assign(network, { isUmbrel: false, apiReady: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useObservatory", () => {
  it("fetches nothing until the network config settles (an Umbrel user must never hit the public worker)", async () => {
    Object.assign(network, { isUmbrel: false, apiReady: false });
    const { rerender } = renderHook(() => useObservatory());
    await new Promise((r) => setTimeout(r, 10));
    expect(getWhirlpoolSummary).not.toHaveBeenCalled();

    Object.assign(network, { isUmbrel: true, apiReady: true });
    rerender();
    await waitFor(() => expect(getWhirlpoolSummary).toHaveBeenCalled());
    expect(String(vi.mocked(getWhirlpoolSummary).mock.calls[0]?.[0])).not.toContain("workers.dev");
  });

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

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.whirlpool?.summary.pools[0]?.pool).toBe("0.025_BTC_Pool");
    expect(result.current.whirlpool?.txs?.items[0]?.txid).toBe("abc");
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it("surfaces an error even when only the txs endpoint succeeds", async () => {
    // The data-bearing upstreams all fail; txs (default mock) resolves. The
    // error must still surface - a lone txs success must not mask it.
    vi.mocked(getWhirlpoolSummary).mockRejectedValue(new Error("boom"));
    vi.mocked(getWhirlpoolCharts).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.whirlpool).toBeNull();
  });

  it("keeps the pools when only the cycles endpoint fails", async () => {
    vi.mocked(getWhirlpoolSummary).mockResolvedValue({ pools: [] } as never);
    vi.mocked(getWhirlpoolCharts).mockResolvedValue({} as never);
    vi.mocked(getWhirlpoolTxs).mockRejectedValue(new Error("txs down"));

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.whirlpool).not.toBeNull();
    expect(result.current.whirlpool?.txs).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
