"use client";

import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion } from "@/hooks/useGraphExpansion";
import { ChartErrorBoundary } from "@/components/ui/ChartErrorBoundary";
import { EXAMPLES, TXID_RE } from "@/lib/constants";
import { decodeGraphFromUrl } from "@/lib/graph/graph-url-codec";
import { loadSavedGraph } from "@/lib/graph/graph-loader";
import type { MempoolTransaction } from "@/lib/api/types";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";

const GraphExplorer = lazy(() =>
  import("@/components/viz/GraphExplorer").then((m) => ({ default: m.GraphExplorer })),
);

/** Txid-only examples for random selection on initial load. */
const TX_EXAMPLES = EXAMPLES.filter((e) => TXID_RE.test(e.input));

export default function GraphPage() {
  const { t } = useTranslation();
  const { network, config, setNetwork } = useNetwork();
  const api = useMemo(() => createApiClient(config), [config]);

  const {
    nodes,
    rootTxid,
    loading,
    errors,
    nodeCount,
    maxNodes,
    setRoot,
    loadGraph,
    expandInput,
    expandOutput,
    collapse,
    undo,
    canUndo,
    reset,
    expandedNodeTxid,
    toggleExpand,
    expandPortInput,
    expandPortOutput,
    outspendCache,
    autoTrace,
    cancelAutoTrace,
    autoTracing,
    autoTraceProgress,
    autoTraceLinkability,
  } = useGraphExpansion(api);

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [currentGraphId, setCurrentGraphId] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadTxid = useCallback(
    async (txid: string, label?: string | null) => {
      setSearchLoading(true);
      setSearchError(null);
      setCurrentLabel(label ?? null);
      setCurrentGraphId(null);
      try {
        const tx: MempoolTransaction = await api.getTransaction(txid);
        setRoot(tx);
      } catch {
        setSearchError(
          t("graphPage.errorNotFound", {
            defaultValue: "Transaction not found. Check the ID and try again.",
          }),
        );
      } finally {
        setSearchLoading(false);
      }
    },
    [api, setRoot, t],
  );

  /** Load a saved graph: re-fetch all txids, then dispatch LOAD_GRAPH. */
  const handleLoadSavedGraph = useCallback(
    async (saved: SavedGraph) => {
      if (saved.network !== network) {
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
        const result = await loadSavedGraph(
          saved, api,
          (loaded, total) => setLoadProgress({ loaded, total }),
          ac.signal,
        );
        if (ac.signal.aborted) return;

        if (result.nodes.size === 0) {
          setSearchError(t("graphSaveLoad.loadFailed", { defaultValue: "Failed to load graph." }));
          return;
        }

        loadGraph(result.nodes, result.rootTxid, result.rootTxids);

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
        setSearchLoading(false);
        setLoadProgress(null);
      }
    },
    [api, network, setNetwork, loadGraph, t],
  );

  // Hash-based routing: #txid=<hex> or #graph=<base64url>
  useEffect(() => {
    const loadFromHash = () => {
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
        const example = TX_EXAMPLES[Math.floor(Math.random() * TX_EXAMPLES.length)];
        if (example) {
          window.location.hash = `txid=${example.input}`;
          loadTxid(example.input, example.labelDefault);
        }
      }
    };

    loadFromHash();
    window.addEventListener("hashchange", loadFromHash);
    return () => window.removeEventListener("hashchange", loadFromHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateToTxid = useCallback(
    (txid: string) => {
      const example = TX_EXAMPLES.find((e) => e.input.toLowerCase() === txid.toLowerCase());
      window.location.hash = `txid=${txid}`;
      loadTxid(txid, example?.labelDefault);
    },
    [loadTxid],
  );

  const handleFullScan = useCallback((txid: string) => {
    window.location.href = `/#tx=${txid}`;
  }, []);

  // Auto-clear load warning after 8 seconds
  useEffect(() => {
    if (!loadWarning) return;
    const timer = setTimeout(() => setLoadWarning(null), 8000);
    return () => clearTimeout(timer);
  }, [loadWarning]);

  return (
    <div className="relative w-full" style={{ height: "calc(100vh - 80px)" }}>
      <ChartErrorBoundary>
        <Suspense fallback={null}>
          <GraphExplorer
            nodes={nodes}
            rootTxid={rootTxid}
            loading={loading}
            errors={errors}
            nodeCount={nodeCount}
            maxNodes={maxNodes}
            canUndo={canUndo}
            onExpandInput={expandInput}
            onExpandOutput={expandOutput}
            onCollapse={collapse}
            onUndo={undo}
            onReset={reset}
            onTxClick={handleFullScan}
            expandedNodeTxid={expandedNodeTxid}
            onToggleExpand={toggleExpand}
            onExpandPortInput={expandPortInput}
            onExpandPortOutput={expandPortOutput}
            outspendCache={outspendCache}
            onAutoTrace={autoTrace}
            onCancelAutoTrace={cancelAutoTrace}
            autoTracing={autoTracing}
            autoTraceProgress={autoTraceProgress}
            onAutoTraceLinkability={(txid, outputIndex) =>
              autoTraceLinkability(txid, outputIndex, { boltzmannCache: undefined })
            }
            alwaysFullscreen
            onSetAsRoot={navigateToTxid}
            onSearch={navigateToTxid}
            searchLoading={searchLoading}
            searchError={searchError}
            currentLabel={currentLabel}
            network={network}
            currentGraphId={currentGraphId}
            onLoadSavedGraph={handleLoadSavedGraph}
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
