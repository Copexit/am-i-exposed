"use client";

import { useState, useRef, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GlowCard } from "../ui/GlowCard";
import { copyToClipboard } from "@/lib/clipboard";
import { TX_TYPE_LABELS, AddressTypeBadge } from "./constants";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

export function HeroInfoCard({
  query,
  inputType,
  result,
  txData,
}: {
  query: string;
  inputType: "txid" | "address";
  result: ScoringResult;
  txData: MempoolTransaction | null;
}) {
  const { t } = useTranslation();
  const [queryCopied, setQueryCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  return (
    <GlowCard className="w-full p-4 sm:p-5 space-y-4">
      <div className="space-y-1">
        <button
          onClick={() => {
            copyToClipboard(query);
            setQueryCopied(true);
            clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setQueryCopied(false), 2000);
          }}
          className="inline-flex items-start gap-2 font-mono text-sm text-foreground/90 break-all leading-relaxed text-left hover:text-foreground transition-colors cursor-pointer group/copy"
          title={t("common.copy", { defaultValue: "Copy" })}
          aria-label={t("common.copyToClipboard", { defaultValue: "Copy to clipboard" })}
        >
          <span className="break-all">{query}</span>
          {queryCopied ? (
            <Check size={14} className="shrink-0 mt-1 text-severity-good" />
          ) : (
            <Copy size={14} className="shrink-0 mt-1 text-muted opacity-0 group-hover/copy:opacity-100 transition-opacity" />
          )}
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {inputType === "txid" && result.txType && result.txType !== "simple-payment" && result.txType !== "unknown" && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded border border-card-border bg-surface-elevated text-muted">
              {TX_TYPE_LABELS[result.txType] ?? result.txType.replace(/-/g, " ")}
            </span>
          )}
          {inputType === "address" && <AddressTypeBadge address={query} />}
          {inputType === "txid" && txData?.status?.confirmed && txData.status.block_height != null && (
            <span className="text-xs text-muted flex items-center gap-2">
              <span>
                {t("results.blockHeight", {
                  height: txData.status.block_height.toLocaleString(),
                  defaultValue: "Block #{{height}}",
                })}
              </span>
              {txData.status.block_time != null && (
                <>
                  <span className="text-foreground/40">|</span>
                  <span>{new Date(txData.status.block_time * 1000).toLocaleString()}</span>
                </>
              )}
            </span>
          )}
          {inputType === "txid" && txData && !txData.status?.confirmed && (
            <span className="text-xs text-severity-medium">{t("results.unconfirmed", { defaultValue: "Unconfirmed (mempool)" })}</span>
          )}
        </div>
      </div>
    </GlowCard>
  );
}
