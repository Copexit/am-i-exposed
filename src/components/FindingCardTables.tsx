"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Copy, Check } from "lucide-react";
import { truncateId } from "@/lib/constants";
import { formatSats, fmtN } from "@/lib/format";
import { copyToClipboard } from "@/lib/clipboard";

// ─── Ricochet hop table ─────────────────────────────────────────────────

interface RicochetHop {
  hop: number;
  txid: string;
  blockHeight: number;
  value: number;
  outputCount: number;
}

export function RicochetHopTable({
  hopsJson,
  variant,
  hopCount,
  lang,
  onTxClick,
}: {
  hopsJson: string;
  variant: string;
  hopCount: number;
  lang: string;
  onTxClick?: (txid: string) => void;
}) {
  const { t } = useTranslation();
  let hops: RicochetHop[];
  try {
    hops = JSON.parse(hopsJson) as RicochetHop[];
  } catch {
    return null;
  }
  if (hops.length === 0) return null;

  const variantLabel = variant === "staggered"
    ? t("finding.ricochetVariant.staggered", { defaultValue: "Staggered" })
    : t("finding.ricochetVariant.classic", { defaultValue: "Classic (consecutive blocks)" });

  const lastHopIndex = hops.length - 1;

  return (
    <div className="rounded-md border border-severity-high/20 overflow-hidden">
      {/* Header with variant badge */}
      <div className="px-3 py-1.5 bg-severity-high/8 border-b border-severity-high/15 flex items-center gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-severity-high/30 bg-severity-high/10 text-severity-high font-medium">
          {variantLabel}
        </span>
        <span className="text-xs text-muted">
          {t("finding.ricochetHopCount", { count: hopCount || hops.length, defaultValue: "{{count}} hops" })}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[2rem_1fr_5rem_6rem] gap-x-2 px-3 py-1 border-b border-card-border text-[10px] uppercase tracking-wider text-muted">
        <span>{t("finding.ricochetCol.hop", { defaultValue: "Hop" })}</span>
        <span>{t("finding.ricochetCol.txid", { defaultValue: "Txid" })}</span>
        <span className="text-right">{t("finding.ricochetCol.block", { defaultValue: "Block" })}</span>
        <span className="text-right">{t("finding.ricochetCol.amount", { defaultValue: "Amount" })}</span>
      </div>

      {/* Hop rows */}
      <div className="divide-y divide-card-border overflow-y-auto" style={{ maxHeight: 240 }}>
        {hops.map((hop, idx) => (
          <div key={hop.txid} className="grid grid-cols-[2rem_1fr_5rem_6rem] gap-x-2 px-3 py-1.5 items-center text-xs">
            <span className="text-muted font-mono">{hop.hop}</span>
            <span className="flex items-center gap-1">
              {onTxClick ? (
                <button
                  onClick={() => onTxClick(hop.txid)}
                  className="font-mono text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                >
                  {truncateId(hop.txid, 4)}
                </button>
              ) : (
                <a
                  href={`/#tx=${hop.txid}`}
                  className="font-mono text-bitcoin hover:text-bitcoin-hover transition-colors"
                >
                  {truncateId(hop.txid, 4)}
                </a>
              )}
              {idx === lastHopIndex && (
                <span className="text-[10px] text-severity-high/80">
                  {t("finding.ricochetDest", { defaultValue: "-> dest" })}
                </span>
              )}
            </span>
            <span className="text-right text-muted font-mono">
              {fmtN(hop.blockHeight)}
            </span>
            <span className="text-right text-muted font-mono">
              {formatSats(hop.value, lang)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Consolidation detail table ─────────────────────────────────────────

interface ConsolidationGroup {
  childTxid: string;
  outputs: { index: number; value: number }[];
}

export function ConsolidationTable({
  groupsJson,
  lang,
  onTxClick,
}: {
  groupsJson: string;
  lang: string;
  onTxClick?: (txid: string) => void;
}) {
  const { t } = useTranslation();
  const [copiedTxid, setCopiedTxid] = useState<string | null>(null);
  let groups: ConsolidationGroup[];
  try {
    groups = JSON.parse(groupsJson) as ConsolidationGroup[];
  } catch {
    return null;
  }
  if (groups.length === 0) return null;

  const handleCopy = (txid: string) => {
    // copyToClipboard never rejects; it resolves false when copying failed
    void copyToClipboard(txid).then((ok) => {
      if (!ok) return;
      setCopiedTxid(txid);
      setTimeout(() => setCopiedTxid(null), 1500);
    });
  };

  return (
    <div className="rounded-md border border-severity-critical/20 overflow-hidden">
      <div className="px-3 py-1.5 bg-severity-critical/8 border-b border-severity-critical/15">
        <p className="text-xs font-semibold text-severity-critical">
          {t("finding.consolidationDetail", { defaultValue: "Re-linked outputs" })}
        </p>
      </div>
      <div className="divide-y divide-card-border overflow-y-auto" style={{ maxHeight: 320 }}>
        {groups.map((g) => (
          <div key={g.childTxid} className="px-3 py-2 space-y-1.5">
            {/* Child tx link */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted">
                {t("finding.spentIn", { defaultValue: "Spent together in" })}
              </span>
              {onTxClick ? (
                <button
                  onClick={() => onTxClick(g.childTxid)}
                  className="font-mono text-xs text-bitcoin hover:text-bitcoin-hover transition-colors cursor-pointer"
                >
                  {truncateId(g.childTxid, 8)}
                </button>
              ) : (
                <span className="font-mono text-xs text-foreground/70">{truncateId(g.childTxid, 8)}</span>
              )}
              <a
                href={`/#tx=${g.childTxid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted hover:text-foreground transition-colors"
                title={t("common.openInNewTab", { defaultValue: "Open in new tab" })}
              >
                <ExternalLink size={10} />
              </a>
              <button
                onClick={() => handleCopy(g.childTxid)}
                className="text-muted hover:text-foreground transition-colors cursor-pointer"
                title={t("common.copyTxid", { defaultValue: "Copy transaction ID" })}
              >
                {copiedTxid === g.childTxid ? <Check size={10} className="text-severity-good" /> : <Copy size={10} />}
              </button>
            </div>
            {/* Output list */}
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {g.outputs.map((o) => (
                <div key={o.index} className="contents">
                  <span className="font-mono text-severity-critical/80">#{o.index}</span>
                  <span className="text-muted">{formatSats(o.value, lang)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
