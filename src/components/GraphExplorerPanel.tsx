"use client";

import { useEffect, useMemo, lazy, Suspense } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion } from "@/hooks/useGraphExpansion";
import { ChartErrorBoundary } from "./ui/ChartErrorBoundary";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { Finding } from "@/lib/types";

const GraphExplorer = lazy(() => import("./viz/GraphExplorer").then(m => ({ default: m.GraphExplorer })));

interface GraphExplorerPanelProps {
  tx: MempoolTransaction;
  findings?: Finding[];
  onTxClick?: (txid: string) => void;
  /** Backward trace layers from chain analysis (multi-hop). */
  backwardLayers?: TraceLayer[] | null;
  /** Forward trace layers from chain analysis (multi-hop). */
  forwardLayers?: TraceLayer[] | null;
  /** Per-output spend status (needed for forward edge resolution). */
  outspends?: MempoolOutspend[] | null;
  /** Boltzmann result for the root transaction (linkability edge coloring). */
  boltzmannResult?: BoltzmannWorkerResult | null;
}

/**
 * Self-contained graph explorer that manages its own API calls
 * and expansion state. Wraps the GraphExplorer visualization.
 *
 * When trace layers are provided, auto-expands up to 2 hops in each direction.
 */
export function GraphExplorerPanel({ tx, findings, onTxClick, backwardLayers, forwardLayers, outspends, boltzmannResult }: GraphExplorerPanelProps) {
  const { config } = useNetwork();

  // No AbortController signal: the graph is long-lived and expansion requests
  // don't need abort-on-unmount. The previous useMemo+effect-cleanup pattern
  // broke under React Strict Mode (double-mount aborts the signal permanently).
  const fetcher = useMemo(() => createApiClient(config), [config]);

  const {
    nodes,
    rootTxid,
    loading,
    errors,
    nodeCount,
    maxNodes,
    canUndo,
    setRoot,
    setRootWithLayers,
    expandInput,
    expandOutput,
    collapse,
    undo,
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
  } = useGraphExpansion(fetcher);

  // Set root tx on mount or when tx changes.
  // If trace layers are available, pre-populate up to 2 hops in each direction.
  useEffect(() => {
    const hasBw = backwardLayers && backwardLayers.length > 0;
    const hasFw = forwardLayers && forwardLayers.length > 0;
    if (hasBw || hasFw) {
      setRootWithLayers(
        tx,
        backwardLayers ?? [],
        forwardLayers ?? [],
        outspends ?? undefined,
      );
    } else {
      setRoot(tx);
    }
  }, [tx.txid, setRoot, setRootWithLayers, tx, backwardLayers, forwardLayers, outspends]);

  if (!rootTxid) return null;

  return (
    <ChartErrorBoundary>
      <Suspense fallback={null}>
        <GraphExplorer
          nodes={nodes}
          rootTxid={rootTxid}
          findings={findings}
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
          onTxClick={onTxClick}
          rootBoltzmannResult={boltzmannResult}
          expandedNodeTxid={expandedNodeTxid}
          onToggleExpand={toggleExpand}
          onExpandPortInput={expandPortInput}
          onExpandPortOutput={expandPortOutput}
          outspendCache={outspendCache}
          onAutoTrace={autoTrace}
          onCancelAutoTrace={cancelAutoTrace}
          autoTracing={autoTracing}
          autoTraceProgress={autoTraceProgress}
        />
      </Suspense>
    </ChartErrorBoundary>
  );
}
