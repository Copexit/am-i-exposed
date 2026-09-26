/**
 * Hook that incrementally computes privacy scores for all graph nodes
 * when heat map mode is active. Uses requestAnimationFrame to avoid
 * blocking the main thread (processes nodes in 16ms time-sliced chunks).
 */

import { useRef, useEffect } from "react";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import type { GraphNode } from "@/hooks/useGraphExpansion";
import type { ScoringResult } from "@/lib/types";

interface UseGraphHeatMapOptions {
  /** Whether heat map mode is active. */
  active: boolean;
  /** All graph nodes. */
  nodes: Map<string, GraphNode>;
  /** Dispatch to update progress and final heat map. */
  dispatch: (action:
    | { type: "SET_HEAT_PROGRESS"; progress: number }
    | { type: "SET_HEAT_MAP"; heatMap: Map<string, ScoringResult> }
  ) => void;
}

export function useGraphHeatMap({ active, nodes, dispatch }: UseGraphHeatMapOptions) {
  const heatResultsRef = useRef<Map<string, ScoringResult>>(new Map());

  useEffect(() => {
    if (!active) return;
    const analyze = analyzeTransactionSync;
    const nodeEntries = Array.from(nodes.entries());
    const results = heatResultsRef.current;
    let idx = 0;
    let cancelled = false;

    function processNext() {
      if (cancelled) return;
      const start = performance.now();
      while (idx < nodeEntries.length && performance.now() - start < 16) {
        const entry = nodeEntries[idx];
        if (!entry) break;
        const [txid, gn] = entry;
        if (!results.has(txid)) results.set(txid, analyze(gn.tx));
        idx++;
        dispatch({ type: "SET_HEAT_PROGRESS", progress: Math.round((idx / nodeEntries.length) * 100) });
      }
      if (idx < nodeEntries.length) requestAnimationFrame(processNext);
      else dispatch({ type: "SET_HEAT_MAP", heatMap: new Map(results) });
    }

    processNext();
    return () => { cancelled = true; };
  }, [active, nodes, dispatch]);
}
