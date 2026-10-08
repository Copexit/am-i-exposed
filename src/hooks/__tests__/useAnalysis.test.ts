// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api/fetch-with-retry";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";
import type { ScoringResult } from "@/lib/types";

// The first test pays for importing the hook's module graph; on a loaded
// machine (parallel workers) that alone can exceed the 5s default.
vi.setConfig({ testTimeout: 20_000 });

const m = vi.hoisted(() => ({
  getCachedResult: vi.fn(),
  putCachedResult: vi.fn(),
  runTxidAnalysis: vi.fn(),
  detectTxidNetwork: vi.fn(),
  createApiClient: vi.fn(),
  parseLocalTx: vi.fn(),
  runLocalAnalysis: vi.fn(),
  setNetwork: vi.fn(),
  createMempoolClient: vi.fn(),
  lookupClient: { tag: "lookup" },
  isUmbrel: false,
  networkUnverified: false,
  host: "http://onion.example",
}));

vi.mock("@/lib/api/analysis-cache", () => ({
  getCachedResult: m.getCachedResult,
  putCachedResult: m.putCachedResult,
}));
vi.mock("@/lib/analysis/run-txid-analysis", () => ({ runTxidAnalysis: m.runTxidAnalysis }));
vi.mock("@/lib/analysis/run-address-analysis", () => ({ runAddressAnalysis: vi.fn() }));
vi.mock("@/lib/api/detect-network", async (orig) => ({ ...(await orig<typeof import("@/lib/api/detect-network")>()), detectTxidNetwork: m.detectTxidNetwork }));
vi.mock("@/lib/api/client", () => ({
  createApiClient: m.createApiClient,
  isLocalApi: (u: string) => u.includes("umbrel") || u.includes("localhost"),
}));
vi.mock("@/lib/input/local-tx", () => ({
  parseLocalTx: m.parseLocalTx,
  localTxLabel: () => ({ key: "local.queryPsbt", inputs: 0, outputs: 0 }),
  isRawTxHex: () => false,
}));
vi.mock("@/lib/analysis/run-local-analysis", () => ({
  runLocalAnalysis: m.runLocalAnalysis,
  countLookups: () => ({ inputs: 1, addresses: 2 }),
  LookupFailedError: class LookupFailedError extends Error {},
}));
vi.mock("@/lib/api/mempool", () => ({ createMempoolClient: m.createMempoolClient }));
vi.mock("@/lib/analysis/entity-filter", () => ({ loadEntityFilter: vi.fn() }));
vi.mock("@/lib/analysis/orchestrator", () => ({
  getTxHeuristicSteps: () => [{ id: "h1", label: "h1", status: "pending" }],
  getAddressHeuristicSteps: () => [{ id: "a1", label: "a1", status: "pending" }],
}));
// Like i18next: the bundled English catalog wins over defaultValue, and a
// missing interpolation variable stays as the raw {{name}}.
vi.mock("react-i18next", async () => {
  const en = (await import("../../../public/locales/en/common.json")).default as Record<string, string>;
  const t = (k: string, o: Record<string, unknown> = {}) =>
    (en[k] ?? (typeof o.defaultValue === "string" ? o.defaultValue : k))
      .replace(/\{\{(\w+)\}\}/g, (raw, name: string) => (name in o ? String(o[name]) : raw));
  return { useTranslation: () => ({ t }) };
});

const onionConfigFor = (n: BitcoinNetwork) => ({ mempoolBaseUrl: `${m.host}/${n}/api` });
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({
    network: "mainnet",
    setNetwork: m.setNetwork,
    // Tor: the active backend is mempool.space's onion, which is not a custom API
    get config() { return onionConfigFor("mainnet"); },
    configFor: onionConfigFor,
    customApiUrl: null,
    get isUmbrel() { return m.isUmbrel; },
    get networkUnverified() { return m.networkUnverified; },
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
  m.host = "http://onion.example";
  m.isUmbrel = false;
  m.networkUnverified = false;
  m.createMempoolClient.mockReturnValue(m.lookupClient);
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
    // StrictMode double-invokes state updaters: a cache write inside one would run twice
    const { result: hook } = renderHook(() => useAnalysis(), { wrapper: StrictMode });
    await act(async () => { await hook.current.analyze(TXID); });

    expect(hook.current.phase).toBe("complete");
    expect(m.putCachedResult).toHaveBeenCalledTimes(1);
    const [net, query, , state] = m.putCachedResult.mock.calls[0]!;
    expect(net).toBe("mainnet@http://onion.example/mainnet/api");
    expect(query).toBe(TXID);
    expect(state.phase).toBe("complete");
  });

  it("keys the result cache by backend, so another base URL misses the cache", async () => {
    const store = new Map<string, unknown>();
    m.getCachedResult.mockImplementation(async (net: string, q: string) => store.get(`${net}|${q}`) ?? null);
    m.putCachedResult.mockImplementation(async (net: string, q: string, _s: unknown, st: unknown) => { store.set(`${net}|${q}`, st); });
    m.runTxidAnalysis.mockResolvedValue(txOutcome(result()));
    const { result: hook, rerender } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });
    expect(m.runTxidAnalysis).toHaveBeenCalledTimes(1);

    m.host = "http://umbrel.local:3006";
    rerender();
    await act(async () => { await hook.current.analyze(TXID); });
    expect(m.runTxidAnalysis).toHaveBeenCalledTimes(2);
    expect(hook.current.fromCache).toBeFalsy();
  });

  it("takes isCustomApi from the network context, so Tor is not treated as self-hosted", async () => {
    m.runTxidAnalysis.mockResolvedValue(txOutcome(result()));
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID); });

    expect(m.runTxidAnalysis.mock.calls[0]![1].isCustomApi).toBe(false);
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

    const baseUrlFor = m.detectTxidNetwork.mock.calls[0]![3] as (n: BitcoinNetwork) => string;
    expect(baseUrlFor("signet")).toBe("http://onion.example/signet/api");
    expect(m.createApiClient).toHaveBeenLastCalledWith(onionConfigFor("testnet4"), expect.anything());
    expect(m.setNetwork).toHaveBeenCalledWith("testnet4");
    expect(hook.current.phase).toBe("complete");
    expect(hook.current.autoSwitchedNetwork).toBe("testnet4");
    expect(m.putCachedResult).toHaveBeenCalledTimes(1);
    expect(m.putCachedResult.mock.calls[0]![0]).toBe("testnet4@http://onion.example/testnet4/api");
  });

  it("awaitIndexing skips the result cache and NOT_FOUND auto-detect, and flags the wait", async () => {
    m.getCachedResult.mockResolvedValue({ result: result() });
    m.runTxidAnalysis.mockImplementation(() => new Promise(() => {}));
    const { result: hook } = renderHook(() => useAnalysis());
    act(() => { void hook.current.analyze(TXID, { awaitIndexing: true }); });
    await waitFor(() => expect(m.runTxidAnalysis).toHaveBeenCalled());
    expect(m.getCachedResult).not.toHaveBeenCalled();
    expect(m.runTxidAnalysis.mock.calls[0]![1]).toMatchObject({ awaitIndexing: true });
    expect(hook.current.awaitingIndex).toBe(true);
  });

  it("awaitIndexing never probes other networks when the tx stays NOT_FOUND", async () => {
    m.runTxidAnalysis.mockRejectedValue(new ApiError("NOT_FOUND", "nf"));
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze(TXID, { awaitIndexing: true }); });
    expect(m.detectTxidNetwork).not.toHaveBeenCalled();
    expect(hook.current.phase).toBe("error");
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
    m.parseLocalTx.mockReturnValue({ tx });
    m.runLocalAnalysis.mockResolvedValue({ result: result(), tx, boltzmannResult: null, boltzmannStatus: "idle" });
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze("cHNidP8BAAoCAAAAAAAAAAAAAAAA"); });

    expect(m.parseLocalTx).toHaveBeenCalledWith("cHNidP8BAAoCAAAAAAAAAAAAAAAA", "mainnet");
    expect(hook.current.phase).toBe("complete");
    expect(hook.current.query).not.toContain("cHNidP");
  });

  it("shows the parser's reason when a PSBT fails to parse", async () => {
    m.parseLocalTx.mockImplementation(() => { throw new Error("unexpected end of input"); });
    const { result: hook } = renderHook(() => useAnalysis());
    await act(async () => { await hook.current.analyze("cHNidP8BAAoC"); });

    expect(hook.current.phase).toBe("error");
    expect(hook.current.error).toBe("Could not read this transaction: unexpected end of input");
    expect(hook.current.query).not.toContain("cHNidP");
  });

  describe("local tx lookups", () => {
    const INPUT = "cHNidP8BAAoCAAAAAAAAAAAAAAAA";
    const LOCAL_RAW = {
      source: "raw", status: "signed", signedHex: "00", psbt: null, missingPrevouts: [0],
      tx: {
        txid: TXID,
        vin: [{ txid: "b".repeat(64), vout: 0, prevout: null }],
        vout: [{ value: 1000, scriptpubkey_address: "bc1qaaa" }, { value: 500, scriptpubkey_address: "bc1qbbb" }],
      },
    };
    const outcome = (lookedUp: boolean) => ({
      result: result(), tx: LOCAL_RAW.tx, lookedUp, outputTxCounts: null, boltzmannResult: null, boltzmannStatus: "idle",
    });
    beforeEach(() => {
      m.parseLocalTx.mockReturnValue(LOCAL_RAW);
      m.runLocalAnalysis.mockResolvedValue(outcome(false));
    });

    it("public backend: local tx analyzed without network, lookup offered", async () => {
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(INPUT); });
      expect(m.runLocalAnalysis).toHaveBeenCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: null }));
      expect(hook.current.localLookup).toEqual({ status: "available", inputs: 1, addresses: 2 });
      expect(m.createMempoolClient).not.toHaveBeenCalled();
    });

    it("completeLocalLookup re-runs with an uncached client", async () => {
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(INPUT); });
      m.runLocalAnalysis.mockResolvedValue(outcome(true));
      await act(async () => { await hook.current.completeLocalLookup(); });
      expect(m.createMempoolClient).toHaveBeenCalledWith(expect.stringContaining("/api"), expect.objectContaining({ timeoutMs: expect.any(Number) }));
      expect(m.runLocalAnalysis).toHaveBeenLastCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: m.lookupClient }));
      expect(hook.current.localLookup?.status).toBe("done");
      expect(m.createApiClient).not.toHaveBeenCalled();
    });

    it("a failed lookup keeps the result and allows a retry", async () => {
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(INPUT); });
      m.runLocalAnalysis.mockRejectedValue(new Error("down"));
      await act(async () => { await hook.current.completeLocalLookup(); });
      expect(hook.current.localLookup?.status).toBe("failed");
      expect(hook.current.phase).toBe("complete");
      expect(hook.current.result).not.toBeNull();
    });

    it("ignores a second completeLocalLookup while one is running", async () => {
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(INPUT); });
      let finish!: (v: unknown) => void;
      m.runLocalAnalysis.mockReturnValue(new Promise((r) => { finish = r; }));
      let first!: Promise<void>;
      await act(async () => { first = hook.current.completeLocalLookup(); await Promise.resolve(); });
      await waitFor(() => expect(m.runLocalAnalysis).toHaveBeenCalledTimes(2));
      const calls = m.runLocalAnalysis.mock.calls.length;
      await act(async () => { await hook.current.completeLocalLookup(); });
      expect(m.runLocalAnalysis.mock.calls.length).toBe(calls);
      await act(async () => { finish(outcome(true)); await first; });
      expect(hook.current.localLookup?.status).toBe("done");
    });

    it("self-hosted backend down: lookup-free result shown, status failed", async () => {
      m.isUmbrel = true;
      const { LookupFailedError } = await import("@/lib/analysis/run-local-analysis");
      m.runLocalAnalysis.mockRejectedValueOnce(new LookupFailedError());
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(INPUT); });
      expect(m.runLocalAnalysis).toHaveBeenCalledTimes(2);
      expect(m.runLocalAnalysis).toHaveBeenLastCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: null }));
      expect(hook.current.phase).toBe("complete");
      expect(hook.current.localLookup).toEqual({ status: "failed", inputs: 1, addresses: 2 });
    });

    it("self-hosted backend: looks up automatically", async () => {
      m.isUmbrel = true;
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(INPUT); });
      expect(m.runLocalAnalysis).toHaveBeenCalledWith(LOCAL_RAW, expect.objectContaining({ lookup: m.lookupClient }));
      expect(hook.current.localLookup?.status).toBe("done");
    });
  });

  describe("address of another network on a self-hosted backend", () => {
    const TB1 = "tb1q72xweewm4uvlkgzevmewy0dk3mmpymgr3n58qx";
    it("is refused, naming the backend's network, without a request", async () => {
      m.isUmbrel = true;
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(TB1); });
      expect(hook.current.phase).toBe("error");
      expect(hook.current.error).toBe("This address belongs to Testnet/Signet, but the connected backend serves Mainnet. It cannot be looked up there.");
      expect(m.createApiClient).not.toHaveBeenCalled();
    });

    it("says the backend's network could not be verified when it is assumed", async () => {
      m.isUmbrel = true;
      m.networkUnverified = true;
      const { result: hook } = renderHook(() => useAnalysis());
      await act(async () => { await hook.current.analyze(`https://mempool.space/testnet4/address/${TB1}`); });
      expect(hook.current.error).toContain("network could not be verified and is assumed to be Mainnet");
    });
  });
});
