"use client";

import { useEffect, useMemo, lazy, Suspense } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion } from "@/hooks/useGraphExpansion";
import { ChartErrorBoundary } from "./ui/ChartErrorBoundary";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

const GraphExplorer = lazy(() => import("./viz/GraphExplorer").then(m => ({ default: m.GraphExplorer })));

interface GraphExplorerPanelProps {
  tx: MempoolTransaction;
  findings?: Finding[];
  onTxClick?: (txid: string) => void;
  /** Pre-fetched parent transactions (from analysis) to pre-populate the graph. */
  parentTxMap?: Map<string, MempoolTransaction> | null;
  /** Pre-fetched child transactions by output index (from analysis). */
  childTxMap?: Map<number, MempoolTransaction> | null;
}

/**
 * Self-contained graph explorer that manages its own API calls
 * and expansion state. Wraps the GraphExplorer visualization.
 */
export function GraphExplorerPanel({ tx, findings, onTxClick, parentTxMap, childTxMap }: GraphExplorerPanelProps) {
  const { config } = useNetwork();

  // Create API client with an AbortController that aborts on config change / unmount.
  // useMemo for stable reference; useEffect for cleanup.
  const { fetcher, controller } = useMemo(() => {
    const ac = new AbortController();
    return { fetcher: createApiClient(config, ac.signal), controller: ac };
  }, [config]);

  useEffect(() => () => { controller.abort(); }, [controller]);

  const {
    nodes,
    rootTxid,
    loading,
    nodeCount,
    maxNodes,
    canUndo,
    setRoot,
    setRootWithNeighbors,
    expandInput,
    expandOutput,
    collapse,
    undo,
    reset,
  } = useGraphExpansion(fetcher);

  // Set root tx on mount or when tx changes.
  // If pre-fetched neighbors are available, pre-populate the graph.
  useEffect(() => {
    const hasParents = parentTxMap && parentTxMap.size > 0;
    const hasChildren = childTxMap && childTxMap.size > 0;
    if (hasParents || hasChildren) {
      setRootWithNeighbors(
        tx,
        parentTxMap ?? new Map(),
        childTxMap ?? new Map(),
      );
    } else {
      setRoot(tx);
    }
  }, [tx.txid, setRoot, setRootWithNeighbors, tx, parentTxMap, childTxMap]);

  if (!rootTxid) return null;

  return (
    <ChartErrorBoundary>
      <Suspense fallback={null}>
        <GraphExplorer
          nodes={nodes}
          rootTxid={rootTxid}
          findings={findings}
          loading={loading}
          nodeCount={nodeCount}
          maxNodes={maxNodes}
          canUndo={canUndo}
          onExpandInput={expandInput}
          onExpandOutput={expandOutput}
          onCollapse={collapse}
          onUndo={undo}
          onReset={reset}
          onTxClick={onTxClick}
        />
      </Suspense>
    </ChartErrorBoundary>
  );
}
