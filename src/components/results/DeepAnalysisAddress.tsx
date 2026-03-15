"use client";

import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import { GlowCard } from "../ui/GlowCard";
import { TxBreakdownPanel } from "../TxBreakdownPanel";
import { ClusterPanel } from "../ClusterPanel";
import type { TxAnalysisResult } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo } from "@/lib/api/types";

const UtxoBubbleChart = lazy(() => import("../viz/UtxoBubbleChart").then(m => ({ default: m.UtxoBubbleChart })));
const PrivacyTimeline = lazy(() => import("../viz/PrivacyTimeline").then(m => ({ default: m.PrivacyTimeline })));
const FingerprintTimeline = lazy(() => import("../viz/FingerprintTimeline").then(m => ({ default: m.FingerprintTimeline })));

export function DeepAnalysisAddress({
  query,
  addressUtxos,
  txBreakdown,
  addressTxs,
  addressData,
  onScan,
}: {
  query: string;
  addressUtxos?: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  addressTxs: MempoolTransaction[] | null;
  addressData: MempoolAddress | null;
  onScan?: (input: string) => void;
}) {
  return (
    <>
      {addressUtxos && addressUtxos.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.42 }} className="w-full">
          <ChartErrorBoundary><Suspense fallback={null}><UtxoBubbleChart utxos={addressUtxos} /></Suspense></ChartErrorBoundary>
        </motion.div>
      )}
      {txBreakdown && txBreakdown.length >= 2 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.44 }} className="w-full">
          <ChartErrorBoundary><Suspense fallback={null}><PrivacyTimeline breakdown={txBreakdown} onScan={onScan} /></Suspense></ChartErrorBoundary>
        </motion.div>
      )}
      {addressTxs && addressTxs.length >= 3 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.46 }} className="w-full">
          <GlowCard className="p-5 sm:p-6">
            <Suspense fallback={null}>
              <ChartErrorBoundary><FingerprintTimeline address={query} txs={addressTxs} onScan={onScan} /></ChartErrorBoundary>
            </Suspense>
          </GlowCard>
        </motion.div>
      )}
      {txBreakdown && txBreakdown.length > 0 && addressData && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.48 }} className="w-full">
          <TxBreakdownPanel
            breakdown={txBreakdown}
            targetAddress={query}
            totalTxCount={addressData.chain_stats.tx_count + addressData.mempool_stats.tx_count}
            onScan={onScan}
          />
        </motion.div>
      )}
      {addressTxs && addressTxs.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.5 }} className="w-full">
          <ClusterPanel
            targetAddress={query}
            txs={addressTxs}
            onAddressClick={onScan}
          />
        </motion.div>
      )}
    </>
  );
}
