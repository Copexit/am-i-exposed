"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lightbulb, ChevronDown, ExternalLink, AlertCircle, Clock, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getSummarySentiment } from "@/lib/scoring/score";
import { generateActions } from "@/lib/recommendations/generate-actions";
import type { Finding, Grade, Remediation as RemediationType } from "@/lib/types";

interface RemediationProps {
  findings: Finding[];
  grade: Grade;
}

const URGENCY_CONFIG = {
  immediate: { labelKey: "remediation.urgencyImmediate", labelDefault: "Act now", color: "text-severity-critical", icon: AlertCircle },
  soon: { labelKey: "remediation.urgencySoon", labelDefault: "Act soon", color: "text-severity-medium", icon: Clock },
  "when-convenient": { labelKey: "remediation.urgencyConvenient", labelDefault: "When convenient", color: "text-muted", icon: Wrench },
} as const;

function StructuredRemediation({ remediation, findingId, findingTitle, findingParams }: { remediation: RemediationType; findingId: string; findingTitle: string; findingParams?: Record<string, unknown> }) {
  const { t } = useTranslation();
  const urgency = URGENCY_CONFIG[remediation.urgency];
  const UrgencyIcon = urgency.icon;
  const prefix = remediation.keyPrefix ?? findingId;

  return (
    <div className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground/90">{t(`finding.${findingId}.title`, { ...findingParams, defaultValue: findingTitle })}</p>
        <span className={`inline-flex items-center gap-1 text-xs ${urgency.color}`}>
          <UrgencyIcon size={14} />
          {t(urgency.labelKey, { defaultValue: urgency.labelDefault })}
        </span>
      </div>

      {remediation.qualifier && (
        <p className="text-sm text-foreground/70 italic">
          {t(`remediation.${prefix}.qualifier`, { defaultValue: remediation.qualifier })}
        </p>
      )}

      <ol className="space-y-1.5 pl-4">
        {remediation.steps.map((step, i) => (
          <li key={i} className="text-base text-muted leading-relaxed list-decimal">
            {t(`remediation.${prefix}.step${i + 1}`, { defaultValue: step })}
          </li>
        ))}
      </ol>

      {remediation.tools && remediation.tools.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {remediation.tools.map((tool) => (
            <a
              key={tool.name}
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-base text-bitcoin hover:text-bitcoin-hover transition-colors"
            >
              {t(`remediation.${prefix}.tool_${tool.name.toLowerCase().replace(/\s+/g, "_")}`, { defaultValue: tool.name })}
              <ExternalLink size={14} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Remediation({ findings, grade }: RemediationProps) {
  const { t } = useTranslation();
  // Auto-open for poor grades where remediation is most important,
  // but not when all findings are positive (no negative impacts).
  const sentiment = getSummarySentiment(grade, findings);
  const [open, setOpen] = useState(
    sentiment !== "positive" && (grade === "C" || grade === "D" || grade === "F"),
  );

  // Collect structured remediations from findings (sorted by urgency).
  // Exclude findings with scoreImpact=0 (suppressed by cross-heuristic rules,
  // e.g. CIOH on CoinJoin) since their remediation is no longer relevant.
  const structuredRemediations = useMemo(() => findings
    .filter((f) => f.remediation && f.scoreImpact !== 0)
    .sort((a, b) => {
      const order = { immediate: 0, soon: 1, "when-convenient": 2 };
      return (order[a.remediation!.urgency] ?? 2) - (order[b.remediation!.urgency] ?? 2);
    }), [findings]);

  // Fallback actions for findings without structured remediation
  // Skip generic actions when all negative findings have structured remediation
  const actions = useMemo(() => {
    const coveredIds = new Set(structuredRemediations.map((f) => f.id));
    const uncovered = findings.filter((f) => f.scoreImpact < 0 && !coveredIds.has(f.id));
    if (uncovered.length === 0) return [];
    return generateActions(findings, grade);
  }, [findings, grade, structuredRemediations]);

  if (structuredRemediations.length === 0 && actions.length === 0) return null;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="remediation-panel"
        className="inline-flex items-center gap-1.5 text-sm text-bitcoin/80 hover:text-bitcoin transition-colors cursor-pointer bg-bitcoin/10 rounded-lg px-3 py-3"
      >
        <Lightbulb size={16} aria-hidden="true" />
        {t("remediation.whatToDoNext", { defaultValue: "What to do next" })}
        {structuredRemediations.length > 0 && (
          <span className="text-xs text-bitcoin/80">
            ({t("remediation.detailedCount", { count: structuredRemediations.length, defaultValue: "{{count}} detailed" })})
          </span>
        )}
        <ChevronDown
          size={16}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div id="remediation-panel" className="mt-2 space-y-2">
              {/* Structured remediations first */}
              {structuredRemediations.map((f) => (
                <StructuredRemediation
                  key={f.id}
                  remediation={f.remediation!}
                  findingId={f.id}
                  findingTitle={f.title}
                  findingParams={f.params}
                />
              ))}

              {/* General actions for all findings */}
              {actions.map((action, i) => (
                <div
                  key={i}
                  className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-bitcoin/80 text-xs font-bold mt-0.5 shrink-0">
                      {i + 1}.
                    </span>
                    <div>
                      <p className="text-base font-medium text-foreground/90">
                        {t(action.textKey, { defaultValue: action.textDefault })}
                      </p>
                      <p className="text-base text-muted mt-1 leading-relaxed">
                        {t(action.detailKey, { defaultValue: action.detailDefault })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
