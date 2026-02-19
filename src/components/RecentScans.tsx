"use client";

import { motion } from "motion/react";
import { Clock, X } from "lucide-react";
import type { RecentScan } from "@/hooks/useRecentScans";

interface RecentScansProps {
  scans: RecentScan[];
  onSelect: (input: string) => void;
  onClear?: () => void;
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "text-severity-good",
  B: "text-severity-low",
  C: "text-severity-medium",
  D: "text-severity-high",
  F: "text-severity-critical",
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RecentScans({ scans, onSelect, onClear }: RecentScansProps) {
  if (scans.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="w-full max-w-2xl"
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5 text-xs text-muted/80">
          <Clock size={11} />
          <span>Recent scans</span>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors cursor-pointer p-2 -m-2"
            title="Clear scan history"
          >
            <X size={10} />
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {scans.map((scan) => (
          <button
            key={scan.input}
            onClick={() => onSelect(scan.input)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-elevated/50
              border border-card-border/50 hover:border-card-border hover:bg-surface-elevated
              transition-all text-xs cursor-pointer group"
            title={`${scan.type === "txid" ? "Transaction" : "Address"} · ${timeAgo(scan.timestamp)}`}
          >
            <span className={`font-bold ${GRADE_COLORS[scan.grade] ?? "text-muted"}`}>
              {scan.grade}
            </span>
            <span className="font-mono text-muted group-hover:text-foreground/70 transition-colors truncate max-w-32">
              {truncate(scan.input)}
            </span>
            <span className="text-muted/70 text-[10px]">{timeAgo(scan.timestamp)}</span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function truncate(s: string): string {
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}...${s.slice(-4)}`;
}
