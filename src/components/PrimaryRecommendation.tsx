"use client";

import { ExternalLink, AlertTriangle, Clock, CheckCircle, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GlowCard } from "./ui/GlowCard";
import { selectRecommendations, type PrimaryRec } from "@/lib/recommendations/primary-recommendation";
import type { Finding, Grade } from "@/lib/types";

interface PrimaryRecommendationProps {
  findings: Finding[];
  grade: Grade;
  walletGuess: string | null;
}

const URGENCY_CONFIG = {
  immediate: {
    icon: AlertTriangle,
    bgClass: "bg-red-500/10 border-red-500/30",
    iconClass: "text-red-400",
    labelKey: "primaryRec.urgency.immediate",
    labelDefault: "Act now",
  },
  soon: {
    icon: Clock,
    iconClass: "text-amber-400",
    bgClass: "bg-amber-500/10 border-amber-500/30",
    labelKey: "primaryRec.urgency.soon",
    labelDefault: "Address soon",
  },
  "when-convenient": {
    icon: CheckCircle,
    iconClass: "text-blue-400",
    bgClass: "bg-blue-500/10 border-blue-500/30",
    labelKey: "primaryRec.urgency.whenConvenient",
    labelDefault: "When convenient",
  },
} as const;

function RecCard({ rec }: { rec: PrimaryRec }) {
  const { t } = useTranslation();
  const cfg = URGENCY_CONFIG[rec.urgency];
  const Icon = cfg.icon;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 p-1.5 rounded-lg border ${cfg.bgClass}`}>
          <Icon size={18} className={cfg.iconClass} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.bgClass} ${cfg.iconClass}`}>
              {t(cfg.labelKey, { defaultValue: cfg.labelDefault })}
            </span>
          </div>
          <h3 className="text-base font-semibold text-foreground mt-1.5 leading-snug">
            {t(rec.headlineKey, { defaultValue: rec.headlineDefault })}
          </h3>
          <p className="text-sm text-muted mt-1 leading-relaxed">
            {t(rec.detailKey, { defaultValue: rec.detailDefault })}
          </p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {rec.tool && (
              <a
                href={rec.tool.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 transition-colors"
              >
                {rec.tool.name}
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
            {rec.guideLink && (
              <a
                href={rec.guideLink}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
              >
                {t("primaryRec.learnMore", { defaultValue: "Learn more in the privacy guide" })}
                <ArrowRight size={12} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PrimaryRecommendation({ findings, grade, walletGuess }: PrimaryRecommendationProps) {
  const { t } = useTranslation();
  const [primary, secondary] = selectRecommendations({ findings, grade, walletGuess });

  return (
    <GlowCard className="p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-4">
        {t("primaryRec.sectionTitle", { defaultValue: "Top recommendation" })}
      </h2>
      <RecCard rec={primary} />
      {secondary && (
        <>
          <hr className="border-border/50 my-4" />
          <RecCard rec={secondary} />
        </>
      )}
    </GlowCard>
  );
}
