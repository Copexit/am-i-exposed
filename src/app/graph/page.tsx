"use client";

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion } from "@/hooks/useGraphExpansion";
import { GraphSearchBar } from "@/components/GraphSearchBar";
import { ChartErrorBoundary } from "@/components/ui/ChartErrorBoundary";
import { EXAMPLES, TXID_RE } from "@/lib/constants";
import type { MempoolTransaction } from "@/lib/api/types";

const GraphExplorer = lazy(() =>
  import("@/components/viz/GraphExplorer").then((m) => ({ default: m.GraphExplorer })),
);

/** Txid-only examples for random selection on initial load. */
const TX_EXAMPLES = EXAMPLES.filter((e) => TXID_RE.test(e.input));

export default function GraphPage() {
  const { t } = useTranslation();
  const { config } = useNetwork();
  const api = useMemo(() => createApiClient(config), [config]);

  const {
    nodes,
    rootTxid,
    loading,
    errors,
    nodeCount,
    maxNodes,
    setRoot,
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

  const loadTxid = useCallback(
    async (txid: string, label?: string | null) => {
      setSearchLoading(true);
      setSearchError(null);
      setCurrentLabel(label ?? null);
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

  // Hash-based routing: #txid=<hex>
  useEffect(() => {
    const loadFromHash = () => {
      const hash = window.location.hash.slice(1);
      const match = hash.match(/^txid=([a-fA-F0-9]{64})$/);
      if (match) {
        loadTxid(match[1]);
      } else if (!rootTxid) {
        // No hash and no root - pick random example
        const example = TX_EXAMPLES[Math.floor(Math.random() * TX_EXAMPLES.length)];
        if (example) {
          window.location.hash = `txid=${example.input}`;
        }
      }
    };

    loadFromHash();
    window.addEventListener("hashchange", loadFromHash);
    return () => window.removeEventListener("hashchange", loadFromHash);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(
    (txid: string) => {
      const example = TX_EXAMPLES.find((e) => e.input.toLowerCase() === txid.toLowerCase());
      window.location.hash = `txid=${txid}`;
      loadTxid(txid, example?.labelDefault);
    },
    [loadTxid],
  );

  const handleSetAsRoot = useCallback(
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

  // Use viewport height minus header (80px on desktop, 72px on mobile)
  return (
    <div className="relative w-full" style={{ height: "calc(100vh - 80px)" }}>
      <GraphSearchBar
        onSubmit={handleSearch}
        loading={searchLoading}
        error={searchError}
        currentTxid={rootTxid || null}
        currentLabel={currentLabel}
      />
      {rootTxid && nodes.size > 0 ? (
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
              onSetAsRoot={handleSetAsRoot}
            />
          </Suspense>
        </ChartErrorBoundary>
      ) : searchLoading ? (
        <div className="flex items-center justify-center h-full">
          <div className="text-sm text-muted animate-pulse">
            {t("graphPage.loadingTx", { defaultValue: "Loading transaction..." })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
