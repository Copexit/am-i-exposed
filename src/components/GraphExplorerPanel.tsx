"use client";

import { useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion } from "@/hooks/useGraphExpansion";
import { ChartErrorBoundary } from "./ui/ChartErrorBoundary";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

const GraphExplorer = lazy(() => import("./viz/GraphExplorer").then(m => ({ default: m.GraphExplorer })));

interface GraphExplorerPanelProps {
  tx: MempoolTransaction;
  onTxClick?: (txid: string) => void;
  /** Backward trace layers from chain analysis (multi-hop). */
  backwardLayers?: TraceLayer[] | null;
  /** Forward trace layers from chain analysis (multi-hop). */
  forwardLayers?: TraceLayer[] | null;
  /** Per-output spend status (needed for forward edge resolution). */
  outspends?: MempoolOutspend[] | null;
  /** Boltzmann result for the root transaction (linkability edge coloring). */
  boltzmannResult?: BoltzmannWorkerResult | null;
  /** Compact inline view (v2): analysis tools live in fullscreen only. */
  compact?: boolean;
}

/**
 * Self-contained graph explorer that manages its own API calls
 * and expansion state. Wraps the GraphExplorer visualization.
 *
 * When trace layers are provided, auto-expands up to 2 hops in each direction.
 */
export function GraphExplorerPanel({ tx, onTxClick, backwardLayers, forwardLayers, outspends, boltzmannResult, compact = false }: GraphExplorerPanelProps) {
  const { network, config } = useNetwork();

  // No AbortController signal: the graph is long-lived and expansion requests
  // don't need abort-on-unmount. The previous useMemo+effect-cleanup pattern
  // broke under React Strict Mode (double-mount aborts the signal permanently).
  const fetcher = useMemo(() => createApiClient(config), [config]);

  const graph = useGraphExpansion(fetcher);
  const { setRoot, setRootWithLayers } = graph;

  // Set root tx on mount or when tx changes (only then: later layer/outspend
  // updates for the same tx must not rebuild the graph). Smart filtering is always enabled.
  const rootTxidRef = useRef<string>("");

  useEffect(() => {
    if (rootTxidRef.current === tx.txid) return;
    rootTxidRef.current = tx.txid;
    const hasBw = backwardLayers && backwardLayers.length > 0;
    const hasFw = forwardLayers && forwardLayers.length > 0;
    if (hasBw || hasFw) {
      setRootWithLayers(tx, backwardLayers ?? [], forwardLayers ?? [], outspends ?? undefined, true);
    } else {
      setRoot(tx);
    }
  }, [tx, backwardLayers, forwardLayers, outspends, setRoot, setRootWithLayers]);

  if (!graph.rootTxid) return null;

  return (
    <ChartErrorBoundary>
      <Suspense fallback={null}>
        <GraphExplorer
          graph={graph}
          onTxClick={onTxClick}
          rootBoltzmannResult={boltzmannResult}
          network={network}
          compact={compact}
        />
      </Suspense>
    </ChartErrorBoundary>
  );
}
