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
}));

vi.mock("@/lib/observatory/liquisabi-client", () => ({
  getLiquiSabiDashboard: vi.fn(),
}));

import { useObservatory } from "../useObservatory";
import {
  getWhirlpoolCharts,
  getWhirlpoolSummary,
} from "@/lib/observatory/whirlpool-client";
import { getLiquiSabiDashboard } from "@/lib/observatory/liquisabi-client";

beforeEach(async () => {
  vi.mocked(getWhirlpoolSummary).mockReset();
  vi.mocked(getWhirlpoolCharts).mockReset();
  vi.mocked(getLiquiSabiDashboard).mockReset();
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
    vi.mocked(getLiquiSabiDashboard).mockResolvedValue({
      Coordinators: [],
    } as never);

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.whirlpool?.summary.pools[0].pool).toBe("0.025_BTC_Pool");
    expect(result.current.liquisabi?.Coordinators).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdatedAt).not.toBeNull();
  });

  it("surfaces an error string when every upstream fails", async () => {
    vi.mocked(getWhirlpoolSummary).mockRejectedValue(new Error("boom"));
    vi.mocked(getWhirlpoolCharts).mockRejectedValue(new Error("boom"));
    vi.mocked(getLiquiSabiDashboard).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useObservatory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
    expect(result.current.whirlpool).toBeNull();
    expect(result.current.liquisabi).toBeNull();
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
