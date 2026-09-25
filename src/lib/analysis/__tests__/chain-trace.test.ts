import { describe, it, expect, vi, afterEach } from "vitest";
import { runChainTrace } from "../chain-trace";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { makeTx, makeVin, makeVout } from "../heuristics/__tests__/fixtures/tx-factory";
import type { AnalysisSettings } from "@/lib/analysis/settings";
import type { FetchProgress } from "@/lib/analysis/analysis-state";
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
    expect(res.backwardLayers[0]?.txs.size).toBe(2);
  });

  it("reports progress through onProgress (no React state in lib code)", async () => {
    const progress: FetchProgress[] = [];
    await runChainTrace(params({ getTransaction: coinbaseParent }, (p) => progress.push(p)));
    expect(progress[0]).toMatchObject({ status: "tracing-backward", currentDepth: 0, maxDepth: 4 });
    expect(progress.some((p) => p.status === "tracing-forward")).toBe(true);
  });

  describe("skip settings (parent 1 is expandable, parent 2 is a coinbase)", () => {
    const grandparentIds = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`.padEnd(64, "0"));
    const whirlpoolMix = (txid: string) => makeTx({
      txid,
      vin: grandparentIds(5).map((id) => makeVin({ txid: id })),
      vout: Array.from({ length: 5 }, () => makeVout({ value: 1_000_000 })),
    });
    const largeConsolidation = (txid: string) => makeTx({
      txid,
      vin: grandparentIds(51).map((id) => makeVin({ txid: id })),
      vout: [makeVout({ value: 5_000_000 })],
    });
    const traceWith = async (parent1: (txid: string) => MempoolTransaction, s: Partial<AnalysisSettings>) => {
      const fetched: string[] = [];
      const res = await runChainTrace({
        ...params({
          getTransaction: async (txid) => {
            fetched.push(txid);
            return txid === "1".repeat(64) ? parent1(txid) : coinbaseParent(txid);
          },
        }),
        settings: { ...settings, ...s },
      });
      return { res, fetchedGrandparents: fetched.filter((id) => id.startsWith("f")).length };
    };

    it("expands through a CoinJoin parent by default", async () => {
      const { res, fetchedGrandparents } = await traceWith(whirlpoolMix, {});
      expect(fetchedGrandparents).toBe(5);
      expect(res.backwardLayers).toHaveLength(2);
    });

    it("skipCoinJoins keeps the CoinJoin in the trace but does not expand through it", async () => {
      const { res, fetchedGrandparents } = await traceWith(whirlpoolMix, { skipCoinJoins: true });
      expect(fetchedGrandparents).toBe(0);
      expect(res.backwardLayers).toHaveLength(1);
      expect(res.backwardLayers[0]?.txs.has("1".repeat(64))).toBe(true);
    });

    it("skipLargeClusters does not expand through a tx merging more than 50 input addresses", async () => {
      expect((await traceWith(largeConsolidation, {})).fetchedGrandparents).toBeGreaterThan(0);
      const { res, fetchedGrandparents } = await traceWith(largeConsolidation, { skipLargeClusters: true });
      expect(fetchedGrandparents).toBe(0);
      expect(res.backwardLayers[0]?.txs.has("1".repeat(64))).toBe(true);
    });
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
