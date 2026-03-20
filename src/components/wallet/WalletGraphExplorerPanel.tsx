"use client";

import { useEffect, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { useGraphExpansion, type MultiRootEntry } from "@/hooks/useGraphExpansion";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { UtxoTraceResult } from "@/hooks/useWalletAnalysis";
import type { MempoolTransaction } from "@/lib/api/types";

const GraphExplorer = lazy(() => import("../viz/GraphExplorer").then(m => ({ default: m.GraphExplorer })));

/** Max unique root txids to display in the graph. */
const MAX_ROOTS = 50;

/** Node limit for the wallet graph (higher than single-tx graph). */
const WALLET_MAX_NODES = 200;

/** Pre-expansion budget: leave room for manual expansion. */
const PRE_EXPAND_BUDGET = 195;

interface WalletGraphExplorerPanelProps {
  addressInfos: WalletAddressInfo[];
  utxoTraces: Map<string, UtxoTraceResult> | null;
  onTxClick?: (txid: string) => void;
}

export function WalletGraphExplorerPanel({
  addressInfos,
  utxoTraces,
  onTxClick,
}: WalletGraphExplorerPanelProps) {
  const { t } = useTranslation();
  const { config } = useNetwork();

  const fetcher = useMemo(() => createApiClient(config), [config]);

  const {
    nodes,
    rootTxid,
    rootTxids,
    loading,
    errors,
    nodeCount,
    maxNodes,
    setMultiRoot,
    setMultiRootWithLayers,
    expandInput,
    expandOutput,
    collapse,
    reset,
    expandedNodeTxid,
    toggleExpand,
    expandPortInput,
    expandPortOutput,
    outspendCache,
  } = useGraphExpansion(fetcher, WALLET_MAX_NODES);

  // Build wallet output index: all txs with outputs belonging to wallet addresses
  const { walletOutputs, walletTxMap, capped } = useMemo(() => {
    // Collect all wallet addresses
    const walletAddresses = new Set<string>();
    for (const info of addressInfos) {
      walletAddresses.add(info.derived.address);
    }

    const outputMap = new Map<string, Set<number>>();
    const txMap = new Map<string, MempoolTransaction>();
    const valueMap = new Map<string, number>();

    for (const info of addressInfos) {
      for (const tx of info.txs) {
        if (txMap.has(tx.txid)) continue;

        // Find outputs belonging to wallet addresses
        const vouts = new Set<number>();
        let walletValue = 0;
        for (let i = 0; i < tx.vout.length; i++) {
          if (tx.vout[i].scriptpubkey_address && walletAddresses.has(tx.vout[i].scriptpubkey_address!)) {
            vouts.add(i);
            walletValue += tx.vout[i].value;
          }
        }

        if (vouts.size === 0) continue; // No wallet outputs in this tx
        outputMap.set(tx.txid, vouts);
        txMap.set(tx.txid, tx);
        valueMap.set(tx.txid, walletValue);
      }
    }

    // Sort by wallet output value descending, cap at MAX_ROOTS
    const sorted = [...txMap.keys()]
      .sort((a, b) => (valueMap.get(b) ?? 0) - (valueMap.get(a) ?? 0));

    const wasCapped = sorted.length > MAX_ROOTS;
    const selected = sorted.slice(0, MAX_ROOTS);

    const filteredOutputMap = new Map<string, Set<number>>();
    const filteredTxMap = new Map<string, MempoolTransaction>();
    for (const txid of selected) {
      filteredOutputMap.set(txid, outputMap.get(txid)!);
      filteredTxMap.set(txid, txMap.get(txid)!);
    }

    return { walletOutputs: filteredOutputMap, walletTxMap: filteredTxMap, capped: wasCapped };
  }, [addressInfos]);

  // Initialize graph with roots (+ optional trace layers)
  useEffect(() => {
    if (walletTxMap.size === 0) return;

    if (utxoTraces && utxoTraces.size > 0) {
      const roots = new Map<string, MultiRootEntry>();
      for (const [txid, tx] of walletTxMap) {
        const trace = utxoTraces.get(txid);
        roots.set(txid, {
          tx,
          backward: trace?.backward,
          forward: trace?.forward,
          outspends: trace?.outspends,
        });
      }
      setMultiRootWithLayers(roots, PRE_EXPAND_BUDGET);
    } else {
      setMultiRoot(walletTxMap);
    }
  }, [walletTxMap, utxoTraces, setMultiRoot, setMultiRootWithLayers]);

  if (walletTxMap.size === 0) return null;
  if (!rootTxid) return null;

  return (
    <div className="space-y-2">
      {capped && (
        <div className="text-xs text-muted bg-surface-elevated/50 rounded-lg px-3 py-2">
          {t("wallet.graphCapped", {
            max: MAX_ROOTS,
            defaultValue: "Showing top {{max}} transactions by wallet output value. Remaining omitted.",
          })}
        </div>
      )}
      <ChartErrorBoundary>
        <Suspense fallback={null}>
          <GraphExplorer
            nodes={nodes}
            rootTxid={rootTxid}
            rootTxids={rootTxids}
            walletUtxos={walletOutputs}
            loading={loading}
            errors={errors}
            nodeCount={nodeCount}
            maxNodes={maxNodes}
            onExpandInput={expandInput}
            onExpandOutput={expandOutput}
            onCollapse={collapse}
            onReset={reset}
            onTxClick={onTxClick}
            expandedNodeTxid={expandedNodeTxid}
            onToggleExpand={toggleExpand}
            onExpandPortInput={expandPortInput}
            onExpandPortOutput={expandPortOutput}
            outspendCache={outspendCache}
          />
        </Suspense>
      </ChartErrorBoundary>
    </div>
  );
}
