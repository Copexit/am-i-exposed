"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  AlertTriangle,
  Search,
  RotateCw,
} from "lucide-react";
import { Spinner } from "./ui/Spinner";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { checkOfac } from "@/lib/analysis/cex-risk/ofac-check";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import { getEntity } from "@/lib/analysis/entities";
import {
  checkChainalysis,
  checkChainalysisViaTor,
  checkChainalysisDirect,
  type ChainalysisRoute,
} from "@/lib/analysis/cex-risk/chainalysis-check";
import { extractTxAddresses } from "@/lib/analysis/cex-risk/extract-addresses";
import type { ChainalysisCheckResult } from "@/lib/analysis/cex-risk/types";
import type { InputType } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";

interface CexRiskPanelProps {
  query: string;
  inputType: InputType;
  txData: MempoolTransaction | null;
  isCoinJoin?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  exchange: "Exchange",
  darknet: "Darknet Market",
  scam: "Scam",
  gambling: "Gambling",
  payment: "Payment Processor",
  mining: "Mining Pool",
  mixer: "Mixer",
  p2p: "P2P Platform",
};

interface OfacEntityMatch {
  address: string;
  entityName: string | null;
  category: string | null;
  country: string | null;
  status: string | null;
}

export function CexRiskPanel({ query, inputType, txData, isCoinJoin }: CexRiskPanelProps) {
  const { t } = useTranslation();
  const { isUmbrel } = useNetwork();
  const [open, setOpen] = useState(true);

  // Derive addresses to check
  const addresses = useMemo(() => {
    if (inputType === "address") return [query];
    if (inputType === "txid" && txData) return extractTxAddresses(txData);
    return [];
  }, [query, inputType, txData]);

  // OFAC: keep checkOfac only for lastUpdated date
  const ofacLastUpdated = useMemo(() => checkOfac([]).lastUpdated, []);

  // Use matchEntitySync for comprehensive OFAC check (SDN + entity-level flags)
  const ofacMatches = useMemo(() => {
    const matches: OfacEntityMatch[] = [];
    const seen = new Set<string>();
    for (const addr of addresses) {
      const match = matchEntitySync(addr);
      if (match?.ofac) {
        // Deduplicate by address
        if (seen.has(addr)) continue;
        seen.add(addr);
        const entity = match.entityName ? getEntity(match.entityName) : null;
        matches.push({
          address: addr,
          entityName: match.entityName !== "OFAC Sanctioned" ? match.entityName : null,
          category: entity?.category ?? match.category ?? null,
          country: entity?.country ?? null,
          status: entity?.status ?? null,
        });
      }
    }
    return matches;
  }, [addresses]);

  const ofacSanctioned = ofacMatches.length > 0;

  // Chainalysis is opt-in (routed through Cloudflare Worker proxy)
  const [chainalysis, setChainalysis] = useState<ChainalysisCheckResult>({
    status: "idle",
    sanctioned: false,
    identifications: [],
    matchedAddresses: [],
  });

  const [showFallbackConfirm, setShowFallbackConfirm] = useState(false);
  const [routeUsed, setRouteUsed] = useState<ChainalysisRoute | null>(null);

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
    setRouteUsed(null);
    setShowFallbackConfirm(false);

    try {
      if (isUmbrel) {
        // Umbrel mode: try Tor proxy first
        try {
          const result = await checkChainalysisViaTor(
            addresses,
            controller.signal,
          );
          setRouteUsed(result.route);
          setChainalysis({
            status: "done",
            sanctioned: result.sanctioned,
            identifications: result.identifications,
            matchedAddresses: result.matchedAddresses,
          });
          return;
        } catch (torErr) {
          if (
            torErr instanceof DOMException &&
            torErr.name === "AbortError"
          )
            return;
          // Tor proxy failed on Umbrel - show sidecar-specific error
          // (direct fallback would fail due to CORS on local origins)
          setChainalysis((prev) => ({
            ...prev,
            status: "error",
            error: t("cex.errorUmbrelSidecar", {
              defaultValue: "Tor proxy sidecar unavailable. Ensure the sidecar container is running, or restart the am-i.exposed app from your Umbrel dashboard.",
            }),
          }));
          return;
        }
      }

      // Non-Umbrel: direct check (original behavior)
      const result = await checkChainalysis(addresses, controller.signal);
      setRouteUsed("direct");
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
        error: t("cex.requestFailed", { defaultValue: "Request failed. Check your internet connection and try again." }),
      }));
    }
  }, [addresses, isUmbrel, t]);

  const runChainalysisDirect = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setChainalysis((prev) => ({ ...prev, status: "loading" }));
    setShowFallbackConfirm(false);

    try {
      const result = await checkChainalysisDirect(
        addresses,
        controller.signal,
      );
      setRouteUsed(result.route);
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
        error: t("cex.errorDirectFallback", { defaultValue: "Both Tor and direct connections failed. Try restarting the app or check your internet connection." }),
      }));
    }
  }, [addresses, t]);

  if (addresses.length === 0) return null;

  const hasSanction = ofacSanctioned || chainalysis.sanctioned;

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="cex-risk-panel"
        className="w-full flex items-center gap-2 text-left cursor-pointer group px-1 py-3 min-h-[44px]"
      >
        {hasSanction ? (
          <ShieldX size={14} className="text-severity-critical shrink-0" />
        ) : (
          <ShieldCheck size={14} className="text-foreground/70 group-hover:text-foreground shrink-0" />
        )}
        <span
          className={`text-xs font-medium uppercase tracking-wider ${
            hasSanction ? "text-severity-critical" : "text-foreground/70 group-hover:text-foreground"
          }`}
        >
          {t("cex.exchangeRiskCheck", { defaultValue: "Exchange Risk Check" })}
        </span>
        {hasSanction && (
          <span className="text-xs font-medium text-severity-critical bg-severity-critical/15 px-1.5 py-0.5 rounded">
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
            <div id="cex-risk-panel" className="mt-3 glass rounded-xl p-5 space-y-4">
              <p className="text-sm text-muted">
                {inputType === "txid"
                  ? t("cex.willFlagTx", { defaultValue: "Will exchanges flag this transaction?" })
                  : t("cex.willFlagAddr", { defaultValue: "Will exchanges flag this address?" })}
              </p>

              {/* OFAC row */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {ofacSanctioned ? (
                    <ShieldX size={16} className="text-severity-critical" />
                  ) : (
                    <ShieldCheck size={16} className="text-severity-good" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {t("cex.ofacTitle", { defaultValue: "OFAC Sanctions List" })}
                    </span>
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        ofacSanctioned
                          ? "bg-severity-critical/15 text-severity-critical"
                          : "bg-severity-good/15 text-severity-good"
                      }`}
                    >
                      {ofacSanctioned ? t("cex.flagged", { defaultValue: "FLAGGED" }) : t("cex.clear", { defaultValue: "Clear" })}
                    </span>
                  </div>
                  {ofacSanctioned ? (
                    <div className="mt-1 space-y-2">
                      <p className="text-xs text-severity-critical">
                        {ofacMatches.length > 1
                          ? t("cex.ofacFlaggedPlural", { count: ofacMatches.length, defaultValue: "{{count}} sanctioned addresses found. Exchanges will likely freeze funds associated with these addresses." })
                          : t("cex.ofacFlaggedSingular", { defaultValue: "1 sanctioned address found. Exchanges will likely freeze funds associated with this address." })}
                      </p>
                      <div className="space-y-1.5">
                        {ofacMatches.map((m) => (
                          <div
                            key={m.address}
                            className="bg-severity-critical/10 rounded-lg px-3 py-2 space-y-1"
                          >
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {m.entityName && (
                                <span className="text-xs font-medium text-severity-critical">
                                  {m.entityName}
                                </span>
                              )}
                              {m.category && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-severity-critical/15 text-severity-critical">
                                  {CATEGORY_LABELS[m.category] ?? m.category}
                                </span>
                              )}
                              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-severity-critical/20 text-severity-critical font-semibold">
                                OFAC
                              </span>
                              {m.status === "closed" && (
                                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60">
                                  Closed
                                </span>
                              )}
                              {m.country && m.country !== "Unknown" && (
                                <span className="text-[10px] text-muted">{m.country}</span>
                              )}
                            </div>
                            <code className="block text-xs font-mono text-severity-critical/90 break-all">
                              {m.address}
                            </code>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted mt-0.5">
                      {t("cex.ofacClear", { defaultValue: "Checked against US Treasury SDN list. Client-side - no data sent." })}
                    </p>
                  )}
                  <p className="text-xs text-muted mt-1">
                    {t("cex.lastUpdated", { date: ofacLastUpdated, defaultValue: "Last updated: {{date}}" })}
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
                    <Spinner size="sm" />
                  ) : chainalysis.status === "error" ? (
                    <ShieldAlert size={16} className="text-severity-high" />
                  ) : (
                    <ShieldAlert size={16} className="text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {t("cex.chainalysisTitle", { defaultValue: "Chainalysis Screening" })}
                    </span>
                    {chainalysis.status === "done" && (
                      <>
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            chainalysis.sanctioned
                              ? "bg-severity-critical/15 text-severity-critical"
                              : "bg-severity-good/10 text-severity-good"
                          }`}
                        >
                          {chainalysis.sanctioned ? t("cex.flagged", { defaultValue: "FLAGGED" }) : t("cex.clear", { defaultValue: "Clear" })}
                        </span>
                        {routeUsed && (
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              routeUsed === "tor-proxy"
                                ? "bg-severity-good/10 text-severity-good"
                                : "bg-severity-medium/10 text-severity-medium"
                            }`}
                          >
                            {routeUsed === "tor-proxy"
                              ? t("cex.routedViaTor", { defaultValue: "via Tor" })
                              : t("cex.routedDirect", { defaultValue: "direct" })}
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  {chainalysis.status === "idle" && !showFallbackConfirm && (
                    <div className="mt-1.5">
                      <button
                        onClick={runChainalysis}
                        className="inline-flex items-center gap-2 text-sm font-medium text-bitcoin hover:text-bitcoin-hover bg-bitcoin/10 hover:bg-bitcoin/20 rounded-lg px-3 py-2.5 transition-colors cursor-pointer"
                      >
                        <Search size={14} />
                        {t("cex.runChainalysis", { defaultValue: "Run Chainalysis Check" })}
                        {inputType === "txid" && addresses.length > 1 && (
                          <span className="text-muted text-xs">
                            ({t("cex.addressCount", { count: Math.min(addresses.length, 20), defaultValue: "{{count}} address", defaultValue_other: "{{count}} addresses" })})
                          </span>
                        )}
                      </button>
                      <p className="text-xs text-severity-medium mt-1 flex items-center gap-1.5">
                        <AlertTriangle size={12} className="shrink-0" />
                        {isUmbrel
                          ? t("cex.privacyNoteTor", { defaultValue: "Routed through Tor to protect your IP. Chainalysis sees the address but not your identity." })
                          : inputType === "txid" && addresses.length > 1
                            ? t("cex.privacyWarningPlural", { defaultValue: "Sends addresses to chainalysis.com via proxy. The proxy operator also sees the addresses." })
                            : t("cex.privacyWarningSingular", { defaultValue: "Sends address to chainalysis.com via proxy. The proxy operator also sees the addresses." })}
                      </p>
                    </div>
                  )}

                  {showFallbackConfirm && (
                    <div className="mt-1.5 bg-severity-medium/5 border border-severity-medium/20 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-severity-medium flex items-center gap-1.5">
                        <AlertTriangle size={12} className="shrink-0" />
                        {t("cex.torFailed", {
                          defaultValue: "Tor proxy is unavailable. Proceeding will send the request directly - Chainalysis and the proxy operator will see your IP address.",
                        })}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={runChainalysisDirect}
                          className="text-xs font-medium text-severity-medium hover:text-severity-medium/80 bg-severity-medium/10 hover:bg-severity-medium/20 rounded-lg px-3 py-2 transition-colors cursor-pointer"
                        >
                          {t("cex.proceedDirect", { defaultValue: "Proceed without Tor" })}
                        </button>
                        <button
                          onClick={() => setShowFallbackConfirm(false)}
                          className="text-xs font-medium text-muted hover:text-foreground/80 bg-surface-inset hover:bg-surface-inset/80 rounded-lg px-3 py-2 transition-colors cursor-pointer"
                        >
                          {t("cex.cancel", { defaultValue: "Cancel" })}
                        </button>
                      </div>
                    </div>
                  )}

                  {chainalysis.status === "loading" && (
                    <p className="text-sm text-muted mt-1">
                      {t("cex.checking", { count: Math.min(addresses.length, 20), defaultValue: "Checking {{count}} address...", defaultValue_other: "Checking {{count}} addresses..." })}
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
                        {chainalysis.error || t("cex.requestFailed", { defaultValue: "Request failed. Check your internet connection and try again." })}
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
                {isCoinJoin
                  ? t("cex.disclaimerCoinJoin", { defaultValue: "This transaction was identified as a CoinJoin. Multiple centralized exchanges are documented to flag, freeze, or close accounts for CoinJoin-associated deposits - even months or years after the transaction. These checks cover sanctions screening only and cannot predict exchange compliance decisions." })
                  : t("cex.disclaimer", { defaultValue: "These checks cover sanctions screening only. Exchanges may flag addresses for other reasons (mixer usage, high-risk jurisdiction, etc.) that are not detectable with public tools." })}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
