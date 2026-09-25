import { describe, it, expect, vi } from "vitest";
import { runChainTrace } from "../chain-trace";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { makeTx, makeVin } from "../heuristics/__tests__/fixtures/tx-factory";
import type { AnalysisSettings } from "@/hooks/useAnalysisSettings";
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

function params(api: { getTransaction: (txid: string) => Promise<MempoolTransaction> }) {
  return {
    tx: makeTx({ vin: [makeVin({ txid: "1".repeat(64) }), makeVin({ txid: "2".repeat(64) })] }),
    settings,
    api: { ...api, getTxOutspends: async () => [] },
    controller: new AbortController(),
    setState: vi.fn(),
    onStep: () => {},
    parentTx: null,
    childTx: null,
    outspends: [],
  };
}

describe("runChainTrace", () => {
  it("reports backward tracing as failed when parent fetches are rate limited", async () => {
    const res = await runChainTrace(params({
      getTransaction: async () => { throw new ApiError("RATE_LIMITED"); },
    }));
    expect(res.backwardFailed).toBe(true);
    expect(res.forwardFailed).toBe(false);
  });

  it("does not report failure when every fetch succeeds", async () => {
    const res = await runChainTrace(params({
      getTransaction: async (txid) => makeTx({ txid, vin: [makeVin({ is_coinbase: true, prevout: null })] }),
    }));
    expect(res.backwardFailed).toBe(false);
    expect(res.backwardLayers[0].txs.size).toBe(2);
  });
});
