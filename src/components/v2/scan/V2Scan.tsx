"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Check, Loader2 } from "lucide-react";
import { useNetwork } from "@/context/NetworkContext";
import { CopyButton } from "@/components/ui/CopyButton";
import type { HeuristicStep } from "@/lib/analysis/orchestrator";
import type { FetchProgress } from "@/hooks/useAnalysis";
import type { MempoolTransaction } from "@/lib/api/types";
import { ChecksStrip } from "./ChecksStrip";
import { ScanStage } from "./ScanStage";
import { scanStages, summarizeSteps, impactSeverity, apiHost, type StageId } from "./scan-model";

export interface V2ScanProps {
  query: string;
  inputType: string | null;
  phase: "fetching" | "analyzing";
  steps: HeuristicStep[];
  fetchProgress: FetchProgress | null;
  /** The transaction, once fetched (drawn live while the trace runs). */
  txData?: MempoolTransaction | null;
}

/**
 * The real waiting phase: data fetch, chain trace and engine checks, shown
 * only through live signals (source, stage, depth, txs fetched, elapsed vs
 * timeout, per-check progress and the running score).
 */
export function V2Scan({ query, inputType, phase, steps, fetchProgress, txData }: V2ScanProps) {
  const { t } = useTranslation();
  const { isUmbrel, customApiUrl, config, torStatus } = useNetwork();
  const [elapsed, setElapsed] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const isAddress = inputType === "address";
  const isPsbt = inputType === "psbt";
  const stages = scanStages(inputType, phase, fetchProgress);
  const active = stages.find((s) => s.state === "active")?.id ?? "checks";
  const sum = useMemo(() => summarizeSteps(steps, inputType), [steps, inputType]);

  const fp = fetchProgress;
  // Keep the last trace readings once the trace ends (the pipeline then resets them to zero).
  const [lastTrace, setLastTrace] = useState<FetchProgress | null>(null);
  if (fp && fp.status !== "done" && fp !== lastTrace) setLastTrace(fp);
  const shown = fp && fp.status !== "done" ? fp : lastTrace;
  const tracing = phase === "fetching" && !!fp && (fp.status === "tracing-backward" || fp.status === "tracing-forward");
  const traceProgress = tracing && fp
    ? Math.max(Math.min(100, (elapsed / Math.max(1, fp.timeoutSec)) * 100), fp.maxDepth > 0 ? Math.min(100, (fp.currentDepth / fp.maxDepth) * 100) : 0)
    : null;

  const stageLabel: Record<StageId, string> = {
    fetch: isAddress
      ? t("v2.scan.stageFetchAddress", { defaultValue: "Fetch history" })
      : t("v2.scan.stageFetch", { defaultValue: "Fetch" }),
    "trace-back": t("v2.scan.stageTraceBack", { defaultValue: "Trace inputs" }),
    "trace-fwd": t("v2.scan.stageTraceFwd", { defaultValue: "Trace outputs" }),
    checks: t("v2.scan.stageChecks", { defaultValue: "Checks" }),
  };
  const headline: Record<StageId, string> = {
    fetch: isAddress
      ? t("v2.scan.headFetchAddress", { defaultValue: "Fetching address history" })
      : t("v2.scan.headFetch", { defaultValue: "Fetching the transaction" }),
    "trace-back": t("v2.scan.headTraceBack", { defaultValue: "Tracing input provenance" }),
    "trace-fwd": t("v2.scan.headTraceFwd", { defaultValue: "Tracing output destinations" }),
    checks: t("v2.scan.headChecks", { defaultValue: "Running privacy checks" }),
  };

  const host = apiHost(config.mempoolBaseUrl);
  const source = isPsbt
    ? t("v2.scan.sourcePsbt", { defaultValue: "Parsed in this browser, nothing is sent" })
    : isUmbrel
      ? t("v2.scan.sourceLocal", { defaultValue: "Your local mempool node" })
      : customApiUrl
        ? t("v2.scan.sourceCustom", { host: host ?? customApiUrl, defaultValue: "Custom API: {{host}}" })
        : torStatus === "tor" && host?.endsWith(".onion")
          ? t("v2.scan.sourceTor", { defaultValue: "mempool.space over Tor (.onion)" })
          : host ?? "mempool.space";

  const eyebrow = isAddress
    ? t("v2.scan.eyebrowAddress", { defaultValue: "Scanning address" })
    : isPsbt
      ? t("v2.scan.eyebrowPsbt", { defaultValue: "Scanning PSBT" })
      : t("v2.scan.eyebrowTx", { defaultValue: "Scanning transaction" });

  const running = sum.runningIndex >= 0 ? steps[sum.runningIndex] : undefined;
  const stripLabel = running?.label
    ?? (phase === "fetching" ? t("v2.scan.checksWaiting", { defaultValue: "Start when the data arrives" }) : undefined);

  const readouts: { key: string; label: string; value: React.ReactNode }[] = [];
  if (!isAddress && !isPsbt) {
    readouts.push(
      {
        key: "depth",
        label: t("v2.scan.depth", { defaultValue: "Trace depth" }),
        value: shown && shown.maxDepth > 0 ? <>{shown.currentDepth}<span className="text-faint"> / {shown.maxDepth}</span></> : <span className="text-faint">-</span>,
      },
      {
        key: "txs",
        label: t("v2.scan.txsFetched", { defaultValue: "Txs fetched" }),
        value: shown ? shown.txsFetched : <span className="text-faint">-</span>,
      },
    );
  }
  readouts.push(
    {
      key: "elapsed",
      label: tracing
        ? t("v2.scan.elapsedTimeout", { defaultValue: "Elapsed / timeout" })
        : t("v2.scan.elapsed", { defaultValue: "Elapsed" }),
      value: tracing && fp ? <>{elapsed}s<span className="text-faint"> / {fp.timeoutSec}s</span></> : `${elapsed}s`,
    },
    {
      // Raw impact of the checks so far, deliberately not shown as a score or
      // grade: cross-checks and chain analysis adjust it afterwards.
      key: "impact",
      label: t("v2.scan.rawImpact", { defaultValue: "Impact so far (before cross-checks)" }),
      value: (
        <span className="text-foreground">
          {sum.hasImpact ? (sum.impact > 0 ? `+${sum.impact}` : String(sum.impact)) : "0"}
        </span>
      ),
    },
  );

  return (
    <motion.div
      data-testid="diagnostic-loader"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-[960px] mx-auto px-4 sm:px-6 py-10 sm:py-16"
    >
      {/* Query and data source */}
      <span className="v2-eyebrow">{eyebrow}</span>
      <div className="mt-3 flex items-start gap-1">
        <p className="v2-num text-[15px] sm:text-[17px] leading-snug text-foreground break-all min-w-0" title={query}>{query}</p>
        {!isPsbt && query && (
          <CopyButton text={query} variant="inline" iconSize={14} className="shrink-0 -mt-2.5 size-11 inline-flex items-center justify-center" />
        )}
      </div>
      <p className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
        <span className="size-1.5 rounded-full bg-bitcoin shrink-0" aria-hidden="true" />
        <span className="truncate">
          {source}
          {!isPsbt && <span className="text-faint"> · {config.label}</span>}
        </span>
      </p>

      {/* Stage track */}
      <ol className="mt-8 mb-4 flex flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-2" aria-label={t("v2.scan.stagesLabel", { defaultValue: "Scan stages" })}>
        {stages.map((s) => (
          <li key={s.id} className={`flex items-center gap-2 text-[13px] ${s.state === "active" ? "text-foreground" : s.state === "done" ? "text-muted" : "text-faint"}`} aria-current={s.state === "active" ? "step" : undefined}>
            {s.state === "done"
              ? <Check size={13} className="text-severity-good" aria-hidden="true" />
              : <span className={`size-1.5 rounded-full ${s.state === "active" ? "bg-bitcoin motion-safe:animate-pulse" : "bg-faint/60"}`} aria-hidden="true" />}
            {stageLabel[s.id]}
          </li>
        ))}
      </ol>

      <ScanStage kind={isAddress ? "address" : isPsbt ? "psbt" : "tx"} focus={tracing && fp ? (fp.status === "tracing-backward" ? "in" : "out") : null} traceProgress={traceProgress} tx={txData} />

      <h2 className="mt-5 text-[17px] sm:text-[20px] font-medium tracking-tight text-foreground" role="status" aria-live="polite">
        {headline[active]}
      </h2>

      {/* Live readouts */}
      <dl className={`v2-readouts mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline ${readouts.length === 4 ? "sm:grid-cols-4" : ""}`}>
        {readouts.map((r) => (
          <div key={r.key} className="bg-background px-4 py-3">
            <dt className="v2-eyebrow">{r.label}</dt>
            <dd className="v2-num mt-2 text-[20px] leading-none text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>

      {/* Engine checks */}
      {steps.length > 0 && (
        <div className="mt-8">
          <ChecksStrip
            total={steps.length}
            done={sum.done}
            current={sum.runningIndex >= 0 ? sum.runningIndex : undefined}
            highlight={(i) => impactSeverity(steps[i]?.impact)}
            label={stripLabel}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-[12px] text-faint">
              {t("v2.scan.stripLegend", { defaultValue: "One cell per check, in engine order. Green raised the score, red lowered it." })}
            </p>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="min-h-11 sm:min-h-8 -ml-2 sm:ml-0 sm:-mr-2 px-2 rounded-md text-[13px] text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-bitcoin transition-colors cursor-pointer"
            >
              {showAll
                ? t("v2.scan.showLess", { defaultValue: "Hide checks" })
                : t("v2.scan.showAll", { count: steps.length, defaultValue: "Show all {{count}} checks" })}
            </button>
          </div>
          {showAll && <StepList steps={steps} />}
        </div>
      )}
    </motion.div>
  );
}

function StepList({ steps }: { steps: HeuristicStep[] }) {
  return (
    <ul className="mt-3 grid sm:grid-cols-2 gap-x-8 border-t border-hairline pt-3">
      {steps.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5 py-1.5 text-[13px]">
          {s.status === "done"
            ? <Check size={13} className="text-muted shrink-0" aria-hidden="true" />
            : s.status === "running"
              ? <Loader2 size={13} className="text-bitcoin animate-spin shrink-0" aria-hidden="true" />
              : <span className="size-[13px] shrink-0 grid place-items-center" aria-hidden="true"><span className="size-1 rounded-full bg-faint" /></span>}
          <span className={`flex-1 min-w-0 truncate ${s.status === "pending" ? "text-faint" : "text-foreground"}`}>{s.label}</span>
          {s.status === "done" && s.impact !== undefined && s.impact !== 0 && (
            <span className={`v2-num text-[12px] ${s.impact > 0 ? "text-severity-good" : "text-severity-critical"}`}>
              {s.impact > 0 ? "+" : ""}{s.impact}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
