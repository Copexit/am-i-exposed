"use client";

import {
  ChevronDown,
  Shield,
  Zap,
  ArrowRightLeft,
  Layers,
  Lock,
  Coins,
  Target,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { PATHWAYS, type PathwayData } from "@/data/guide/pathways";

const ICON_MAP: Record<string, React.ReactNode> = {
  Zap: <Zap size={14} />,
  ArrowRightLeft: <ArrowRightLeft size={14} />,
  Layers: <Layers size={14} />,
  Lock: <Lock size={14} />,
  Shield: <Shield size={14} />,
  Coins: <Coins size={14} />,
  Target: <Target size={14} />,
};

function PathwayCard({ pathway, expanded, onToggle }: {
  pathway: PathwayData;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div id={pathway.id} className="bg-surface-inset border border-card-border rounded-lg overflow-hidden scroll-mt-24">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex items-center gap-2 w-full px-4 py-3 text-left cursor-pointer hover:bg-surface-elevated/50 transition-colors"
      >
        <span className="text-bitcoin">{ICON_MAP[pathway.iconName]}</span>
        <span className="text-base font-medium text-foreground/90 flex-1">
          {t(pathway.titleKey, { defaultValue: pathway.titleDefault })}
        </span>
        <ChevronDown
          size={14}
          className={`text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2.5">
              <p className="text-base text-muted leading-relaxed">
                {t(pathway.descKey, { defaultValue: pathway.descDefault })}
              </p>
              <div className="space-y-1.5">
                {pathway.pros.map((pro, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 size={14} className="text-severity-good shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground/80">{t(pro.key, { defaultValue: pro.default })}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                {pathway.cons.map((con, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={14} className="text-severity-medium shrink-0 mt-0.5" />
                    <span className="text-sm text-foreground/80">{t(con.key, { defaultValue: con.default })}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pathway.tools.map((tool) => (
                  <span key={tool} className="text-xs font-mono px-2 py-0.5 rounded bg-card-bg border border-card-border text-muted">
                    {tool}
                  </span>
                ))}
              </div>
              {pathway.warnings?.map((warn, i) => (
                <div key={i} className="flex items-start gap-1.5 bg-severity-medium/10 rounded-lg px-3 py-2">
                  <Info size={14} className="text-severity-medium shrink-0 mt-0.5" />
                  <span className="text-sm text-foreground/80">{t(warn.key, { defaultValue: warn.default })}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface PrivacyTechniquesProps {
  expandedPathway: string | null;
  onTogglePathway: (id: string) => void;
}

export function PrivacyTechniques({ expandedPathway, onTogglePathway }: PrivacyTechniquesProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h2 id="privacy-techniques" className="text-2xl font-bold text-foreground scroll-mt-24">
        <Shield size={20} className="inline mr-2 text-bitcoin" />
        {t("guide.techniquesTitle", { defaultValue: "Privacy techniques" })}
      </h2>
      <p className="text-base text-muted leading-relaxed">
        {t("pathways.intro", {
          defaultValue: "On-chain privacy tools like CoinJoin are just one layer. The strongest privacy comes from combining multiple techniques across different networks.",
        })}
      </p>

      {/* On-chain */}
      {PATHWAYS.some((p) => p.category === "on-chain") && (
        <p className="text-sm font-medium text-foreground/70 uppercase tracking-wide pt-1">
          {t("pathways.onchainTitle", { defaultValue: "On-chain spending techniques" })}
        </p>
      )}
      {PATHWAYS.filter((p) => p.category === "on-chain").map((pathway) => (
        <PathwayCard
          key={pathway.id}
          pathway={pathway}
          expanded={expandedPathway === pathway.id}
          onToggle={() => onTogglePathway(pathway.id)}
        />
      ))}

      {/* Off-chain */}
      <p className="text-sm font-medium text-foreground/70 uppercase tracking-wide pt-2">
        {t("pathways.offchainTitle", { defaultValue: "Off-chain and cross-chain pathways" })}
      </p>
      {PATHWAYS.filter((p) => p.category === "off-chain").map((pathway) => (
        <PathwayCard
          key={pathway.id}
          pathway={pathway}
          expanded={expandedPathway === pathway.id}
          onToggle={() => onTogglePathway(pathway.id)}
        />
      ))}
    </section>
  );
}
