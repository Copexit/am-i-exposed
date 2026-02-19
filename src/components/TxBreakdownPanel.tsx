"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, ArrowUpDown } from "lucide-react";
import { TxSummary } from "./TxSummary";
import { FindingCard } from "./FindingCard";
import type { TxAnalysisResult, Grade } from "@/lib/types";

interface TxBreakdownPanelProps {
  breakdown: TxAnalysisResult[];
  targetAddress: string;
  totalTxCount: number;
  onScan?: (input: string) => void;
}

const GRADE_COLORS: Record<Grade, string> = {
  "A+": "bg-severity-good/20 text-severity-good",
  B: "bg-severity-low/20 text-severity-low",
  C: "bg-severity-medium/20 text-severity-medium",
  D: "bg-severity-high/20 text-severity-high",
  F: "bg-severity-critical/20 text-severity-critical",
};

const ROLE_CONFIG = {
  sender: { label: "Sent", icon: ArrowUpRight, color: "text-severity-high" },
  receiver: { label: "Received", icon: ArrowDownLeft, color: "text-severity-good" },
  both: { label: "Self", icon: ArrowLeftRight, color: "text-bitcoin" },
} as const;

export function TxBreakdownPanel({
  breakdown,
  targetAddress,
  totalTxCount,
  onScan,
}: TxBreakdownPanelProps) {
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"grade" | "time">("grade");
  const [visibleCount, setVisibleCount] = useState(10);

  const sorted = [...breakdown].sort((a, b) => {
    if (sortBy === "grade") return a.score - b.score; // worst first
    return 0; // keep API order (most recent first)
  });

  const issues = breakdown.filter((t) => t.score < 50).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2 }}
      className="w-full space-y-3"
    >
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-medium text-muted uppercase tracking-wider">
          Transaction History ({breakdown.length})
        </h2>
        <div className="flex items-center gap-3">
          {issues > 0 && (
            <span className="text-xs text-severity-high">
              {issues} with issues
            </span>
          )}
          <button
            onClick={() => setSortBy(sortBy === "grade" ? "time" : "grade")}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground bg-surface-elevated rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
          >
            <ArrowUpDown size={14} />
            Sort: {sortBy === "grade" ? "Worst first" : "Recent first"}
          </button>
        </div>
      </div>

      {totalTxCount > breakdown.length && (
        <p className="text-xs text-muted px-1">
          Showing {breakdown.length} most recent of {totalTxCount} transactions.
        </p>
      )}

      <div className="space-y-2.5">
        {sorted.slice(0, visibleCount).map((item) => {
          const isExpanded = expandedTx === item.txid;
          const role = ROLE_CONFIG[item.role];
          const RoleIcon = role.icon;
          const issueCount = item.findings.filter((f) => f.scoreImpact < 0).length;
          const goodCount = item.findings.filter(
            (f) => f.scoreImpact > 0 || f.severity === "good",
          ).length;

          return (
            <div
              key={item.txid}
              className="border border-card-border rounded-lg overflow-hidden"
            >
              <button
                onClick={() => setExpandedTx(isExpanded ? null : item.txid)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-elevated/50 transition-colors cursor-pointer"
              >
                {/* Grade badge */}
                <span
                  className={`text-xs font-bold px-1.5 py-0.5 rounded ${GRADE_COLORS[item.grade]}`}
                >
                  {item.grade}
                </span>

                {/* Txid */}
                <span className="flex-1 font-mono text-sm text-foreground truncate">
                  {item.txid.slice(0, 8)}...{item.txid.slice(-6)}
                </span>

                {/* Role */}
                <span className={`inline-flex items-center gap-1 text-xs ${role.color}`}>
                  <RoleIcon size={12} />
                  {role.label}
                </span>

                {/* Finding counts */}
                <span className="text-xs text-muted whitespace-nowrap">
                  {issueCount > 0 && (
                    <span className="text-severity-high">{issueCount}↓ </span>
                  )}
                  {goodCount > 0 && (
                    <span className="text-severity-good">{goodCount}↑</span>
                  )}
                </span>

                <ChevronDown
                  size={14}
                  className={`text-muted transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3 border-t border-card-border pt-3">
                      <TxSummary
                        tx={item.tx}
                        onAddressClick={onScan}
                        highlightAddress={targetAddress}
                      />

                      {item.findings.length > 0 && (
                        <div className="space-y-1.5">
                          {item.findings.map((finding, i) => (
                            <FindingCard
                              key={finding.id}
                              finding={finding}
                              index={i}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {visibleCount < sorted.length && (
        <button
          onClick={() => setVisibleCount((prev) => Math.min(prev + 10, sorted.length))}
          className="w-full inline-flex items-center justify-center gap-1.5 py-3 min-h-[44px] text-sm text-muted hover:text-foreground border border-card-border rounded-lg transition-colors cursor-pointer"
        >
          <ChevronDown size={14} />
          Show more ({sorted.length - visibleCount} remaining)
        </button>
      )}
    </motion.div>
  );
}
