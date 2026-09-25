"use client";

import { useState, useEffect, useEffectEvent, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion } from "@/hooks/useGraphExpansion";
import { ChartErrorBoundary } from "@/components/ui/ChartErrorBoundary";
import { EXAMPLES, TXID_RE } from "@/lib/constants";
import { decodeGraphFromUrl } from "@/lib/graph/graph-url-codec";
import { loadSavedGraph } from "@/lib/graph/graph-loader";
import { savedGraphStore } from "@/hooks/useSavedGraphs";
import type { MempoolTransaction } from "@/lib/api/types";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

const GraphExplorer = lazy(() =>
  import("@/components/viz/GraphExplorer").then((m) => ({ default: m.GraphExplorer })),
);

/** Txid-only examples for random selection on initial load. */
const TX_EXAMPLES = EXAMPLES.filter((e) => TXID_RE.test(e.input));

export default function GraphPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { network, config, configFor, setNetwork, isUmbrel, localApiStatus, torStatus } = useNetwork();
  const api = useMemo(() => createApiClient(config), [config]);
  // Initial load waits until the backend is known (Umbrel / Tor onion / clearnet)
  const apiReady = localApiStatus !== "checking" && torStatus !== "checking";

  const graph = useGraphExpansion(api);
  const { nodes, rootTxid, setRoot, loadGraph } = graph;

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [currentGraphId, setCurrentGraphId] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [lastLoadedGraph, setLastLoadedGraph] = useState<SavedGraph | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  // Abort any in-flight load on unmount
  useEffect(() => () => loadAbortRef.current?.abort(), []);

  /** Load a single txid as root. Shares loadAbortRef with saved-graph loads: last request wins. */
  const loadTxid = useCallback(
    async (txid: string, label?: string | null) => {
      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;

      setSearchLoading(true);
      setSearchError(null);
      setCurrentLabel(label ?? null);
      setCurrentGraphId(null);
      try {
        const tx: MempoolTransaction = await createApiClient(config, ac.signal).getTransaction(txid);
        if (ac.signal.aborted) return;
        setRoot(tx);
      } catch {
        if (ac.signal.aborted) return;
        setSearchError(
          t("graphPage.errorNotFound", {
            defaultValue: "Transaction not found. Check the ID and try again.",
          }),
        );
      } finally {
        if (!ac.signal.aborted) setSearchLoading(false);
      }
    },
    [config, setRoot, t],
  );

  /** Load a saved graph: re-fetch all txids, then dispatch LOAD_GRAPH. */
  const handleLoadSavedGraph = useCallback(
    async (saved: SavedGraph) => {
      if (saved.network !== network) {
        // Umbrel serves only its node's network: refuse instead of switching
        if (isUmbrel) {
          setSearchError(
            t("graphSaveLoad.networkUnavailable", {
              network: saved.network,
              nodeNetwork: network,
              defaultValue: `This graph was saved on ${saved.network}, but this node only serves ${network}.`,
            }),
          );
          return;
        }
        const confirmed = window.confirm(
          t("graphSaveLoad.networkMismatch", {
            network: saved.network,
            defaultValue: `This graph was saved on ${saved.network}. Switch network and load?`,
          }),
        );
        if (!confirmed) return;
        setNetwork(saved.network);
      }

      loadAbortRef.current?.abort();
      const ac = new AbortController();
      loadAbortRef.current = ac;

      setSearchLoading(true);
      setSearchError(null);
      setLoadWarning(null);
      setLoadProgress({ loaded: 0, total: saved.nodes.length });
      setCurrentLabel(saved.name || null);
      setCurrentGraphId(saved.id || null);

      try {
        // Build the client for the graph's network: `api` still points at the
        // pre-switch network until the next render.
        const result = await loadSavedGraph(
          saved, createApiClient(configFor(saved.network)),
          (loaded, total) => setLoadProgress({ loaded, total }),
          ac.signal,
        );
        if (ac.signal.aborted) return;

        if (result.nodes.size === 0) {
          setSearchError(t("graphSaveLoad.loadFailed", { defaultValue: "Failed to load graph." }));
          return;
        }

        loadGraph(result.nodes, result.rootTxid, result.rootTxids);
        setLastLoadedGraph(saved);

        if (result.failedTxids.length > 0) {
          setLoadWarning(
            t("graphSaveLoad.partialLoad", {
              count: result.failedTxids.length,
              defaultValue: `${result.failedTxids.length} transaction(s) could not be loaded.`,
            }),
          );
        }
      } catch {
        if (!ac.signal.aborted) {
          setSearchError(t("graphSaveLoad.loadError", { defaultValue: "Failed to load saved graph." }));
        }
      } finally {
        if (!ac.signal.aborted) {
          setSearchLoading(false);
          setLoadProgress(null);
        }
      }
    },
    [configFor, network, isUmbrel, setNetwork, loadGraph, t],
  );

  // Hash-based routing: #txid=<hex> or #graph=<base64url>.
  // An effect event so it always sees the latest api, network and rootTxid.
  const loadFromHash = useEffectEvent(() => {
    const hash = window.location.hash.slice(1);

    if (hash.startsWith("graph=")) {
      const encoded = hash.slice(6);
      const decoded = decodeGraphFromUrl(encoded);
      if (decoded) {
        const graphToLoad: SavedGraph = { id: "", name: "", savedAt: 0, ...decoded };
        handleLoadSavedGraph(graphToLoad);
        return;
      }
    }

    const match = hash.match(/^txid=([a-fA-F0-9]{64})$/);
    if (match) {
      const example = TX_EXAMPLES.find((e) => e.input.toLowerCase() === match[1].toLowerCase());
      loadTxid(match[1], example?.labelDefault);
    } else if (!rootTxid) {
      // Check for saved graphs - load the most recently saved/modified
      const savedGraphs = savedGraphStore.getSnapshot();
      if (savedGraphs.length > 0) {
        handleLoadSavedGraph(savedGraphs[0]);
      } else {
        // First visit - random example (the hashchange handler loads it)
        const example = TX_EXAMPLES[Math.floor(Math.random() * TX_EXAMPLES.length)];
        if (example) window.location.hash = `txid=${example.input}`;
      }
    }
  });

  useEffect(() => {
    if (!apiReady) return;
    const onHashChange = () => loadFromHash();
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [apiReady]);

  const navigateToTxid = useCallback(
    (txid: string) => {
      const next = `txid=${txid}`;
      // Setting the hash fires hashchange, which loads. Same hash: reload directly.
      if (window.location.hash.slice(1) !== next) {
        window.location.hash = next;
        return;
      }
      const example = TX_EXAMPLES.find((e) => e.input.toLowerCase() === txid.toLowerCase());
      loadTxid(txid, example?.labelDefault);
    },
    [loadTxid],
  );

  const handleFullScan = useCallback((txid: string) => {
    router.push(`/#tx=${txid}`);
  }, [router]);

  // Auto-clear load warning after 8 seconds
  useEffect(() => {
    if (!loadWarning) return;
    const timer = setTimeout(() => setLoadWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [loadWarning]);

  return (
    <div className="relative w-full h-[calc(100vh-72px)] sm:h-[calc(100vh-80px)]">
      <ChartErrorBoundary>
        <Suspense fallback={null}>
          <GraphExplorer
            graph={graph}
            onTxClick={handleFullScan}
            alwaysFullscreen
            onSetAsRoot={navigateToTxid}
            onSearch={navigateToTxid}
            searchLoading={searchLoading}
            searchError={searchError}
            currentLabel={currentLabel}
            network={network}
            currentGraphId={currentGraphId}
            onLoadSavedGraph={handleLoadSavedGraph}
            lastLoadedGraph={lastLoadedGraph}
          />
        </Suspense>
      </ChartErrorBoundary>

      {/* Loading overlay (shown when graph has no nodes yet) */}
      {searchLoading && nodes.size === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-sm text-muted animate-pulse">
            {loadProgress
              ? t("graphSaveLoad.loadingGraph", {
                  loaded: loadProgress.loaded,
                  total: loadProgress.total,
                  defaultValue: `Loading graph... (${loadProgress.loaded}/${loadProgress.total} transactions)`,
                })
              : t("graphPage.loadingTx", { defaultValue: "Loading transaction..." })}
          </div>
        </div>
      )}

      {/* Load warning banner */}
      {loadWarning && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 glass rounded-lg border border-severity-medium/30 px-4 py-2 text-xs text-severity-medium max-w-md text-center">
          {loadWarning}
          <button onClick={() => setLoadWarning(null)} className="ml-2 text-muted hover:text-foreground cursor-pointer">&times;</button>
        </div>
      )}
    </div>
  );
}
