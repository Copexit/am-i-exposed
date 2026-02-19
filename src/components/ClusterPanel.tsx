"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Network, Loader2, ChevronDown, AlertTriangle, GitBranch, RotateCw, Search } from "lucide-react";
import { useClusterAnalysis } from "@/hooks/useClusterAnalysis";
import type { MempoolTransaction } from "@/lib/api/types";

interface ClusterPanelProps {
  targetAddress: string;
  txs: MempoolTransaction[];
  onAddressClick?: (address: string) => void;
}

export function ClusterPanel({ targetAddress, txs, onAddressClick }: ClusterPanelProps) {
  const { phase, progress, result, error, analyze } = useClusterAnalysis();
  const [showAddresses, setShowAddresses] = useState(false);

  if (phase === "idle") {
    return (
      <div className="w-full bg-surface-inset rounded-xl p-5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network size={16} className="text-bitcoin/60" />
            <span className="text-sm font-medium text-foreground/90">
              Cluster Analysis
            </span>
            <span className="text-xs text-muted bg-surface-elevated px-1.5 py-0.5 rounded">
              H14
            </span>
          </div>
          <button
            onClick={() => analyze(targetAddress, txs)}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg bg-bitcoin/10 text-bitcoin hover:bg-bitcoin/20 transition-colors cursor-pointer"
          >
            <GitBranch size={14} />
            Build cluster
          </button>
        </div>
        <p className="text-sm text-muted leading-relaxed">
          Discover linked addresses using common-input-ownership heuristic (CIOH).
          Follows change outputs one hop. This makes additional API calls and may take a few seconds.
        </p>
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className="w-full bg-surface-inset rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="text-bitcoin animate-spin" />
          <span className="text-sm font-medium text-foreground/90">
            Building cluster...
          </span>
        </div>
        {progress && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>
                {progress.phase === "inputs"
                  ? "Analyzing transactions"
                  : "Following change outputs"}
              </span>
              <span>{progress.current} / {progress.total}</span>
            </div>
            <div className="w-full bg-card-border rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-bitcoin h-full rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="w-full bg-surface-inset rounded-xl p-5 space-y-2">
        <div className="flex items-center gap-2 text-severity-high">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">Cluster analysis failed</span>
        </div>
        <p className="text-xs text-muted">{error}</p>
        <button
          onClick={() => analyze(targetAddress, txs)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-bitcoin hover:text-bitcoin-hover bg-bitcoin/10 hover:bg-bitcoin/20 rounded-lg px-3 py-2 transition-colors cursor-pointer"
        >
          <RotateCw size={14} />
          Retry
        </button>
      </div>
    );
  }

  // Complete
  if (!result) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full bg-card-bg border border-card-border rounded-xl p-6 space-y-4"
    >
      <div className="flex items-center gap-2">
        <Network size={16} className="text-bitcoin" />
        <span className="text-sm font-medium text-foreground/90">
          Cluster Analysis
        </span>
        <span className="text-xs text-muted bg-surface-elevated px-1.5 py-0.5 rounded">
          H14
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-foreground">
            {result.size}
          </p>
          <p className="text-xs text-muted">Addresses</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">
            {result.txsAnalyzed}
          </p>
          <p className="text-xs text-muted">Txs analyzed</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">
            {result.coinJoinTxCount}
          </p>
          <p className="text-xs text-muted">CoinJoin txs</p>
        </div>
      </div>

      {/* Severity message */}
      {result.size > 1 && (
        <div className={`text-sm leading-relaxed rounded-lg px-3 py-2 ${
          result.size >= 20
            ? "bg-severity-critical/10 text-severity-critical"
            : result.size >= 5
              ? "bg-severity-high/10 text-severity-high"
              : "bg-severity-medium/10 text-severity-medium"
        }`}>
          {result.size >= 20
            ? `Large cluster: ${result.size} addresses are linked through common inputs. A chain analysis firm can see all of them as belonging to the same entity.`
            : result.size >= 5
              ? `Notable cluster: ${result.size} addresses linked. Consider using CoinJoin before consolidating UTXOs.`
              : `Small cluster: ${result.size} addresses linked through common inputs.`}
        </div>
      )}

      {result.size === 1 && (
        <div className="text-sm leading-relaxed rounded-lg px-3 py-2 bg-severity-good/10 text-severity-good">
          No linked addresses found. This address does not share inputs with other addresses in analyzed transactions.
        </div>
      )}

      {result.coinJoinTxCount > 0 && (
        <p className="text-sm text-muted">
          {result.coinJoinTxCount} CoinJoin transaction{result.coinJoinTxCount > 1 ? "s" : ""} excluded from clustering (CIOH does not apply).
        </p>
      )}

      {/* Expandable address list */}
      {result.size > 1 && (
        <div>
          <button
            onClick={() => setShowAddresses(!showAddresses)}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${showAddresses ? "rotate-180" : ""}`}
            />
            {showAddresses ? "Hide" : "Show"} addresses
          </button>
          <AnimatePresence>
            {showAddresses && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                  {result.addresses.map((addr) => (
                    <div
                      key={addr}
                      className={`text-xs font-mono truncate px-3 py-2 rounded ${
                        addr === targetAddress
                          ? "text-bitcoin bg-bitcoin/5 font-semibold"
                          : "text-foreground hover:bg-surface-elevated/50"
                      }`}
                    >
                      {onAddressClick ? (
                        <button
                          onClick={() => onAddressClick(addr)}
                          className="inline-flex items-center gap-1 hover:text-bitcoin transition-colors cursor-pointer text-left w-full truncate group/addr"
                          title={`Scan ${addr}`}
                        >
                          <span className="truncate">
                            {addr}
                            {addr === targetAddress && " (target)"}
                          </span>
                          <Search size={12} className="shrink-0 opacity-0 group-hover/addr:opacity-100 transition-opacity" />
                        </button>
                      ) : (
                        <>
                          {addr}
                          {addr === targetAddress && " (target)"}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-xs text-muted leading-relaxed">
        This is a lower-bound estimate based on one-hop CIOH analysis of the {result.txsAnalyzed} most recent transactions.
        The actual cluster may be larger.
      </p>
    </motion.div>
  );
}
