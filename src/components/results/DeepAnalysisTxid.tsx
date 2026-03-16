"use client";

import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import type { ScoringResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

const TaintPathDiagram = lazy(() => import("../viz/TaintPathDiagram").then(m => ({ default: m.TaintPathDiagram })));
const LinkabilityHeatmap = lazy(() => import("../viz/LinkabilityHeatmap").then(m => ({ default: m.LinkabilityHeatmap })));

export function DeepAnalysisTxid({
  result,
  txData,
  onScan,
  backwardLayers,
  forwardLayers,
  boltzmannResult,
}: {
  result: ScoringResult;
  txData: MempoolTransaction | null;
  onScan?: (input: string) => void;
  backwardLayers?: TraceLayer[] | null;
  forwardLayers?: TraceLayer[] | null;
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
    </>
  );
}
