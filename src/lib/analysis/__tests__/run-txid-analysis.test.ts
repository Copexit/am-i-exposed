import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTxidAnalysis, type TxidAnalysisDeps } from "../run-txid-analysis";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { sumImpact } from "@/lib/scoring/score";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../heuristics/__tests__/fixtures/tx-factory";
import type { Finding } from "@/lib/types";
import type { ApiClient } from "@/lib/api/client";
import type { MempoolTransaction } from "@/lib/api/types";

const chainFindings = vi.hoisted(() => ({ list: [] as Finding[], real: false }));

vi.mock("@/lib/analysis/chain-trace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis/chain-trace")>();
  return {
    runChainTrace: async () => ({
      backwardLayers: [],
      forwardLayers: [],
      backwardFailed: false,
      forwardFailed: false,
    }),
    runChainAnalysis: async (p: Parameters<typeof actual.runChainAnalysis>[0]) => {
      if (chainFindings.real) return actual.runChainAnalysis(p);
      p.result.findings.push(...chainFindings.list.map((f) => ({ ...f, params: { ...f.params } })));
    },
  };
});

vi.mock("@/lib/analysis/boltzmann-compute", () => ({
  isAutoComputable: () => false,
  extractTxValues: () => ({ inputValues: [], outputValues: [] }),
  computeBoltzmann: async () => null,
}));

beforeEach(() => {
  resetAddrCounter();
  chainFindings.list = [];
  chainFindings.real = false;
});

function makeApi(tx: MempoolTransaction, overrides: Partial<Record<keyof ApiClient, unknown>> = {}): ApiClient {
  const base = {
    getTransaction: async () => tx,
    getTxHex: async () => { throw new ApiError("NOT_FOUND"); },
    getHistoricalPrice: async () => 40_000,
    getHistoricalEurPrice: async () => 37_000,
    getTxOutspends: async () => tx.vout.map(() => ({ spent: false })),
    getAddress: async () => ({
      chain_stats: { tx_count: 1 },
      mempool_stats: { tx_count: 0 },
    }),
  };
  return { ...base, ...overrides } as unknown as ApiClient;
}

function deps(api: ApiClient): TxidAnalysisDeps {
  return {
    api,
    controller: new AbortController(),
    network: "mainnet",
    isCustomApi: false,
    analysisSettingsForCache: {
      maxDepth: 0,
      minSats: 1000,
      skipLargeClusters: false,
      skipCoinJoins: false,
      timeout: 30,
      walletGapLimit: 5,
      enableCache: true,
      boltzmannTimeout: 300,
    },
    onStep: () => {},
    setState: () => {},
  };
}

// 2 inputs so no parent/child pre-fetch is attempted (not a peel candidate)
const makeTestTx = () => makeTx({ vin: [makeVin(), makeVin({ txid: "c".repeat(64) })] });

describe("runTxidAnalysis", () => {
  it("scores chain findings together with heuristic findings (one finalize)", async () => {
    chainFindings.list = [
      { id: "chain-coinjoin-input", severity: "good", title: "", description: "", recommendation: "", scoreImpact: 8 },
      {
        id: "chain-post-mix-consolidation", severity: "medium", title: "", description: "", recommendation: "",
        scoreImpact: -5, params: { postMixInputCount: 4 },
      },
    ];
    const tx = makeTestTx();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));

    // Compound rule on the combined set: heavy post-mix consolidation negates the CJ-input bonus
    expect(result.findings.find((f) => f.id === "chain-coinjoin-input")!.scoreImpact).toBe(0);
    // Chain findings reach the score
    expect(result.score).toBe(Math.max(0, Math.min(100, 70 + sumImpact(result.findings))));
    expect(result.findings.some((f) => f.id === "chain-post-mix-consolidation")).toBe(true);
  });

  it("marks the result partial when an optional enrichment fetch fails", async () => {
    const tx = makeTestTx();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx, {
      getTxOutspends: async () => { throw new ApiError("RATE_LIMITED"); },
    })));
    expect(result.partial).toBe(true);
    const f = result.findings.find((x) => x.id === "analysis-incomplete");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("low");
    expect(f!.scoreImpact).toBe(0);
  });

  it("does not mark the result partial for NOT_FOUND (e.g. raw hex unavailable)", async () => {
    const tx = makeTestTx();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));
    expect(result.partial).toBeFalsy();
    expect(result.findings.some((x) => x.id === "analysis-incomplete")).toBe(false);
  });

  // linkability.ts reports max ambiguity when nIn < nOut (no valid assignment)
  // and a trivial "deterministic" link when nOut == 1, so its findings stay
  // display-only until that model is fixed.
  it.each([
    ["1-in/2-out payment", () => makeTx()],
    ["3-in/1-out consolidation", () => makeTx({
      vin: [makeVin(), makeVin({ txid: "c".repeat(64) }), makeVin({ txid: "d".repeat(64) })],
      vout: [makeVout({ value: 298_000 })],
    })],
  ])("keeps linkability findings out of the score (%s, real runChainAnalysis)", async (_name, build) => {
    chainFindings.real = true;
    const tx = build();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));
    const link = result.findings.filter((f) => f.id.startsWith("linkability-"));
    expect(link.length).toBeGreaterThan(0);
    for (const f of link) expect(f.scoreImpact).toBe(0);
  });
});
