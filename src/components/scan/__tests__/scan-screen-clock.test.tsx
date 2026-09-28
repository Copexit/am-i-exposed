// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { FetchProgress } from "@/hooks/useAnalysis";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) ?? key,
  }),
}));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    isUmbrel: false,
    customApiUrl: null,
    torStatus: "clearnet",
    config: { mempoolBaseUrl: "https://mempool.space/api", label: "Mainnet" },
  }),
}));

import { ScanScreen } from "../ScanScreen";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const QUERY = "a".repeat(64);
const readout = (label: string) =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? "";

describe("ScanScreen trace clock", () => {
  it("measures the trace against its budget from when the trace started, not from scan start", async () => {
    vi.useFakeTimers();
    const props = { query: QUERY, inputType: "txid", phase: "fetching" as const, steps: [] };
    const { rerender } = render(<ScanScreen {...props} fetchProgress={null} />);

    // 22s of pre-trace fetching (tx, prices, outspends, parents; slow or rate limited)
    await act(() => vi.advanceTimersByTimeAsync(22_000));
    expect(readout("Elapsed")).toBe("22s");

    const fp: FetchProgress = {
      status: "tracing-backward", timeoutSec: 30, currentDepth: 1, maxDepth: 6, txsFetched: 0, startedAt: Date.now(),
    };
    rerender(<ScanScreen {...props} fetchProgress={fp} />);
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(readout("Trace / time limit")).toBe("12s / 30s");

    // The trace budget (enforced by runChainTrace) runs out; the readout never passes it
    rerender(<ScanScreen {...props} fetchProgress={{ ...fp, status: "tracing-forward" }} />);
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.queryByText(/52s \/ 30s/)).toBeNull();
    expect(readout("Trace / time limit")).toBe("30s / 30s");

    // Trace done: the total elapsed time is shown again, under its own label
    rerender(<ScanScreen {...props} phase="analyzing" fetchProgress={{ ...fp, status: "done" }} />);
    expect(readout("Elapsed")).toBe("54s");
  });
});
