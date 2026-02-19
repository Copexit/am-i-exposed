"use client";

import { useState, useCallback } from "react";
import { ClipboardCopy, Check } from "lucide-react";
import type { ScoringResult, InputType } from "@/lib/types";

interface ExportButtonProps {
  targetId: string;
  query?: string;
  result?: ScoringResult;
  inputType?: InputType;
}

/**
 * Export the analysis report as text to clipboard.
 * Includes grade, score, all findings with details.
 */
export function ExportButton({ targetId, query, result, inputType }: ExportButtonProps) {
  const [status, setStatus] = useState<"idle" | "done" | "failed">("idle");

  const handleExport = useCallback(async () => {
    try {
      const url = window.location.href;
      const lines: string[] = [];

      lines.push("═══════════════════════════════════════");
      lines.push("  am-i.exposed - Bitcoin Privacy Report");
      lines.push("═══════════════════════════════════════");
      lines.push("");

      if (query) {
        lines.push(`Query: ${query}`);
      }

      if (result) {
        lines.push(`Grade: ${result.grade} (${result.score}/100)`);
        lines.push("");

        // Score breakdown
        const negFindings = result.findings.filter((f) => f.scoreImpact < 0);
        const posFindings = result.findings.filter((f) => f.scoreImpact > 0);
        lines.push("─── Score Breakdown ───");
        lines.push(`  Base score:    70`);
        for (const f of negFindings) {
          lines.push(`  ${f.title}: ${f.scoreImpact}`);
        }
        for (const f of posFindings) {
          lines.push(`  ${f.title}: +${f.scoreImpact}`);
        }
        lines.push(`  Final score:   ${result.score}/100`);
        lines.push("");

        lines.push(`─── Findings (${result.findings.length}) ───`);
        lines.push("");

        for (const f of result.findings) {
          const icon =
            f.severity === "critical" ? "🔴" :
            f.severity === "high" ? "🟠" :
            f.severity === "medium" ? "🟡" :
            f.severity === "good" ? "🟢" : "🔵";
          lines.push(`${icon} [${f.severity.toUpperCase()}] ${f.title}`);
          lines.push(`   ${f.description}`);
          if (f.recommendation) {
            lines.push(`   → ${f.recommendation}`);
          }
          if (f.scoreImpact !== 0) {
            lines.push(`   Score impact: ${f.scoreImpact > 0 ? "+" : ""}${f.scoreImpact}`);
          }
          lines.push("");
        }
      } else {
        // Fallback: extract from DOM
        const element = document.getElementById(targetId);
        const scoreEl = element?.querySelector("[data-score]");
        const score = scoreEl?.getAttribute("data-score") ?? "?";
        const grade = scoreEl?.getAttribute("data-grade") ?? "?";
        lines.push(`Grade: ${grade} (${score}/100)`);
      }

      // Share URL (clean, without dev server artifacts)
      const shareBase = window.location.origin + window.location.pathname;
      const prefix = inputType === "txid" ? "tx" : "addr";
      const shareUrl = query ? `${shareBase}#${prefix}=${query}` : url;

      lines.push("─── Link ───");
      lines.push(shareUrl);
      lines.push("");
      lines.push("Scanned with am-i.exposed");

      await navigator.clipboard.writeText(lines.join("\n"));
      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [targetId, query, result, inputType]);

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer py-2 min-h-[44px]"
      title="Copy report to clipboard"
    >
      {status === "done" ? <Check size={14} /> : <ClipboardCopy size={14} />}
      {status === "done" ? "Copied" : status === "failed" ? "Failed" : "Copy report"}
    </button>
  );
}
