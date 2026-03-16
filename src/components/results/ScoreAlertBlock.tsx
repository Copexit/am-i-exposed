"use client";

import { lazy, Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ScoreDisplay } from "../ScoreDisplay";
import { GlowCard } from "../ui/GlowCard";
import { ChartErrorBoundary } from "../ui/ChartErrorBoundary";
import { DestinationAlert } from "../DestinationAlert";
import { getSummarySentiment } from "@/lib/scoring/score";
import type { ScoringResult } from "@/lib/types";
import type { PreSendResult } from "@/lib/analysis/orchestrator";

const SeverityRing = lazy(() => import("../viz/SeverityRing").then(m => ({ default: m.SeverityRing })));

export function ScoreAlertBlock({
  result,
  inputType,
  preSendResult,
  proMode = false,
}: {
  result: ScoringResult;
  inputType: "txid" | "address";
  preSendResult?: PreSendResult | null;
  proMode?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      {/* Score display */}
      <GlowCard className="w-full p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-center gap-6">
          <ScoreDisplay score={result.score} grade={result.grade} findings={result.findings} />
          {proMode && result.findings.length > 3 && (
            <ChartErrorBoundary><Suspense fallback={null}><SeverityRing findings={result.findings} size={120} /></Suspense></ChartErrorBoundary>
          )}
        </div>
      </GlowCard>

      {/* Alerts */}
      {(result.grade === "F" || result.findings.length > 0 || (inputType === "address" && preSendResult)) && (
        <div className="w-full flex flex-col gap-3 sm:gap-4">
          {result.grade === "F" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              className="w-full bg-severity-critical/10 border border-severity-critical/30 rounded-xl p-4 flex items-start gap-3"
            >
              <AlertTriangle size={18} className="text-severity-critical shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-severity-critical">
                  {t("results.highExposureRisk", { defaultValue: "High exposure risk" })}
                </p>
                <p className="text-xs text-foreground mt-1 leading-relaxed">
                  {inputType === "txid"
                    ? t("results.fGradeWarningTx", { defaultValue: "This transaction has severe privacy issues. On-chain surveillance can likely identify the owner and trace fund flows. Immediate remediation steps are recommended below." })
                    : t("results.fGradeWarningAddr", { defaultValue: "This address has severe privacy issues. On-chain surveillance can likely identify the owner and trace fund flows. Immediate remediation steps are recommended below." })}
                </p>
              </div>
            </motion.div>
          )}

          {result.grade !== "F" && (() => {
            const sentiment = getSummarySentiment(result.grade, result.findings);
            const colorMap = {
              positive: { border: "border-severity-good/30 bg-severity-good/5", text: "text-severity-good" },
              cautious: { border: "border-severity-medium/30 bg-severity-medium/5", text: "text-severity-medium" },
              warning: { border: "border-severity-high/30 bg-severity-high/5", text: "text-severity-high" },
              danger: { border: "border-severity-critical/30 bg-severity-critical/5", text: "text-severity-critical" },
            };
            const colors = colorMap[sentiment];
            return (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }} className={`w-full rounded-xl border px-4 py-3 ${colors.border}`}>
                <p className={`text-base font-medium ${colors.text}`}>
                  {sentiment === "positive"
                    ? t("results.summaryGood", { defaultValue: "No significant privacy concerns detected." })
                    : sentiment === "cautious"
                      ? t("results.summaryFair", { defaultValue: "Some privacy concerns detected. Review the findings below." })
                      : t("results.summaryPoor", { defaultValue: "Significant privacy exposure detected. Remediation recommended." })}
                </p>
              </motion.div>
            );
          })()}

          {inputType === "address" && preSendResult && (
            <DestinationAlert preSendResult={preSendResult} />
          )}
        </div>
      )}
    </>
  );
}
