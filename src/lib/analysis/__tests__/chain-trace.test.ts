import { describe, it, expect, vi, afterEach } from "vitest";
import { runChainTrace } from "../chain-trace";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { makeTx, makeVin } from "../heuristics/__tests__/fixtures/tx-factory";
import type { AnalysisSettings } from "@/hooks/useAnalysisSettings";
import type { FetchProgress } from "@/hooks/useAnalysisState";
import type { MempoolTransaction } from "@/lib/api/types";

const settings: AnalysisSettings = {
  maxDepth: 2,
  minSats: 1000,
  skipLargeClusters: false,
  skipCoinJoins: false,
  timeout: 30,
  walletGapLimit: 5,
  enableCache: true,
  boltzmannTimeout: 300,
};

function params(
  api: { getTransaction: (txid: string) => Promise<MempoolTransaction> },
  onProgress: (p: FetchProgress) => void = () => {},
) {
  return {
    tx: makeTx({ vin: [makeVin({ txid: "1".repeat(64) }), makeVin({ txid: "2".repeat(64) })] }),
    settings,
    api: { ...api, getTxOutspends: async () => [] },
    controller: new AbortController(),
    onProgress,
    parentTx: null,
    childTx: null,
    outspends: [],
  };
}

const coinbaseParent = async (txid: string) =>
  makeTx({ txid, vin: [makeVin({ is_coinbase: true, prevout: null })] });

afterEach(() => { vi.useRealTimers(); });

describe("runChainTrace", () => {
  it("reports backward tracing as failed when parent fetches are rate limited", async () => {
    const res = await runChainTrace(params({
      getTransaction: async () => { throw new ApiError("RATE_LIMITED"); },
    }));
    expect(res.backwardFailed).toBe(true);
    expect(res.forwardFailed).toBe(false);
  });

  it("does not report failure when every fetch succeeds", async () => {
    const res = await runChainTrace(params({ getTransaction: coinbaseParent }));
    expect(res.backwardFailed).toBe(false);
    expect(res.backwardLayers[0].txs.size).toBe(2);
  });

  it("reports progress through onProgress (no React state in lib code)", async () => {
    const progress: FetchProgress[] = [];
    await runChainTrace(params({ getTransaction: coinbaseParent }, (p) => progress.push(p)));
    expect(progress[0]).toMatchObject({ status: "tracing-backward", currentDepth: 0, maxDepth: 4 });
    expect(progress.some((p) => p.status === "tracing-forward")).toBe(true);
  });

  it("stops a phase at its half timeout even while a request is still in flight", async () => {
    vi.useFakeTimers();
    const hung = vi.fn(() => new Promise<MempoolTransaction>(() => {}));
    // timeout 4s -> 2s per phase; forward has nothing to fetch (outspends known)
    const p = runChainTrace({ ...params({ getTransaction: hung }), settings: { ...settings, timeout: 4 } });
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true);
    expect((await p).backwardFailed).toBe(true);
    expect(hung).toHaveBeenCalledTimes(1);
  });
});
