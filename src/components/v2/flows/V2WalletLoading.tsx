"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { Check, ShieldCheck } from "lucide-react";
import { fmtN } from "@/lib/format";
import { FlowShell } from "./V2FlowUi";

type WalletPhase = "deriving" | "fetching" | "tracing" | "analyzing";
const PHASES: readonly WalletPhase[] = ["deriving", "fetching", "tracing", "analyzing"];

interface V2WalletLoadingProps {
  query: string | null;
  phase: WalletPhase;
  progress: { fetched: number; total: number };
  traceProgress: { traced: number; total: number } | null;
  isLocalApi: boolean;
  isThirdPartyApi: boolean;
}

type StageState = "done" | "active" | "pending" | "skipped";

/** Wallet scan progress as a quiet instrument: four stages with real counts. */
export function V2WalletLoading({ query, phase, progress, traceProgress, isLocalApi, isThirdPartyApi }: V2WalletLoadingProps) {
  const { t } = useTranslation();
  // Remember whether tracing ran: the hook skips it when there are no txs to trace.
  const [seen, setSeen] = useState<ReadonlySet<WalletPhase>>(() => new Set([phase]));
  if (!seen.has(phase)) setSeen(new Set(seen).add(phase));

  const current = PHASES.indexOf(phase);
  const stateOf = (p: WalletPhase, i: number): StageState =>
    i === current ? "active" : i > current ? "pending" : p === "tracing" && !seen.has(p) ? "skipped" : "done";

  const labels: Record<WalletPhase, string> = {
    deriving: t("v2.flows.stageDerive", { defaultValue: "Derive addresses" }),
    fetching: t("v2.flows.stageFetch", { defaultValue: "Fetch history" }),
    tracing: t("v2.flows.stageTrace", { defaultValue: "Trace UTXO provenance" }),
    analyzing: t("v2.flows.stageAnalyze", { defaultValue: "Analyze wallet privacy" }),
  };

  const detail = (p: WalletPhase): string | null => {
    if (p === "fetching" && progress.fetched > 0) {
      return t("v2.flows.addressesQueried", { count: progress.fetched, value: fmtN(progress.fetched), defaultValue: "{{value}} addresses" });
    }
    if (p === "tracing" && traceProgress) {
      return `${fmtN(traceProgress.traced)} / ${fmtN(traceProgress.total)}`;
    }
    return null;
  };

  const tracePct = traceProgress && traceProgress.total > 0
    ? Math.round((traceProgress.traced / traceProgress.total) * 100)
    : null;

  return (
    <FlowShell width="narrow" className="py-12 sm:py-20" testId="v2-wallet-loading">
      <div className="space-y-2 mb-8">
        <span className="v2-eyebrow">{t("wallet.auditTitle", { defaultValue: "Wallet Privacy Audit" })}</span>
        <p className="v2-num text-[13px] text-muted break-all leading-relaxed">{query}</p>
      </div>

      {isLocalApi && (
        <p className="flex items-center gap-2 text-[13px] text-severity-good mb-6">
          <ShieldCheck size={14} aria-hidden="true" />
          {t("wallet.localApiBanner", { defaultValue: "Local API - address queries stay private" })}
        </p>
      )}

      <ol className="rounded-xl border border-hairline bg-surface-1 divide-y divide-hairline">
        {PHASES.map((p, i) => {
          const state = stateOf(p, i);
          const info = detail(p);
          return (
            <li key={p} aria-current={state === "active" ? "step" : undefined} className="px-4 sm:px-5 py-3.5">
              <div className="flex items-center gap-3 min-h-[24px]">
                <StageMark state={state} />
                <span className={`flex-1 text-[15px] ${state === "active" ? "text-foreground" : state === "done" ? "text-muted" : "text-faint"}`}>
                  {labels[p]}
                  {state === "skipped" && (
                    <span className="text-faint"> · {t("v2.flows.stageSkipped", { defaultValue: "nothing to trace" })}</span>
                  )}
                </span>
                {info && <span className="v2-num text-[13px] text-muted">{info}</span>}
              </div>
              {state === "active" && (p === "fetching" || p === "tracing") && (
                <div className="mt-3 ml-7">
                  <ProgressBar pct={p === "tracing" ? tracePct : null} label={labels[p]} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {phase === "fetching" && isThirdPartyApi && (
        <p className="text-[13px] text-muted leading-relaxed mt-5">
          {t("wallet.hostedSlowNote", { defaultValue: "Using the public API - this may take several minutes. For faster scans, connect a personal mempool instance." })}
        </p>
      )}
    </FlowShell>
  );
}

function StageMark({ state }: { state: StageState }) {
  if (state === "done") return <Check size={16} className="text-severity-good shrink-0" aria-hidden="true" />;
  if (state === "active") {
    return (
      <span className="relative flex w-4 h-4 items-center justify-center shrink-0" aria-hidden="true">
        <span className="absolute inset-0 rounded-full bg-bitcoin/25 motion-safe:animate-ping" />
        <span className="w-2 h-2 rounded-full bg-bitcoin" />
      </span>
    );
  }
  if (state === "skipped") return <span className="w-4 flex justify-center shrink-0" aria-hidden="true"><span className="w-2 h-px bg-faint" /></span>;
  return <span className="w-4 flex justify-center shrink-0" aria-hidden="true"><span className="w-2 h-2 rounded-full border border-hairline-strong" /></span>;
}

/** Determinate when a percentage is known, otherwise a slow sweep (total is unknown while fetching). */
function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  const reduced = useReducedMotion();
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className="relative h-1 rounded-full bg-surface-2 overflow-hidden"
    >
      {pct != null ? (
        <div className="h-full rounded-full bg-bitcoin transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      ) : reduced ? (
        <div className="h-full w-full bg-bitcoin/40" />
      ) : (
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full bg-bitcoin/70"
          initial={{ x: "-100%" }}
          animate={{ x: "300%" }}
          transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
        />
      )}
    </div>
  );
}
