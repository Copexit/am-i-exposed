import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTxidAnalysis, type TxidAnalysisDeps } from "../run-txid-analysis";
import { ApiError } from "@/lib/api/fetch-with-retry";
import { sumImpact } from "@/lib/scoring/score";
import { makeTx, makeVin, makeVout, resetAddrCounter } from "../heuristics/__tests__/fixtures/tx-factory";
import type { Finding } from "@/lib/types";
import type { ApiClient } from "@/lib/api/client";
import type { MempoolTransaction } from "@/lib/api/types";

const chainFindings = vi.hoisted(() => ({ list: [] as Finding[], real: false, backwardFailed: false }));

vi.mock("@/lib/analysis/chain-trace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis/chain-trace")>();
  return {
    runChainTrace: async () => ({
      backwardLayers: [],
      forwardLayers: [],
      backwardFailed: chainFindings.backwardFailed,
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
  chainFindings.backwardFailed = false;
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

  it("publishes the transaction before the chain trace so the scan view can draw it", async () => {
    const tx = makeTestTx();
    const updates: Array<Record<string, unknown>> = [];
    const d = deps(makeApi(tx));
    d.setState = (u) => {
      const next = typeof u === "function" ? u({} as Parameters<typeof u>[0]) : u;
      updates.push(next as unknown as Record<string, unknown>);
    };
    await runTxidAnalysis(tx.txid, d);
    const firstWithTx = updates.findIndex((u) => u.txData === tx);
    const analyzing = updates.findIndex((u) => u.phase === "analyzing");
    expect(firstWithTx).toBeGreaterThanOrEqual(0);
    expect(firstWithTx).toBeLessThan(analyzing);
  });

  it("does not publish the transaction of an aborted scan", async () => {
    const tx = makeTestTx();
    const updates: Array<Record<string, unknown>> = [];
    const d = deps(makeApi(tx));
    d.controller.abort();
    d.setState = (u) => {
      const next = typeof u === "function" ? u({} as Parameters<typeof u>[0]) : u;
      updates.push(next as unknown as Record<string, unknown>);
    };
    await runTxidAnalysis(tx.txid, d).catch(() => {});
    expect(updates.some((u) => u.txData === tx)).toBe(false);
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

  it("does not fetch the raw tx hex (no heuristic reads it), so a hex failure cannot mark the result partial", async () => {
    const tx = makeTestTx();
    const getTxHex = vi.fn(async () => { throw new ApiError("RATE_LIMITED"); });
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx, { getTxHex })));
    expect(getTxHex).not.toHaveBeenCalled();
    expect(result.partial).toBeFalsy();
  });

  it("marks the result partial when a historical price fetch is rate limited", async () => {
    const tx = makeTestTx();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx, {
      getHistoricalPrice: async () => { throw new ApiError("RATE_LIMITED"); },
    })));
    expect(result.partial).toBe(true);
  });

  it("does not mark the result partial when a price lookup fails on the user's own node", async () => {
    const tx = makeTestTx();
    const d = deps(makeApi(tx, {
      getHistoricalPrice: async () => { throw new ApiError("API_UNAVAILABLE"); },
      getHistoricalEurPrice: async () => { throw new SyntaxError("Unexpected token <"); },
    }));
    const { result, usdPrice } = await runTxidAnalysis(tx.txid, { ...d, isCustomApi: true });
    expect(usdPrice).toBeNull();
    expect(result.partial).toBeFalsy();
    expect(result.findings.some((x) => x.id === "analysis-incomplete")).toBe(false);
  });

  it("still marks the result partial on the user's own node when a non-price lookup fails", async () => {
    const tx = makeTestTx();
    const d = deps(makeApi(tx, {
      getTxOutspends: async () => { throw new ApiError("RATE_LIMITED"); },
    }));
    const { result } = await runTxidAnalysis(tx.txid, { ...d, isCustomApi: true });
    expect(result.partial).toBe(true);
  });

  it("reports a failed chain trace once (chain-trace-partial, no second 'incomplete' finding)", async () => {
    chainFindings.backwardFailed = true;
    const tx = makeTestTx();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));
    expect(result.partial).toBe(true);
    const f = result.findings.find((x) => x.id === "chain-trace-partial");
    expect(f?.params?._variant).toBe("backward");
    expect(result.findings.some((x) => x.id === "analysis-incomplete")).toBe(false);
  });

  it("does not mark the result partial for NOT_FOUND (e.g. raw hex unavailable)", async () => {
    const tx = makeTestTx();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));
    expect(result.partial).toBeFalsy();
    expect(result.findings.some((x) => x.id === "analysis-incomplete")).toBe(false);
  });

  // Zero-entropy txs (1 input or 1 output) have only trivial links: H5 scores them.
  it.each([
    ["1-in/2-out payment", () => makeTx()],
    ["3-in/1-out consolidation", () => makeTx({
      vin: [makeVin(), makeVin({ txid: "c".repeat(64) }), makeVin({ txid: "d".repeat(64) })],
      vout: [makeVout({ value: 298_000 })],
    })],
  ])("emits no linkability finding for a trivial tx (%s, real runChainAnalysis)", async (_name, build) => {
    chainFindings.real = true;
    const tx = build();
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));
    expect(result.findings.filter((f) => f.id.startsWith("linkability-"))).toEqual([]);
  });

  it("counts deterministic links in the score (2-in/2-out, real runChainAnalysis)", async () => {
    chainFindings.real = true;
    const withValue = (txid: string, value: number) => {
      const v = makeVin({ txid });
      return { ...v, prevout: { ...v.prevout!, value } };
    };
    // 100k -> 90k and 50k -> 40k is the only split besides the merged reading
    const tx = makeTx({
      vin: [withValue("c".repeat(64), 100_000), withValue("d".repeat(64), 50_000)],
      vout: [makeVout({ value: 90_000 }), makeVout({ value: 40_000 })],
      fee: 20_000,
    });
    const { result } = await runTxidAnalysis(tx.txid, deps(makeApi(tx)));
    const f = result.findings.find((x) => x.id === "linkability-deterministic");
    expect(f?.scoreImpact).toBe(-6);
    expect(result.score).toBe(Math.max(0, Math.min(100, 70 + sumImpact(result.findings))));
  });
});
