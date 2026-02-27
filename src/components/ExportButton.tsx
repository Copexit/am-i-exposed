"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCopy, Check } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
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
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "done" | "failed">("idle");

  const handleExport = useCallback(async () => {
    try {
      const url = window.location.href;
      const lines: string[] = [];

      lines.push("═══════════════════════════════════════");
      lines.push(`  ${t("export.reportTitle", { defaultValue: "am-i.exposed - Bitcoin Privacy Report" })}`);
      lines.push("═══════════════════════════════════════");
      lines.push("");

      if (query) {
        lines.push(t("export.query", { query, defaultValue: "Query: {{query}}" }));
      }

      if (result) {
        lines.push(t("export.grade", { grade: result.grade, score: result.score, defaultValue: "Grade: {{grade}} ({{score}}/100)" }));
        lines.push("");

        // Score breakdown
        const negFindings = result.findings.filter((f) => f.scoreImpact < 0);
        const posFindings = result.findings.filter((f) => f.scoreImpact > 0);
        lines.push(`─── ${t("export.scoreBreakdown", { defaultValue: "Score Breakdown" })} ───`);
        lines.push(`  ${t("export.baseScore", { defaultValue: "Base score" })}:    70`);
        for (const f of negFindings) {
          lines.push(`  ${f.title}: ${f.scoreImpact}`);
        }
        for (const f of posFindings) {
          lines.push(`  ${f.title}: +${f.scoreImpact}`);
        }
        lines.push(`  ${t("export.finalScore", { defaultValue: "Final score" })}:   ${result.score}/100`);
        lines.push("");

        lines.push(`─── ${t("export.findings", { count: result.findings.length, defaultValue: "Findings ({{count}})" })} ───`);
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
            lines.push(`   ${t("export.scoreImpact", { defaultValue: "Score impact" })}: ${f.scoreImpact > 0 ? "+" : ""}${f.scoreImpact}`);
          }
          lines.push("");
        }
      } else {
        // Fallback: extract from DOM
        const element = document.getElementById(targetId);
        const scoreEl = element?.querySelector("[data-score]");
        const score = scoreEl?.getAttribute("data-score") ?? "?";
        const grade = scoreEl?.getAttribute("data-grade") ?? "?";
        lines.push(t("export.grade", { grade, score, defaultValue: "Grade: {{grade}} ({{score}}/100)" }));
      }

      // Share URL (clean, without dev server artifacts)
      const shareBase = window.location.origin + window.location.pathname;
      const prefix = inputType === "txid" ? "tx" : "addr";
      const shareUrl = query ? `${shareBase}#${prefix}=${encodeURIComponent(query)}` : url;

      lines.push(`─── ${t("export.link", { defaultValue: "Link" })} ───`);
      lines.push(shareUrl);
      lines.push("");
      lines.push(t("export.scannedWith", { defaultValue: "Scanned with am-i.exposed" }));

      const ok = await copyToClipboard(lines.join("\n"));
      setStatus(ok ? "done" : "failed");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [targetId, query, result, inputType, t]);

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border border-card-border hover:border-muted/50 bg-surface-elevated/50"
      title={t("export.copyToClipboard", { defaultValue: "Copy report to clipboard" })}
      aria-label={t("export.copyToClipboard", { defaultValue: "Copy report to clipboard" })}
    >
      {status === "done" ? <Check size={14} /> : <ClipboardCopy size={14} />}
      <span className="hidden sm:inline">
        {status === "done"
          ? t("export.copied", { defaultValue: "Copied" })
          : status === "failed"
            ? t("export.failed", { defaultValue: "Failed" })
            : t("export.copyReport", { defaultValue: "Copy report" })}
      </span>
    </button>
  );
}
