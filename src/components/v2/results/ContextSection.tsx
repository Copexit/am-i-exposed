"use client";

import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import { CexRiskPanel } from "@/components/CexRiskPanel";
import { ExchangeWarningPanel } from "@/components/ExchangeWarningPanel";
import { CommonMistakes } from "@/components/CommonMistakes";
import { AnalystView } from "@/components/AnalystView";
const Remediation = lazy(() => import("@/components/Remediation").then((m) => ({ default: m.Remediation })));
const RecoveryFlow = lazy(() => import("@/components/RecoveryFlow").then((m) => ({ default: m.RecoveryFlow })));

interface ContextSectionProps {
  query: string;
  inputType: "txid" | "address";
  vm: ResultViewModel;
  txData: MempoolTransaction | null;
  devMode: boolean;
}

/** Before you act: exchange screening, exchange CoinJoin policies, mistakes, the analyst's reading, fixes. */
export function ContextSection({ query, inputType, vm, txData, devMode }: ContextSectionProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="v2-context-title" className="space-y-5 pt-10 border-t border-hairline" data-testid="v2-context">
      <div>
        <p className="v2-eyebrow mb-2">{t("v2.results.contextEyebrow", { defaultValue: "Before you act" })}</p>
        <h2 id="v2-context-title" className="text-xl font-semibold tracking-tight">
          {t("v2.results.contextTitle", { defaultValue: "Exchanges, mistakes and fixes" })}
        </h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        <div className="space-y-4 min-w-0">
          <CexRiskPanel query={query} inputType={inputType} txData={txData} isCoinJoin={vm.isCoinJoin} />
          {vm.isCoinJoin && <ExchangeWarningPanel />}
        </div>
        <div className="space-y-4 min-w-0">
          {inputType === "txid" && vm.all.length > 0 && <AnalystView findings={vm.all} grade={vm.grade} />}
          <CommonMistakes findings={vm.all} grade={vm.grade} />
          {devMode && (
            <Suspense fallback={null}>
              <Remediation findings={vm.all} grade={vm.grade} />
              {(vm.grade === "D" || vm.grade === "F") && <RecoveryFlow grade={vm.grade} />}
            </Suspense>
          )}
        </div>
      </div>
    </section>
  );
}
