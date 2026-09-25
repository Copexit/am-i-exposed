// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { ApiError } from "@/lib/api/fetch-with-retry";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { ScoringResult } from "@/lib/types";

const m = vi.hoisted(() => ({
  getCachedResult: vi.fn(),
  putCachedResult: vi.fn(),
  runTxidAnalysis: vi.fn(),
  detectTxidNetwork: vi.fn(),
  createApiClient: vi.fn(),
  parsePSBT: vi.fn(),
  analyzeTransaction: vi.fn(),
  setNetwork: vi.fn(),
}));

vi.mock("@/lib/api/analysis-cache", () => ({
  getCachedResult: m.getCachedResult,
  putCachedResult: m.putCachedResult,
}));
vi.mock("@/lib/analysis/run-txid-analysis", () => ({ runTxidAnalysis: m.runTxidAnalysis }));
vi.mock("@/lib/analysis/run-address-analysis", () => ({ runAddressAnalysis: vi.fn() }));
vi.mock("@/lib/api/detect-network", () => ({ detectTxidNetwork: m.detectTxidNetwork }));
vi.mock("@/lib/api/client", () => ({ createApiClient: m.createApiClient }));
vi.mock("@/lib/bitcoin/psbt", async (orig) => ({ ...(await orig<object>()), parsePSBT: m.parsePSBT }));
vi.mock("@/lib/analysis/entity-filter", () => ({ loadEntityFilter: vi.fn() }));
vi.mock("@/lib/analysis/orchestrator", () => ({
  analyzeTransaction: m.analyzeTransaction,
  getTxHeuristicSteps: () => [{ id: "h1", label: "h1", status: "pending" }],
  getAddressHeuristicSteps: () => [{ id: "a1", label: "a1", status: "pending" }],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}));

const onionConfigFor = (n: BitcoinNetwork) => ({ mempoolBaseUrl: `http://onion.example/${n}/api` });
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    network: "mainnet",
    setNetwork: m.setNetwork,
    // Tor: the active backend is mempool.space's onion, which is not a custom API
    config: onionConfigFor("mainnet"),
    configFor: onionConfigFor,
    customApiUrl: null,
    isUmbrel: false,
    isCustomApi: false,
  }),
}));

import { useAnalysis } from "../useAnalysis";

const TXID = "a".repeat(64);
const result = (extra: Partial<ScoringResult> = {}) =>
  ({ score: 70, grade: "C", findings: [], ...extra }) as unknown as ScoringResult;
const txOutcome = (r: ScoringResult) => ({ result: r, boltzmannResult: null, boltzmannStatus: null });

beforeEach(() => {
  vi.clearAllMocks();
  m.getCachedResult.mockResolvedValue(null);
  m.putCachedResult.mockResolvedValue(undefined);
  m.createApiClient.mockReturnValue({});
});
afterEach(cleanup);

describe("useAnalysis", () => {
  it("an analyze() aborted by reset() while the cache lookup is pending never shows 'fetching'", async () => {
    let resolveCache!: (v: null) => void;
    m.getCachedResult.mockReturnValue(new Promise((r) => { resolveCache = r; }));
    const { result: hook } = renderHook(() => useAnalysis());

    let pending!: Promise<void>;
    act(() => { pending = hook.current.analyze(TXID); });
    act(() => { hook.current.reset(); });
    await act(async () => { resolveCache(null); await pending; });

    expect(hook.current.phase).toBe("idle");
    expect(m.runTxidAnalysis).not.toHaveBeenCalled();
  });

  it("caches a complete txid result once, outside the state updater", async () => {
    m.runTxidAnalysis.mockResolvedValue(txOutcome(result()));
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });

    expect(hook.current.phase).toBe("complete");
    expect(m.putCachedResult).toHaveBeenCalledTimes(1);
    const [net, query, , state] = m.putCachedResult.mock.calls[0];
    expect(net).toBe("mainnet");
    expect(query).toBe(TXID);
    expect(state.phase).toBe("complete");
  });

  it("takes isCustomApi from the network context, so Tor is not treated as self-hosted", async () => {
    m.runTxidAnalysis.mockResolvedValue(txOutcome(result()));
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });

    expect(m.runTxidAnalysis.mock.calls[0][1].isCustomApi).toBe(false);
  });

  it("does not cache a partial result", async () => {
    m.runTxidAnalysis.mockResolvedValue(txOutcome(result({ partial: true } as Partial<ScoringResult>)));
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });

    expect(hook.current.phase).toBe("complete");
    expect(m.putCachedResult).not.toHaveBeenCalled();
  });

  it("NOT_FOUND auto-detect probes and retries on the active backend family (onion on Tor)", async () => {
    m.runTxidAnalysis
      .mockRejectedValueOnce(new ApiError("NOT_FOUND", "nf"))
      .mockResolvedValueOnce(txOutcome(result()));
    m.detectTxidNetwork.mockResolvedValue("testnet4");
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });

    const baseUrlFor = m.detectTxidNetwork.mock.calls[0][3] as (n: BitcoinNetwork) => string;
    expect(baseUrlFor("signet")).toBe("http://onion.example/signet/api");
    expect(m.createApiClient).toHaveBeenLastCalledWith(onionConfigFor("testnet4"), expect.anything());
    expect(m.setNetwork).toHaveBeenCalledWith("testnet4");
    expect(hook.current.phase).toBe("complete");
    expect(hook.current.autoSwitchedNetwork).toBe("testnet4");
    expect(m.putCachedResult).toHaveBeenCalledTimes(1);
    expect(m.putCachedResult.mock.calls[0][0]).toBe("testnet4");
  });

  it("maps API errors through the shared error mapper", async () => {
    m.runTxidAnalysis.mockRejectedValue(new ApiError("RATE_LIMITED", "429"));
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });

    expect(hook.current.phase).toBe("error");
    expect(hook.current.error).toMatch(/Rate limited/);
    expect(hook.current.errorCode).toBe("retryable");
  });

  it("parses a PSBT against the selected network", async () => {
    const tx = { txid: TXID, vin: [], vout: [] };
    m.parsePSBT.mockReturnValue({ tx });
    m.analyzeTransaction.mockResolvedValue(result());
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze("cHNidP8BAAoCAAAAAAAAAAAAAAAA"); });

    expect(m.parsePSBT).toHaveBeenCalledWith("cHNidP8BAAoCAAAAAAAAAAAAAAAA", "mainnet");
  });
});
