"use client";

import { lazy, Suspense, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { WalletAuditResult, WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import type { UtxoTraceResult } from "@/hooks/useWalletAnalysis";
import { CoinSelector } from "@/components/wallet/CoinSelector";
import { WalletUtxoList } from "@/components/wallet/WalletUtxoList";
import { fmtN } from "@/lib/format";
import { buildCoinInputs } from "@/lib/analysis/coin-selection";

const WalletAddressTable = lazy(() => import("@/components/wallet/WalletAddressTable").then(m => ({ default: m.WalletAddressTable })));
const WalletTxList = lazy(() => import("@/components/wallet/WalletTxList").then(m => ({ default: m.WalletTxList })));
const WalletGraphExplorerPanel = lazy(() => import("@/components/wallet/WalletGraphExplorerPanel").then(m => ({ default: m.WalletGraphExplorerPanel })));

/** Analyst workspace: wallet graph, address table, tx history, coin selection. */
export function WalletWorkspace({ result, addressInfos, utxoTraces, onScan, addressesOpen, onAddressesOpenChange }: {
  result: WalletAuditResult;
  addressInfos: WalletAddressInfo[];
  utxoTraces: Map<string, UtxoTraceResult> | null;
  onScan: (input: string) => void;
  addressesOpen: boolean;
  onAddressesOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [txsOpen, setTxsOpen] = useState(false);
  const [coinsOpen, setCoinsOpen] = useState(false);
  const [utxosOpen, setUtxosOpen] = useState(false);
  const allUtxos = useMemo(() => buildCoinInputs(addressInfos), [addressInfos]);
  const hasTxs = result.totalTxs > 0;

  if (!hasTxs && result.activeAddresses === 0 && allUtxos.length === 0) return null;

  return (
    <section aria-labelledby="wallet-workspace" className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 id="wallet-workspace" className="text-[20px] font-semibold tracking-tight">
          {t("flows.analystWorkspace", { defaultValue: "Analyst workspace" })}
        </h2>
        <span className="text-[13px] text-muted hidden sm:inline">
          {t("flows.analystWorkspaceHint", { defaultValue: "Graph, addresses, history and coin selection for this wallet." })}
        </span>
      </div>

      <div className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) divide-y divide-hairline">
        {hasTxs && (
          <div className="p-3 sm:p-5 space-y-3 min-w-0">
            <span className="eyebrow block px-1">{t("wallet.txGraph", { defaultValue: "Transaction Graph" })}</span>
            <Suspense fallback={<Loading />}>
              <WalletGraphExplorerPanel addressInfos={addressInfos} utxoTraces={utxoTraces} onTxClick={onScan} />
            </Suspense>
          </div>
        )}

        {result.activeAddresses > 0 && (
          <Panel
            id="wallet-addresses"
            title={t("flows.addresses", { defaultValue: "Addresses" })}
            count={result.activeAddresses}
            open={addressesOpen}
            onToggle={() => onAddressesOpenChange(!addressesOpen)}
          >
            <Suspense fallback={<Loading />}>
              <WalletAddressTable addressInfos={addressInfos} onScan={onScan} />
            </Suspense>
          </Panel>
        )}

        {hasTxs && (
          <Panel
            title={t("flows.transactions", { defaultValue: "Transactions" })}
            count={result.totalTxs}
            open={txsOpen}
            onToggle={() => setTxsOpen(o => !o)}
          >
            <Suspense fallback={<Loading />}>
              <WalletTxList addressInfos={addressInfos} onScan={onScan} />
            </Suspense>
          </Panel>
        )}

        {allUtxos.length > 0 && (
          <Panel
            title={t("wallet.utxos.title", { defaultValue: "Coins (UTXOs)" })}
            count={allUtxos.length}
            open={utxosOpen}
            onToggle={() => setUtxosOpen(o => !o)}
          >
            <WalletUtxoList addressInfos={addressInfos} onScan={onScan} />
          </Panel>
        )}

        {allUtxos.length > 0 && (
          <Panel
            title={t("wallet.coinSelection", { defaultValue: "Coin Selection Advisor" })}
            count={allUtxos.length}
            countLabel={t("flows.utxosAvailable", { count: allUtxos.length, defaultValue: "{{count}} UTXOs" })}
            open={coinsOpen}
            onToggle={() => setCoinsOpen(o => !o)}
          >
            <CoinSelector utxos={allUtxos} />
          </Panel>
        )}
      </div>
    </section>
  );
}

function Panel({ id, title, count, countLabel, open, onToggle, children }: {
  id?: string;
  title: string;
  count: number;
  countLabel?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div id={id} className="min-w-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        className="group w-full flex items-center gap-3 px-4 sm:px-6 min-h-[56px] text-left hover:bg-surface-2 transition-colors cursor-pointer"
      >
        <span className="text-[15px] font-medium text-foreground">{title}</span>
        <span className="num text-sm text-muted">{countLabel ?? fmtN(count)}</span>
        <span className="flex-1" />
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`text-faint group-hover:text-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* Heavy bodies mount only when open. */}
      {open && <div id={bodyId} className="px-3 sm:px-6 pb-5 min-w-0">{children}</div>}
    </div>
  );
}

function Loading() {
  const { t } = useTranslation();
  return <div className="text-sm text-muted text-center py-4">{t("common.loading", { defaultValue: "Loading..." })}</div>;
}
