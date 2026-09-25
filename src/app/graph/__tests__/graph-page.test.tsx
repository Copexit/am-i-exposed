// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup, screen } from "@testing-library/react";
import { NETWORK_CONFIG, type BitcoinNetwork, type NetworkConfig } from "@/lib/bitcoin/networks";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

const TX_A = "a".repeat(64);
const TX_B = "b".repeat(64);
const UMBREL: NetworkConfig = { ...NETWORK_CONFIG.mainnet, mempoolBaseUrl: "/api" };

const h = vi.hoisted(() => ({
  net: {} as Record<string, unknown>,
  /** getTransaction calls: [baseUrl, txid] */
  calls: [] as Array<[string, string]>,
  /** per-txid delay in ms */
  delays: {} as Record<string, number>,
  setRoot: vi.fn(),
  loadGraph: vi.fn(),
  loadSavedGraph: vi.fn(),
  explorerProps: {} as Record<string, (...args: never[]) => unknown>,
}));

/** A callback prop captured from the mocked GraphExplorer; throws if it was never passed. */
function explorerProp(name: string) {
  const fn = h.explorerProps[name];
  if (!fn) throw new Error(`GraphExplorer prop "${name}" was not captured`);
  return fn;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}));
vi.mock("@/components/ui/ChartErrorBoundary", () => ({
  ChartErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => h.net }));
vi.mock("@/lib/api/client", () => ({
  createApiClient: (config: NetworkConfig, signal?: AbortSignal) => ({
    base: config.mempoolBaseUrl,
    getTransaction: (txid: string) => {
      h.calls.push([config.mempoolBaseUrl, txid]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ txid, base: config.mempoolBaseUrl }), h.delays[txid] ?? 10);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  }),
}));
vi.mock("@/hooks/useGraphExpansion", () => ({
  useGraphExpansion: () => ({
    nodes: new Map(), rootTxid: null, loading: false, errors: new Map(), nodeCount: 0, maxNodes: 100,
    setRoot: h.setRoot, loadGraph: h.loadGraph,
  }),
}));
vi.mock("@/lib/graph/graph-loader", () => ({ loadSavedGraph: h.loadSavedGraph }));
vi.mock("@/hooks/useSavedGraphs", () => ({ savedGraphStore: { getSnapshot: () => [] } }));
vi.mock("@/components/viz/GraphExplorer", () => ({
  GraphExplorer: (props: Record<string, (...args: never[]) => unknown>) => {
    h.explorerProps = props;
    return null;
  },
}));

import GraphPage from "../page";

beforeAll(async () => {
  // Resolve the lazy GraphExplorer chunk once with real timers
  setNet({ localApiStatus: "checking", torStatus: "checking" });
  const r = render(<GraphPage />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  r.unmount();
});

function setNet(over: Record<string, unknown> = {}) {
  const network = (over.network as BitcoinNetwork) ?? "mainnet";
  h.net = {
    network,
    config: NETWORK_CONFIG[network],
    configFor: (n: BitcoinNetwork) => NETWORK_CONFIG[n],
    setNetwork: vi.fn(),
    isUmbrel: false,
    localApiStatus: "unavailable",
    torStatus: "clearnet",
    ...over,
  };
}

async function flush(ms = 1000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderPage() {
  const r = render(<GraphPage />);
  await flush(); // resolve lazy GraphExplorer + pending loads
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.calls = [];
  h.delays = {};
  h.setRoot.mockClear();
  h.loadGraph.mockClear();
  h.loadSavedGraph.mockReset();
  h.loadSavedGraph.mockResolvedValue({ nodes: new Map([["x", {}]]), rootTxid: "x", rootTxids: ["x"], failedTxids: [] });
  window.history.replaceState(null, "", `/graph/#txid=${TX_A}`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GraphPage", () => {
  it("waits for backend detection and then loads with the live (Umbrel) api", async () => {
    setNet({ localApiStatus: "checking", torStatus: "checking" });
    const r = await renderPage();
    expect(h.calls).toEqual([]);

    setNet({ config: UMBREL, isUmbrel: true, localApiStatus: "available" });
    r.rerender(<GraphPage />);
    await flush();
    expect(h.calls).toEqual([["/api", TX_A]]);
  });

  it("navigating to a txid fetches it exactly once", async () => {
    setNet();
    await renderPage();
    h.calls = [];
    act(() => {
      explorerProp("onSearch")(TX_B as never);
    });
    await flush();
    expect(h.calls.map(([, t]) => t)).toEqual([TX_B]);
  });

  it("the last requested txid wins even if an earlier response is slower", async () => {
    setNet();
    await renderPage();
    h.setRoot.mockClear();
    h.delays = { [TX_A]: 500, [TX_B]: 10 };
    // Same-hash reload path + a new-hash path, back to back
    act(() => {
      explorerProp("onSearch")(TX_A as never);
    });
    act(() => {
      explorerProp("onSearch")(TX_B as never);
    });
    await flush();
    expect(h.setRoot.mock.calls.map(([tx]) => (tx as { txid: string }).txid)).toEqual([TX_B]);
  });

  it("loads a saved graph from another network with that network's client", async () => {
    setNet();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPage();
    const saved = { id: "g", name: "", savedAt: 0, network: "signet", nodes: [], rootTxid: TX_A } as unknown as SavedGraph;
    await act(async () => {
      await explorerProp("onLoadSavedGraph")(saved as never);
    });
    expect((h.net.setNetwork as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("signet");
    const fetcher = h.loadSavedGraph.mock.calls[0]?.[1] as { base: string };
    expect(fetcher.base).toBe(NETWORK_CONFIG.signet.mempoolBaseUrl);
  });

  it("refuses a saved graph from another network on Umbrel", async () => {
    setNet({ config: UMBREL, configFor: () => UMBREL, isUmbrel: true, localApiStatus: "available" });
    const confirm = vi.spyOn(window, "confirm");
    await renderPage();
    const saved = { id: "g", name: "", savedAt: 0, network: "signet", nodes: [], rootTxid: TX_A } as unknown as SavedGraph;
    await act(async () => {
      await explorerProp("onLoadSavedGraph")(saved as never);
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(h.loadSavedGraph).not.toHaveBeenCalled();
    expect(h.net.setNetwork).not.toHaveBeenCalled();
    expect(screen.queryByText(/saved on signet/)).toBeNull(); // error goes to GraphExplorer searchError
    expect(String(h.explorerProps.searchError)).toMatch(/signet/);
  });
});
