"use client";

import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from "lucide-react";
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

  const runChainalysis = useCallback(async () => {
    setChainalysis((prev) => ({ ...prev, status: "loading" }));
    try {
      const result = await checkChainalysis(addresses);
      setChainalysis({
        status: "done",
        sanctioned: result.sanctioned,
        identifications: result.identifications,
        matchedAddresses: result.matchedAddresses,
      });
    } catch (err) {
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
        className="w-full flex items-center gap-2 text-left cursor-pointer group px-1"
      >
        {hasSanction ? (
          <ShieldX size={14} className="text-severity-critical shrink-0" />
        ) : (
          <ShieldCheck size={14} className="text-muted/50 group-hover:text-muted shrink-0" />
        )}
        <span
          className={`text-xs font-medium uppercase tracking-wider ${
            hasSanction ? "text-severity-critical" : "text-muted/50 group-hover:text-muted"
          }`}
        >
          Exchange Risk Check
        </span>
        {hasSanction && (
          <span className="text-[10px] font-medium text-severity-critical bg-severity-critical/10 px-1.5 py-0.5 rounded">
            FLAGGED
          </span>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto text-muted/30 transition-transform duration-200 ${
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
              <p className="text-xs text-muted/60">
                Will exchanges flag this {inputType === "txid" ? "transaction" : "address"}?
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
                    <span className="text-sm font-medium text-foreground/80">
                      OFAC Sanctions List
                    </span>
                    <span
                      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        ofacResult.sanctioned
                          ? "bg-severity-critical/10 text-severity-critical"
                          : "bg-severity-good/10 text-severity-good"
                      }`}
                    >
                      {ofacResult.sanctioned ? "FLAGGED" : "Clear"}
                    </span>
                  </div>
                  {ofacResult.sanctioned ? (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-severity-critical">
                        {ofacResult.matchedAddresses.length} sanctioned address
                        {ofacResult.matchedAddresses.length > 1 ? "es" : ""} found.
                        Exchanges will likely freeze funds associated with{" "}
                        {ofacResult.matchedAddresses.length > 1
                          ? "these addresses"
                          : "this address"}
                        .
                      </p>
                      <div className="space-y-0.5">
                        {ofacResult.matchedAddresses.map((addr) => (
                          <code
                            key={addr}
                            className="block text-[11px] font-mono text-severity-critical/80 break-all"
                          >
                            {addr}
                          </code>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted/50 mt-0.5">
                      Checked against US Treasury SDN list. Client-side — no data sent.
                    </p>
                  )}
                  <p className="text-[10px] text-muted/30 mt-1">
                    Last updated: {ofacResult.lastUpdated}
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
                    <ShieldAlert size={16} className="text-muted/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground/80">
                      Chainalysis Screening
                    </span>
                    {chainalysis.status === "done" && (
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          chainalysis.sanctioned
                            ? "bg-severity-critical/10 text-severity-critical"
                            : "bg-severity-good/10 text-severity-good"
                        }`}
                      >
                        {chainalysis.sanctioned ? "FLAGGED" : "Clear"}
                      </span>
                    )}
                  </div>

                  {chainalysis.status === "idle" && (
                    <div className="mt-1.5">
                      <button
                        onClick={runChainalysis}
                        className="inline-flex items-center gap-1.5 text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                      >
                        Run Chainalysis Check
                        {inputType === "txid" && addresses.length > 1 && (
                          <span className="text-muted/50">
                            ({Math.min(addresses.length, 20)} address
                            {Math.min(addresses.length, 20) > 1 ? "es" : ""})
                          </span>
                        )}
                        <span className="text-muted/50">&rarr;</span>
                      </button>
                      <p className="text-[10px] text-severity-medium mt-1 flex items-center gap-1">
                        <AlertTriangle size={10} className="shrink-0" />
                        Sends {inputType === "txid" && addresses.length > 1 ? "addresses" : "address"} to
                        chainalysis.com via proxy
                      </p>
                    </div>
                  )}

                  {chainalysis.status === "loading" && (
                    <p className="text-xs text-muted/50 mt-1">
                      Checking {Math.min(addresses.length, 20)} address
                      {Math.min(addresses.length, 20) > 1 ? "es" : ""}...
                    </p>
                  )}

                  {chainalysis.status === "done" && !chainalysis.sanctioned && (
                    <p className="text-xs text-muted/50 mt-0.5">
                      No sanctions identified. Exchanges are unlikely to flag this
                      {inputType === "txid" ? " transaction" : " address"}.
                    </p>
                  )}

                  {chainalysis.status === "done" && chainalysis.sanctioned && (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-severity-critical">
                        Sanctions identified. Exchanges will likely freeze funds.
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
                            <span className="text-foreground/60"> — {id.name}</span>
                          )}
                        </div>
                      ))}
                      <div className="space-y-0.5">
                        {chainalysis.matchedAddresses.map((addr) => (
                          <code
                            key={addr}
                            className="block text-[11px] font-mono text-severity-critical/80 break-all"
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
                        {chainalysis.error || "Request failed"}
                      </p>
                      <button
                        onClick={runChainalysis}
                        className="text-xs text-bitcoin hover:text-bitcoin-hover cursor-pointer"
                      >
                        Retry &rarr;
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Disclaimer */}
              <p className="text-[10px] text-muted/30 leading-relaxed border-t border-card-border pt-3">
                These checks cover sanctions screening only. Exchanges may flag
                addresses for other reasons (mixer usage, high-risk jurisdiction, etc.)
                that are not detectable with public tools.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
