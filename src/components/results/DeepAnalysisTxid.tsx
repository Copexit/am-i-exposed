"use client";

import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import type { ScoringResult } from "@/lib/types";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";

const TaintPathDiagram = lazy(() => import("../viz/TaintPathDiagram").then(m => ({ default: m.TaintPathDiagram })));
const LinkabilityHeatmap = lazy(() => import("../viz/LinkabilityHeatmap").then(m => ({ default: m.LinkabilityHeatmap })));
const GraphExplorerPanel = lazy(() => import("../GraphExplorerPanel").then(m => ({ default: m.GraphExplorerPanel })));

export function DeepAnalysisTxid({
  result,
  txData,
  onScan,
  backwardLayers,
  forwardLayers,
  outspends,
  boltzmannResult,
}: {
  result: ScoringResult;
  txData: MempoolTransaction | null;
  onScan?: (input: string) => void;
  backwardLayers?: TraceLayer[] | null;
  forwardLayers?: TraceLayer[] | null;
  outspends?: MempoolOutspend[] | null;
  boltzmannResult?: BoltzmannWorkerResult | null;
}) {
  return (
    <>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.42 }} className="w-full">
        <ChartErrorBoundary>
          <Suspense fallback={null}>
            <TaintPathDiagram findings={result.findings} backwardLayers={backwardLayers} forwardLayers={forwardLayers} onTxClick={onScan} />
          </Suspense>
        </ChartErrorBoundary>
      </motion.div>
      {txData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.43 }} className="w-full">
          <ChartErrorBoundary>
            <Suspense fallback={null}>
              <LinkabilityHeatmap tx={txData} boltzmannResult={boltzmannResult} />
            </Suspense>
          </ChartErrorBoundary>
        </motion.div>
      )}
      {txData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.45 }} className="w-full">
          <ChartErrorBoundary>
            <Suspense fallback={null}>
              <GraphExplorerPanel tx={txData} findings={result.findings} onTxClick={onScan} backwardLayers={backwardLayers} forwardLayers={forwardLayers} outspends={outspends} boltzmannResult={boltzmannResult} />
            </Suspense>
          </ChartErrorBoundary>
        </motion.div>
      )}
    </>
  );
}
