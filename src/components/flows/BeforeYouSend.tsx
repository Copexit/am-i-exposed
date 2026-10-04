"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, CircleCheck, FileSignature, Info, Loader2, Search, TriangleAlert } from "lucide-react";
import { formatSats } from "@/lib/format";
import { findingKeys } from "@/lib/finding-utils";
import { createMempoolClient, type RecommendedFees } from "@/lib/api/mempool";
import { buildChecklist, type SafetyItem } from "@/lib/analysis/pre-broadcast-checklist";
import { useNetwork } from "@/context/NetworkContext";
import { SEVERITY_BG } from "@/components/results/severity";
import type { AnalysisState } from "@/lib/analysis/analysis-state";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

interface BeforeYouSendProps {
  local: LocalTx;
  /** Analyzed tx (prevouts patched after a lookup); falls back to the parsed one. */
  txData: MempoolTransaction | null;
  result: ScoringResult;
  lookup: AnalysisState["localLookup"];
  outputTxCounts: Map<string, number> | null;
  onLookup: () => void;
  /** Host the lookup goes to, named in the consent copy. */
  endpoint: string;
}

const STATUS = {
  signed: { key: "local.status.signed", def: "Signed, ready to broadcast", cls: "text-severity-good border-severity-good/30" },
  partial: { key: "local.status.partial", def: "Partially signed", cls: "text-severity-medium border-severity-medium/30" },
  unsigned: { key: "local.status.unsigned", def: "Not signed yet", cls: "text-muted border-hairline-strong" },
} as const;

const TONE = {
  bad: { Icon: CircleAlert, cls: "text-severity-critical" },
  warn: { Icon: TriangleAlert, cls: "text-severity-medium" },
  info: { Icon: Info, cls: "text-muted" },
  good: { Icon: CircleCheck, cls: "text-severity-good" },
} as const;

const SAFETY_EN: Record<SafetyItem["id"], string> = {
  "fee-absurd": "The fee is unusually high: {{rate}} sat/vB ({{fee}} sats). Check it before sending.",
  "fee-high": "The fee rate ({{rate}} sat/vB) is more than twice the fastest estimate ({{fastest}} sat/vB).",
  "fee-low": "The fee rate ({{rate}} sat/vB) is below the economy estimate ({{economy}} sat/vB). It may take a long time to confirm.",
  dust: "{{count}} output(s) below 546 sats (dust).",
  "rbf-on": "Replace-by-fee is enabled: the fee can be bumped later.",
  "rbf-off": "Replace-by-fee is disabled: the fee cannot be bumped later.",
  "locktime-none": "nLockTime is 0. Wallets that set it to the current block height (anti-fee-sniping) blend in better.",
  "reused-output": "{{count}} output address(es) already have history: sending to a reused address links this payment to it.",
  unsigned: "Sign it in your wallet, then paste or scan the signed transaction to broadcast it from here.",
  partial: "Some signatures are still missing. Finish signing in your wallet first.",
  "signatures-later": "Signature-based wallet fingerprints become visible only once it is signed.",
};

/** The Before you send panel for a PSBT / raw tx analyzed in memory, before it is broadcast. */
export function BeforeYouSend({ local, txData, result, lookup, outputTxCounts, onLookup, endpoint }: BeforeYouSendProps) {
  const { t, i18n } = useTranslation();
  const { config } = useNetwork();
  const tx = txData ?? local.tx;
  const known = tx.vin.every((v) => v.prevout);

  // Fee estimates reveal nothing about the tx. Fetched once the fee is known; a failure only drops the fee hints.
  const [fees, setFees] = useState<RecommendedFees | null>(null);
  useEffect(() => {
    if (!known || fees) return;
    const ac = new AbortController();
    createMempoolClient(config.mempoolBaseUrl, { signal: ac.signal }).getRecommendedFees().then(setFees, () => {});
    return () => ac.abort();
  }, [known, fees, config.mempoolBaseUrl]);

  const checklist = useMemo(
    () => buildChecklist({ local, tx, result, fees, outputTxCounts }),
    [local, tx, result, fees, outputTxCounts],
  );

  const fee = known ? tx.fee : 0;
  const na = t("flows.notAvailable", { defaultValue: "N/A" });
  const facts = [
    { label: t("psbt.inputs", { defaultValue: "Inputs" }), value: String(tx.vin.length) },
    { label: t("psbt.outputs", { defaultValue: "Outputs" }), value: String(tx.vout.length) },
    { label: t("psbt.fee", { defaultValue: "Fee" }), value: fee > 0 ? formatSats(fee, i18n.language) : na },
    { label: t("psbt.feeRate", { defaultValue: "Fee rate" }), value: fee > 0 && checklist.feeRate !== null ? `${Math.round(checklist.feeRate)} sat/vB` : na },
  ];
  const title = t("local.title", { defaultValue: "Before you send" });
  const status = STATUS[local.status];
  const running = lookup?.status === "running";

  return (
    <section
      data-testid="before-you-send"
      aria-label={title}
      className="w-full rounded-xl border border-bitcoin/25 bg-bitcoin/[0.04] px-4 sm:px-5 py-4 space-y-4"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-medium text-bitcoin">
            <FileSignature size={16} aria-hidden="true" />
            {title}
          </span>
          <span data-testid="local-status" className={`text-xs px-2 py-0.5 rounded-md border ${status.cls}`}>
            {t(status.key, { defaultValue: status.def })}
          </span>
          <span className="text-xs text-muted sm:ml-auto">
            {t("local.projectedGrade", { grade: result.grade, defaultValue: "Projected grade if broadcast: {{grade}}" })}
          </span>
        </div>
        <p className="text-[13px] text-muted">
          {t("flows.psbtLocal", { defaultValue: "Analyzed locally. Nothing is sent unless you choose to." })}
        </p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[13px] text-muted">{f.label}</dt>
            <dd className="num text-[15px] text-foreground mt-0.5 break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      {!known && (
        <p className="flex items-start gap-2 text-[13px] text-severity-medium">
          <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          {t("psbt.incomplete", { defaultValue: "Some inputs are missing UTXO data. Fee calculation may be incomplete." })}
        </p>
      )}

      {lookup && lookup.status !== "done" && (
        <div className="rounded-lg border border-hairline bg-surface-inset px-3.5 py-3 space-y-2.5">
          <p className="text-sm text-foreground">
            {t("local.lookupWhy", { inputs: lookup.inputs, addresses: lookup.addresses, host: endpoint, defaultValue: "Complete the analysis: look up {{inputs}} inputs and {{addresses}} addresses on {{host}}." })}
          </p>
          <p className="text-[13px] text-muted">
            {t("local.lookupReveals", { host: endpoint, defaultValue: "This tells {{host}} which coins you are about to spend and where they go, linked to your IP address unless you use Tor." })}
          </p>
          {lookup.status === "failed" && (
            <p role="alert" className="text-[13px] text-severity-critical">
              {t("local.lookupFailed", { defaultValue: "The lookup failed. Try again." })}
            </p>
          )}
          <button
            type="button"
            data-testid="local-lookup"
            onClick={onLookup}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 max-w-full text-sm font-medium rounded-lg bg-bitcoin/10 text-bitcoin hover:bg-bitcoin/20 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
          >
            {running ? <Loader2 size={15} className="animate-spin shrink-0" aria-hidden="true" /> : <Search size={15} className="shrink-0" aria-hidden="true" />}
            <span className="truncate">{t("local.lookupButton", { host: endpoint, defaultValue: "Look up on {{host}}" })}</span>
          </button>
        </div>
      )}

      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2 pt-4 border-t border-hairline">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground mb-2">{t("local.revealsTitle", { defaultValue: "What this transaction reveals" })}</h3>
          {checklist.reveals.length === 0 ? (
            <p className="text-[13px] text-muted">{t("local.revealsNone", { defaultValue: "No significant leaks found." })}</p>
          ) : (
            <ul className="space-y-2.5" data-testid="local-reveals">
              {checklist.reveals.map((f) => (
                <li key={f.id} className="flex items-start gap-2.5 min-w-0">
                  <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${SEVERITY_BG[f.severity]}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground break-words">
                      {t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title })}
                    </p>
                    {f.recommendation && (
                      <p className="text-[13px] text-muted mt-0.5 break-words">
                        {t(findingKeys(f.id, "recommendation", f.params), { ...f.params, defaultValue: f.recommendation })}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground mb-2">{t("local.safetyTitle", { defaultValue: "Before broadcasting" })}</h3>
          <ul className="space-y-2" data-testid="local-safety">
            {checklist.safety.map((s) => {
              const { Icon, cls } = TONE[s.tone];
              return (
                <li key={s.id} data-safety-id={s.id} className="flex items-start gap-2.5 text-[13px] text-foreground min-w-0">
                  <Icon size={14} className={`shrink-0 mt-0.5 ${cls}`} aria-hidden="true" />
                  <span className="min-w-0 break-words">{t(`local.safety.${s.id}`, { ...s.params, defaultValue: SAFETY_EN[s.id] })}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
