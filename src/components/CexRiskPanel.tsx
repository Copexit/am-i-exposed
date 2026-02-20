"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  Loader2,
  AlertTriangle,
  Search,
  RotateCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { checkChainalysis } from "@/lib/analysis/cex-risk/chainalysis-check";
import { extractTxAddresses } from "@/lib/analysis/cex-risk/extract-addresses";
import type { ChainalysisCheckResult } from "@/lib/analysis/cex-risk/types";
import type { InputType } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";

interface CexRiskPanelProps {
  query: string;
  inputType: InputType;
  txData: MempoolTransaction | null;
}

export function CexRiskPanel({ query, inputType, txData }: CexRiskPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  // Derive addresses to check
  const addresses = useMemo(() => {
    if (inputType === "address") return [query];
    if (inputType === "txid" && txData) return extractTxAddresses(txData);
    return [];
  }, [query, inputType, txData]);

  // OFAC check runs immediately (local, no privacy cost)
  const ofacResult = useMemo(() => checkOfac(addresses), [addresses]);

  // Chainalysis is opt-in (routed through Cloudflare Worker proxy)
  const [chainalysis, setChainalysis] = useState<ChainalysisCheckResult>({
    status: "idle",
    sanctioned: false,
    identifications: [],
    matchedAddresses: [],
  });

  // AbortController to cancel in-flight chainalysis requests on unmount/re-render
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runChainalysis = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChainalysis((prev) => ({ ...prev, status: "loading" }));
    try {
      const result = await checkChainalysis(addresses, controller.signal);
      setChainalysis({
        status: "done",
        sanctioned: result.sanctioned,
        identifications: result.identifications,
        matchedAddresses: result.matchedAddresses,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setChainalysis((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : "Request failed",
      }));
    }
  }, [addresses]);

  if (addresses.length === 0) return null;

  const hasSanction = ofacResult.sanctioned || chainalysis.sanctioned;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left cursor-pointer group px-1 py-3 min-h-[44px]"
      >
        {hasSanction ? (
          <ShieldX size={14} className="text-severity-critical shrink-0" />
        ) : (
          <ShieldCheck size={14} className="text-muted group-hover:text-muted shrink-0" />
        )}
        <span
          className={`text-xs font-medium uppercase tracking-wider ${
            hasSanction ? "text-severity-critical" : "text-muted group-hover:text-muted"
          }`}
        >
          {t("cex.exchangeRiskCheck", { defaultValue: "Exchange Risk Check" })}
        </span>
        {hasSanction && (
          <span className="text-xs font-medium text-severity-critical bg-severity-critical/10 px-1.5 py-0.5 rounded">
            {t("cex.flagged", { defaultValue: "FLAGGED" })}
          </span>
        )}
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
              <p className="text-sm text-muted">
                {inputType === "txid"
                  ? t("cex.willFlagTx", { defaultValue: "Will exchanges flag this transaction?" })
                  : t("cex.willFlagAddr", { defaultValue: "Will exchanges flag this address?" })}
              </p>

              {/* OFAC row */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {ofacResult.sanctioned ? (
                    <ShieldX size={16} className="text-severity-critical" />
                  ) : (
                    <ShieldCheck size={16} className="text-severity-good" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground/90">
                      {t("cex.ofacTitle", { defaultValue: "OFAC Sanctions List" })}
                    </span>
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        ofacResult.sanctioned
                          ? "bg-severity-critical/10 text-severity-critical"
                          : "bg-severity-good/10 text-severity-good"
                      }`}
                    >
                      {ofacResult.sanctioned ? t("cex.flagged", { defaultValue: "FLAGGED" }) : t("cex.clear", { defaultValue: "Clear" })}
                    </span>
                  </div>
                  {ofacResult.sanctioned ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-severity-critical">
                        {ofacResult.matchedAddresses.length > 1
                          ? t("cex.ofacFlaggedPlural", { count: ofacResult.matchedAddresses.length, defaultValue: "{{count}} sanctioned addresses found. Exchanges will likely freeze funds associated with these addresses." })
                          : t("cex.ofacFlaggedSingular", { defaultValue: "1 sanctioned address found. Exchanges will likely freeze funds associated with this address." })}
                      </p>
                      <div className="space-y-0.5">
                        {ofacResult.matchedAddresses.map((addr) => (
                          <code
                            key={addr}
                            className="block text-xs font-mono text-severity-critical/80 break-all"
                          >
                            {addr}
                          </code>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted mt-0.5">
                      {t("cex.ofacClear", { defaultValue: "Checked against US Treasury SDN list. Client-side - no data sent." })}
                    </p>
                  )}
                  <p className="text-xs text-muted mt-1">
                    {t("cex.lastUpdated", { date: ofacResult.lastUpdated, defaultValue: "Last updated: {{date}}" })}
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-card-border" />

              {/* Chainalysis row */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {chainalysis.status === "done" ? (
                    chainalysis.sanctioned ? (
                      <ShieldX size={16} className="text-severity-critical" />
                    ) : (
                      <ShieldCheck size={16} className="text-severity-good" />
                    )
                  ) : chainalysis.status === "loading" ? (
                    <Loader2 size={16} className="text-bitcoin animate-spin" />
                  ) : chainalysis.status === "error" ? (
                    <ShieldAlert size={16} className="text-severity-high" />
                  ) : (
                    <ShieldAlert size={16} className="text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground/90">
                      {t("cex.chainalysisTitle", { defaultValue: "Chainalysis Screening" })}
                    </span>
                    {chainalysis.status === "done" && (
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          chainalysis.sanctioned
                            ? "bg-severity-critical/10 text-severity-critical"
                            : "bg-severity-good/10 text-severity-good"
                        }`}
                      >
                        {chainalysis.sanctioned ? t("cex.flagged", { defaultValue: "FLAGGED" }) : t("cex.clear", { defaultValue: "Clear" })}
                      </span>
                    )}
                  </div>

                  {chainalysis.status === "idle" && (
                    <div className="mt-1.5">
                      <button
                        onClick={runChainalysis}
                        className="inline-flex items-center gap-2 text-sm font-medium text-bitcoin hover:text-bitcoin-hover bg-bitcoin/10 hover:bg-bitcoin/20 rounded-lg px-3 py-2.5 transition-colors cursor-pointer"
                      >
                        <Search size={14} />
                        {t("cex.runChainalysis", { defaultValue: "Run Chainalysis Check" })}
                        {inputType === "txid" && addresses.length > 1 && (
                          <span className="text-muted text-xs">
                            ({t("cex.addressCount", { count: Math.min(addresses.length, 20), defaultValue: "{{count}} address", defaultValue_plural: "{{count}} addresses" })})
                          </span>
                        )}
                      </button>
                      <p className="text-xs text-severity-medium mt-1 flex items-center gap-1.5">
                        <AlertTriangle size={12} className="shrink-0" />
                        {inputType === "txid" && addresses.length > 1
                          ? t("cex.privacyWarningPlural", { defaultValue: "Sends addresses to chainalysis.com via proxy. The proxy operator also sees the addresses." })
                          : t("cex.privacyWarningSingular", { defaultValue: "Sends address to chainalysis.com via proxy. The proxy operator also sees the addresses." })}
                      </p>
                    </div>
                  )}

                  {chainalysis.status === "loading" && (
                    <p className="text-sm text-muted mt-1">
                      {t("cex.checking", { count: Math.min(addresses.length, 20), defaultValue: "Checking {{count}} address...", defaultValue_plural: "Checking {{count}} addresses..." })}
                    </p>
                  )}

                  {chainalysis.status === "done" && !chainalysis.sanctioned && (
                    <p className="text-sm text-muted mt-0.5">
                      {inputType === "txid"
                        ? t("cex.chainalysisClearTx", { defaultValue: "No sanctions identified. Exchanges are unlikely to flag this transaction." })
                        : t("cex.chainalysisClearAddr", { defaultValue: "No sanctions identified. Exchanges are unlikely to flag this address." })}
                    </p>
                  )}

                  {chainalysis.status === "done" && chainalysis.sanctioned && (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-severity-critical">
                        {t("cex.sanctionsIdentified", { defaultValue: "Sanctions identified. Exchanges will likely freeze funds." })}
                      </p>
                      {chainalysis.identifications.map((id, i) => (
                        <div
                          key={i}
                          className="bg-severity-critical/5 rounded px-2 py-1 text-xs"
                        >
                          <span className="text-severity-critical font-medium">
                            {id.category}
                          </span>
                          {id.name && (
                            <span className="text-foreground"> - {id.name}</span>
                          )}
                        </div>
                      ))}
                      <div className="space-y-0.5">
                        {chainalysis.matchedAddresses.map((addr) => (
                          <code
                            key={addr}
                            className="block text-xs font-mono text-severity-critical/80 break-all"
                          >
                            {addr}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}

                  {chainalysis.status === "error" && (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-severity-high">
                        {chainalysis.error || t("cex.requestFailed", { defaultValue: "Request failed" })}
                      </p>
                      <button
                        onClick={runChainalysis}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-bitcoin hover:text-bitcoin-hover bg-bitcoin/10 hover:bg-bitcoin/20 rounded-lg px-3 py-2 transition-colors cursor-pointer"
                      >
                        <RotateCw size={14} />
                        {t("cex.retry", { defaultValue: "Retry" })}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Disclaimer */}
              <p className="text-xs text-muted leading-relaxed border-t border-card-border pt-3">
                {t("cex.disclaimer", { defaultValue: "These checks cover sanctions screening only. Exchanges may flag addresses for other reasons (mixer usage, high-risk jurisdiction, etc.) that are not detectable with public tools." })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
