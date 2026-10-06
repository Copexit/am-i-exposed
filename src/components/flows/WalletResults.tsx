"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import type { WalletAuditResult, WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { DescriptorParseResult, ScriptType } from "@/lib/bitcoin/descriptor";
import type { UtxoTraceResult } from "@/hooks/useWalletAnalysis";
import { CopyButton } from "@/components/ui/CopyButton";
import { GRADE_COLORS, GRADE_VAR, P2PKH_DUST_LIMIT } from "@/lib/constants";
import { fmtN } from "@/lib/format";
import { FlowShell, NewScanLink, Chip } from "./FlowUi";
import { FindingGroups } from "./FindingGroups";
import { WalletWorkspace } from "./WalletWorkspace";

/** Find the worst privacy offender address for the highlight card. */
function findWorstOffender(addressInfos: WalletAddressInfo[]): {
  path: string;
  reuseCount: number;
  dustCount: number;
} | null {
  let worst: { path: string; reuseCount: number; dustCount: number } | null = null;
  let worstScore = 0;

  for (const info of addressInfos) {
    if (!info.addressData) continue;
    const funded = info.addressData.chain_stats.funded_txo_count + info.addressData.mempool_stats.funded_txo_count;
    const dustCount = info.utxos.filter(u => u.value < P2PKH_DUST_LIMIT).length;
    const score = (funded > 1 ? funded * 10 : 0) + dustCount * 5;
    if (score > worstScore) {
      worstScore = score;
      worst = { path: info.derived.path, reuseCount: funded > 1 ? funded : 0, dustCount };
    }
  }

  return worst;
}

interface WalletResultsProps {
  descriptor: DescriptorParseResult;
  result: WalletAuditResult;
  addressInfos: WalletAddressInfo[];
  utxoTraces: Map<string, UtxoTraceResult> | null;
  onBack: () => void;
  onScan: (input: string) => void;
  durationMs: number | null;
  /** A bare xpub/tpub whose address type was guessed: offer the other types */
  scriptTypeDetected?: boolean;
}

/** Wallet (xpub / descriptor) audit: verdict band, grouped findings, analyst workspace. */
/** Descriptor wrappers to rescan a bare key as a chosen address type. */
const WRAP: Record<ScriptType, (k: string) => string> = {
  "p2wpkh": (k) => `wpkh(${k})`,
  "p2tr": (k) => `tr(${k})`,
  "p2sh-p2wpkh": (k) => `sh(wpkh(${k}))`,
  "p2pkh": (k) => `pkh(${k})`,
};

export function WalletResults({ descriptor, result, addressInfos, utxoTraces, onBack, onScan, durationMs, scriptTypeDetected }: WalletResultsProps) {
  const { t } = useTranslation();
  const [addressesOpen, setAddressesOpen] = useState(false);
  const worst = useMemo(() => findWorstOffender(addressInfos), [addressInfos]);
  const showWorst = !!worst && (worst.reuseCount > 0 || worst.dustCount > 0);
  const derivedCount = descriptor.receiveAddresses.length + descriptor.changeAddresses.length;
  const gradeColor = GRADE_VAR[result.grade];

  const openAddresses = () => {
    setAddressesOpen(true);
    requestAnimationFrame(() => document.getElementById("wallet-addresses")?.scrollIntoView({ block: "start" }));
  };

  const stats: { label: string; value: string; warn?: boolean }[] = [
    { label: t("wallet.activeAddresses", { defaultValue: "Active addresses" }), value: fmtN(result.activeAddresses) },
    { label: t("wallet.totalTxs", { defaultValue: "Total transactions" }), value: fmtN(result.totalTxs) },
    { label: t("wallet.totalUtxos", { defaultValue: "Total UTXOs" }), value: fmtN(result.totalUtxos) },
    { label: t("wallet.totalBalance", { defaultValue: "Total balance" }), value: `${fmtN(result.totalBalance)} sats` },
    { label: t("wallet.reusedAddresses", { defaultValue: "Reused addresses" }), value: fmtN(result.reusedAddresses), warn: result.reusedAddresses > 0 },
    { label: t("wallet.dustUtxos", { defaultValue: "Dust UTXOs" }), value: fmtN(result.dustUtxos), warn: result.dustUtxos > 0 },
  ];

  return (
    <FlowShell className="py-6 sm:py-10 space-y-10" testId="wallet-results">
      <NewScanLink onBack={onBack} />

      {/* Verdict band */}
      <section
        data-testid="wallet-verdict"
        data-grade={result.grade}
        data-score={result.score}
        className="relative overflow-hidden rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card)"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(60% 90% at 0% 0%, color-mix(in srgb, ${gradeColor} 10%, transparent), transparent 70%)` }}
        />
        <div className="relative grid lg:grid-cols-[minmax(260px,320px)_1fr]">
          <div className="p-5 sm:p-7 lg:border-r border-b lg:border-b-0 border-hairline flex flex-col gap-4 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="eyebrow">{t("wallet.auditTitle", { defaultValue: "Wallet Privacy Audit" })}</span>
              <Chip>{descriptor.scriptType}</Chip>
            </div>
            {scriptTypeDetected && (
              <p className="text-xs text-muted">
                {t("wallet.scanAs", { defaultValue: "Address type detected from on-chain history. Scan as:" })}{" "}
                {(Object.keys(WRAP) as ScriptType[]).filter((s) => s !== descriptor.scriptType).map((s, i) => (
                  <span key={s}>
                    {i > 0 && " · "}
                    <button type="button" onClick={() => onScan(WRAP[s](descriptor.xpub))} className="underline underline-offset-2 text-foreground hover:text-bitcoin cursor-pointer">{s}</button>
                  </span>
                ))}
              </p>
            )}
            <div className="flex items-end gap-4">
              <span
                className={`text-[80px] sm:text-[96px] leading-[0.85] font-semibold tracking-tight ${GRADE_COLORS[result.grade]}`}
                aria-label={t("flows.gradeAria", { grade: result.grade, defaultValue: "Grade {{grade}}" })}
              >
                {result.grade}
              </span>
              <span className="num text-muted pb-1">
                <span className="text-2xl text-foreground">{result.score}</span>
                <span className="text-sm">/100</span>
              </span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="num text-xs text-muted truncate" title={descriptor.xpub}>{descriptor.xpub}</span>
              <CopyButton text={descriptor.xpub} variant="inline" iconSize={14} className="shrink-0 p-2 -m-2" />
            </div>
          </div>

          <div className="p-5 sm:p-7 flex flex-col gap-6 min-w-0">
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
              {stats.map((s) => (
                <div key={s.label} className="min-w-0">
                  <dt className="text-[13px] text-muted">{s.label}</dt>
                  <dd className={`num text-lg sm:text-xl mt-1 break-words ${s.warn ? "text-severity-high" : "text-foreground"}`}>{s.value}</dd>
                </div>
              ))}
            </dl>

            {showWorst && worst && (
              <button
                type="button"
                onClick={openAddresses}
                className="group w-full flex items-center gap-3 rounded-lg border border-severity-high/25 bg-severity-high/5 px-4 py-3 min-h-[44px] text-left hover:border-severity-high/50 transition-colors cursor-pointer"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-severity-high shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-sm text-foreground">
                  {t("wallet.worstOffender", { defaultValue: "Worst privacy:" })}{" "}
                  <span className="num text-[13px] break-all">{worst.path}</span>
                  {worst.reuseCount > 0 && (
                    <span className="text-severity-critical">
                      {" "}- {t("wallet.reusedNTimes", { count: worst.reuseCount, defaultValue: "reused {{count}} times" })}
                    </span>
                  )}
                  {worst.dustCount > 0 && (
                    <span className="text-severity-medium">
                      , {t("wallet.nDustUtxos", { count: worst.dustCount, defaultValue: "{{count}} dust UTXOs" })}
                    </span>
                  )}
                </span>
                <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-faint group-hover:text-foreground transition-colors" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Findings + scope rail */}
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-8 items-start">
        <div className="lg:col-span-8 min-w-0">
          <FindingGroups findings={result.findings} onTxClick={onScan} />
        </div>
        <aside className="lg:col-span-4 lg:sticky lg:top-24 rounded-xl border border-hairline p-5 space-y-4">
          <span className="eyebrow">{t("flows.auditScope", { defaultValue: "Audit scope" })}</span>
          <dl className="space-y-2.5 text-sm">
            <ScopeRow label={t("flows.receiveChain", { defaultValue: "Receive chain" })} value={fmtN(descriptor.receiveAddresses.length)} />
            <ScopeRow label={t("flows.changeChain", { defaultValue: "Change chain" })} value={fmtN(descriptor.changeAddresses.length)} />
            <ScopeRow label={t("flows.network", { defaultValue: "Network" })} value={descriptor.network} />
          </dl>
          <p className="text-[13px] text-muted leading-relaxed border-t border-hairline pt-4">
            {durationMs
              ? t("wallet.auditFooterWithDuration", {
                  duration: (durationMs / 1000).toFixed(1),
                  addressCount: derivedCount,
                  defaultValue: "Wallet audit completed in {{duration}}s. Analyzed {{addressCount}} derived addresses. All analysis ran entirely in the browser.",
                })
              : t("wallet.auditFooter", {
                  addressCount: derivedCount,
                  defaultValue: "Wallet audit completed. Analyzed {{addressCount}} derived addresses. All analysis ran entirely in the browser.",
                })}
          </p>
        </aside>
      </div>

      <WalletWorkspace
        result={result}
        addressInfos={addressInfos}
        utxoTraces={utxoTraces}
        onScan={onScan}
        addressesOpen={addressesOpen}
        onAddressesOpenChange={setAddressesOpen}
      />
    </FlowShell>
  );
}

function ScopeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="num text-foreground">{value}</dd>
    </div>
  );
}
