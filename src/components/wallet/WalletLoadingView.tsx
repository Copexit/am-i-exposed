"use client";

import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { GlowCard } from "@/components/ui/GlowCard";

type WalletPhase = "deriving" | "fetching" | "tracing" | "analyzing";

interface WalletLoadingViewProps {
  query: string | null;
  phase: WalletPhase;
  progress: { fetched: number; total: number };
  traceProgress: { traced: number; total: number } | null;
  /** Whether the user is connected to a local/self-hosted API */
  isLocalApi: boolean;
  /** Whether the user is on a third-party (public) API */
  isThirdPartyApi: boolean;
}

export function WalletLoadingView({
  query,
  phase,
  progress,
  traceProgress,
  isLocalApi,
  isThirdPartyApi,
}: WalletLoadingViewProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      key="wallet-loading"
      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="flex flex-col items-center gap-6 w-full max-w-3xl"
    >
      <GlowCard className="w-full p-8 space-y-6">
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted uppercase tracking-wider">
            {t("wallet.auditTitle", { defaultValue: "Wallet Privacy Audit" })}
          </span>
          <p className="font-mono text-xs text-foreground/90 break-all leading-relaxed">
            {query}
          </p>
        </div>
        {isLocalApi && (
          <div className="flex items-center gap-2 text-xs text-severity-good">
            <ShieldCheck size={14} />
            {t("wallet.localApiBanner", { defaultValue: "Local API - address queries stay private" })}
          </div>
        )}
        <div className="border-t border-card-border pt-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-bitcoin animate-pulse" />
            <span className="text-sm text-muted">
              {phase === "deriving"
                ? t("wallet.deriving", { defaultValue: "Deriving addresses..." })
                : phase === "fetching"
                  ? `${t("wallet.fetching", { defaultValue: "Fetching transaction history..." })} (${progress.fetched})`
                  : phase === "tracing"
                    ? traceProgress
                      ? t("wallet.tracing", {
                          traced: traceProgress.traced,
                          total: traceProgress.total,
                          defaultValue: "Tracing UTXO provenance ({{traced}}/{{total}} txs)",
                        })
                      : t("wallet.tracingGeneric", { defaultValue: "Tracing UTXO provenance..." })
                    : t("wallet.analyzing", { defaultValue: "Analyzing wallet privacy..." })}
            </span>
          </div>
          {(phase === "fetching" || phase === "tracing") && progress.fetched > 0 && (
            <div className="w-full bg-surface-elevated rounded-full h-1.5">
              <div
                className="bg-bitcoin h-1.5 rounded-full transition-all duration-300 animate-pulse"
                style={{ width: "100%" }}
              />
            </div>
          )}
          {phase === "fetching" && isThirdPartyApi && (
            <p className="text-xs text-muted/70">
              {t("wallet.hostedSlowNote", { defaultValue: "Using the public API - this may take several minutes. For faster scans, connect a personal mempool instance." })}
            </p>
          )}
        </div>
      </GlowCard>
    </motion.div>
  );
}
