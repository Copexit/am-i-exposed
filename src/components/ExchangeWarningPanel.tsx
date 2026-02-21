"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, AlertTriangle, Shield, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  EXCHANGE_POLICIES,
  SAFE_ALTERNATIVES,
  COMPILED_DATE,
  type PolicyStatus,
} from "@/data/exchange-policies";

const POLICY_CONFIG: Record<PolicyStatus, { labelKey: string; labelDefault: string; color: string }> = {
  blocks: { labelKey: "exchange.policyBlocks", labelDefault: "Blocks", color: "text-severity-critical bg-severity-critical/10" },
  flags: { labelKey: "exchange.policyFlags", labelDefault: "Flags", color: "text-severity-high bg-severity-high/10" },
  retroactive: { labelKey: "exchange.policyRetroactive", labelDefault: "Retroactive", color: "text-severity-medium bg-severity-medium/10" },
  "no-known-restrictions": { labelKey: "exchange.policyNoRestrictions", labelDefault: "No known restrictions", color: "text-severity-good bg-severity-good/10" },
  defunct: { labelKey: "exchange.policyDefunct", labelDefault: "Defunct", color: "text-muted bg-surface-inset" },
};

const STATUS_LABEL: Record<string, { key: string; default: string }> = {
  operating: { key: "exchange.statusOperating", default: "Operating" },
  bankrupt: { key: "exchange.statusBankrupt", default: "Bankrupt" },
  "shut-down": { key: "exchange.statusShutDown", default: "Shut down" },
};

const SAFE_LINKS: Record<string, string> = {
  Bisq: "https://bisq.network",
  RoboSats: "https://robosats.com",
  "Hodl Hodl": "https://hodlhodl.com",
};

export function ExchangeWarningPanel() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const activeExchanges = EXCHANGE_POLICIES.filter(
    (e) => e.status === "operating" && e.policy !== "no-known-restrictions",
  );
  const defunctExchanges = EXCHANGE_POLICIES.filter(
    (e) => e.status !== "operating" && e.policy !== "no-known-restrictions",
  );

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left cursor-pointer group px-1 py-3 min-h-[44px]"
      >
        <AlertTriangle size={14} className="text-severity-medium shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wider text-muted group-hover:text-muted">
          {t("exchange.panelTitle", { defaultValue: "Exchange CoinJoin Policies" })}
        </span>
        <ChevronDown
          size={14}
          className={`ml-auto text-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
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
            <div className="mt-3 bg-card-bg border border-card-border rounded-xl p-5 space-y-4">
              {/* Dated disclaimer */}
              <div className="bg-severity-medium/5 border border-severity-medium/20 rounded-lg p-3">
                <p className="text-xs text-severity-medium leading-relaxed">
                  {t("exchange.disclaimer", {
                    date: COMPILED_DATE,
                    defaultValue: "This information was compiled in {{date}} and may be out of date. Exchange policies change frequently - always verify current policies before transacting. This list is not comprehensive; many exchanges may have undocumented policies.",
                  })}
                </p>
              </div>

              {/* Active exchanges */}
              <div>
                <h3 className="text-sm font-medium text-foreground/90 mb-2">
                  {t("exchange.activeExchanges", { defaultValue: "Active exchanges with documented CoinJoin policies" })}
                </h3>
                <div className="space-y-2">
                  {activeExchanges.map((e) => {
                    const cfg = POLICY_CONFIG[e.policy];
                    return (
                      <div key={e.name} className="flex items-start gap-3 bg-surface-inset rounded-lg px-3 py-2">
                        <div className="shrink-0 mt-0.5">
                          <span className={`inline-block text-xs font-medium px-1.5 py-0.5 rounded ${cfg.color}`}>
                            {t(cfg.labelKey, { defaultValue: cfg.labelDefault })}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground/90">{e.name}</p>
                          <p className="text-xs text-muted mt-0.5">{e.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Defunct exchanges */}
              {defunctExchanges.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted mb-2">
                    {t("exchange.defunctExchanges", { defaultValue: "Historical (no longer operating)" })}
                  </h3>
                  <div className="space-y-1">
                    {defunctExchanges.map((e) => {
                      const statusInfo = STATUS_LABEL[e.status];
                      return (
                        <div key={e.name} className="flex items-center gap-2 text-xs text-muted px-3 py-1">
                          <span className="font-medium text-foreground/60">{e.name}</span>
                          <span className="text-muted">-</span>
                          <span>{t(statusInfo.key, { defaultValue: statusInfo.default })}</span>
                          <span className="text-muted">-</span>
                          <span className="truncate">{e.detail}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Safe alternatives */}
              <div className="border-t border-card-border pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={14} className="text-severity-good" />
                  <h3 className="text-sm font-medium text-foreground/90">
                    {t("exchange.safeAlternatives", { defaultValue: "Decentralized alternatives (no chain surveillance)" })}
                  </h3>
                </div>
                <div className="space-y-2">
                  {SAFE_ALTERNATIVES.map((e) => (
                    <div key={e.name} className="flex items-start gap-3 bg-severity-good/5 border border-severity-good/20 rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground/90">{e.name}</p>
                          {SAFE_LINKS[e.name] && (
                            <a
                              href={SAFE_LINKS[e.name]}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-bitcoin/70 hover:text-bitcoin transition-colors"
                            >
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-muted mt-0.5">{e.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              <div className="border-t border-card-border pt-4">
                <h3 className="text-sm font-medium text-foreground/90 mb-2">
                  {t("exchange.recommendationsTitle", { defaultValue: "Recommendations" })}
                </h3>
                <ul className="space-y-1.5 text-xs text-muted leading-relaxed">
                  <li className="flex gap-2">
                    <span className="text-bitcoin shrink-0">1.</span>
                    {t("exchange.rec1", { defaultValue: "Do not deposit CoinJoin outputs directly to a centralized exchange." })}
                  </li>
                  <li className="flex gap-2">
                    <span className="text-bitcoin shrink-0">2.</span>
                    {t("exchange.rec2", { defaultValue: "Maintain strict separation between privacy wallets and exchange wallets." })}
                  </li>
                  <li className="flex gap-2">
                    <span className="text-bitcoin shrink-0">3.</span>
                    {t("exchange.rec3", { defaultValue: "Never mix coins after withdrawing from a KYC exchange - exchanges monitor where withdrawals go." })}
                  </li>
                  <li className="flex gap-2">
                    <span className="text-bitcoin shrink-0">4.</span>
                    {t("exchange.rec4", { defaultValue: "Use decentralized exchanges (Bisq, RoboSats, Hodl Hodl) for converting CoinJoin outputs." })}
                  </li>
                  <li className="flex gap-2">
                    <span className="text-bitcoin shrink-0">5.</span>
                    {t("exchange.rec5", { defaultValue: "Be aware of retroactive risk - exchanges can re-scan historical transactions at any time." })}
                  </li>
                </ul>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
