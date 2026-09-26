"use client";

import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Eye } from "lucide-react";
import { formatSats, formatUsdValue } from "@/lib/format";
import { probColor } from "@/components/viz/shared/linkabilityColors";
import type { MempoolTransaction } from "@/lib/api/types";
import type { StageRow as Row } from "./stage-layout";
import type { OutputReading } from "./analyst";
import { StageTag } from "./StageTag";
import { useStage } from "./StageContext";

export interface StageRowProps {
  row: Row;
  tx: MempoolTransaction;
  usdPrice?: number | null;
  stacked: boolean;
  active: boolean;
  dimmed: boolean;
  /** Link probability to the active row on the other side (linkability mode). */
  linkProb?: number | null;
  reading?: OutputReading | null;
  /** Highest real Boltzmann link probability to this output (analyst view, CoinJoins). */
  bestProb?: number | null;
  /** Share of its side's total value (stacked share bar). */
  share: number;
  /** CSS color of this row's flow. */
  tone: string;
  /** Band width where the ribbon meets the row (columns layout). */
  portWidth?: number;
  onActivate: (key: string | null) => void;
  onAddressClick?: (address: string) => void;
  onShowMore: (side: Row["side"]) => void;
}

const shortAddr = (a: string) => (a.length > 24 ? `${a.slice(0, 11)}…${a.slice(-8)}` : a);

function StageRowImpl(p: StageRowProps) {
  const { row, tx, usdPrice, stacked, active, dimmed, linkProb, reading, bestProb, share, tone, portWidth, onActivate, onAddressClick, onShowMore } = p;
  const { t, i18n } = useTranslation();
  const { onFindingClick, isRevealed } = useStage();
  const lang = i18n.language;
  const isInput = row.side === "input";
  // Columns layout: inputs hug the center, mirrored against the outputs.
  const mirror = !stacked && isInput;

  if (row.kind === "more") {
    return (
      <div data-port={row.key} className="relative">
        <button
          type="button"
          onClick={() => onShowMore(row.side)}
          className={`w-full min-h-11 rounded-lg border border-dashed border-hairline-strong px-3 py-2 ${mirror ? "text-right" : "text-left"} hover:bg-surface-2 hover:border-foreground/25 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin`}
        >
          <span className="block text-[13px] text-foreground">{t("v2.stage.more", { n: row.count, defaultValue: "+{{n}} more" })}</span>
          <span className="v2-num block text-[12px] text-faint">{formatSats(row.value, lang)}</span>
        </button>
      </div>
    );
  }

  const io = row.kind === "io" ? row.io : null;
  const vin = io && isInput ? tx.vin[io.index] : undefined;
  const opReturn = io?.tags.find((tg) => tg.kind === "op-return");
  const isOpReturn = io?.scriptType === "op_return";
  const members = row.kind === "tier" ? row.members : [];
  const spentKnown = row.kind === "tier" ? members.every((m) => m.spent !== null) : io?.spent !== null && io?.spent !== undefined;
  const spentCount = row.kind === "tier" ? members.filter((m) => m.spent).length : io?.spent ? 1 : 0;
  const decoded = opReturn?.params?.decoded !== undefined && opReturn.source.kind === "finding" && isRevealed(opReturn.source.findingId)
    ? String(opReturn.params.decoded) : null;
  const readingShown = reading && isRevealed(reading.findingId) ? reading : null;

  return (
    <div
      data-port={row.key}
      onMouseEnter={() => onActivate(row.key)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(row.key)}
      onBlur={() => onActivate(null)}
      onClick={() => onActivate(active ? null : row.key)}
      className={`relative rounded-lg px-3 py-2 min-h-[52px] transition-[background-color,opacity] duration-150 ${active ? "bg-surface-2 ring-1 ring-hairline-strong" : ""} ${dimmed ? "opacity-45" : ""} ${mirror ? "text-right" : ""}`}
    >
      {!stacked && portWidth !== undefined && (
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -translate-y-1/2 w-[3px] rounded-full ${isInput ? "-right-px" : "-left-px"}`}
          style={{ height: Math.max(2, portWidth), background: tone }}
        />
      )}

      <div className={`flex items-baseline gap-2 min-w-0 ${mirror ? "flex-row-reverse" : ""}`}>
        <span className="v2-num text-[14px] text-foreground whitespace-nowrap">
          {row.kind === "tier"
            ? t("v2.stage.tierValue", { n: members.length, value: formatSats(row.unit, lang), defaultValue: "{{n}} × {{value}}" })
            : formatSats(row.value, lang)}
        </span>
        {usdPrice != null && row.value > 0 && (
          <span className="v2-num text-[12px] text-faint whitespace-nowrap">{formatUsdValue(row.value, usdPrice)}</span>
        )}
        <span className={`${mirror ? "mr-auto" : "ml-auto"} flex items-center gap-2 shrink-0`}>
          {linkProb != null && (
            <span className="v2-num text-[11px] px-1.5 h-5 inline-flex items-center rounded border border-hairline-strong" style={{ color: probColor(Math.max(linkProb, 0.4)) }}>
              {t("v2.stage.linkPct", { pct: Math.round(linkProb * 100), defaultValue: "{{pct}}%" })}
            </span>
          )}
          {!isInput && spentKnown && (
            <span className="inline-flex items-center gap-1 text-[11px] text-faint whitespace-nowrap">
              <span aria-hidden="true" className={`size-1.5 rounded-full ${spentCount === 0 ? "bg-severity-good" : "bg-faint"}`} />
              {row.kind === "tier"
                ? t("v2.stage.tierSpent", { spent: spentCount, n: members.length, defaultValue: "{{spent}}/{{n}} spent" })
                : spentCount ? t("v2.stage.spent", { defaultValue: "spent" }) : t("v2.stage.unspent", { defaultValue: "unspent" })}
            </span>
          )}
        </span>
      </div>

      <div className={`mt-0.5 flex items-center gap-2 min-w-0 text-[12px] ${mirror ? "flex-row-reverse" : ""}`}>
        {row.kind === "tier" ? (
          <span className="v2-num text-faint">{t("v2.stage.tierTotal", { total: formatSats(row.value, lang), defaultValue: "{{total}} total" })}</span>
        ) : vin?.is_coinbase ? (
          <span className="text-muted">{t("v2.stage.coinbase", { defaultValue: "Coinbase (newly minted)" })}</span>
        ) : isOpReturn ? (
          decoded !== null
            ? <span className="text-foreground/85 break-words">“{decoded}”</span>
            : !opReturn && <span className="v2-num text-muted">OP_RETURN</span>
        ) : io?.address && onAddressClick ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddressClick(io.address!); }}
            title={io.address}
            aria-label={t("v2.stage.scanAddress", { address: io.address, defaultValue: "Scan address {{address}}" })}
            className="v2-num text-muted hover:text-bitcoin underline-offset-2 hover:underline truncate cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-bitcoin py-1 -my-1"
          >
            {shortAddr(io.address)}
          </button>
        ) : (
          <span className="v2-num text-muted truncate" title={io?.address ?? undefined}>{io?.address ? shortAddr(io.address) : io?.scriptType}</span>
        )}
        {io && !isOpReturn && !vin?.is_coinbase && <span className="text-faint shrink-0">{io.scriptType.replace(/^v\d_/, "")}</span>}
      </div>

      {row.tags.length > 0 && (
        <div className={`mt-1.5 flex flex-wrap gap-1.5 ${mirror ? "justify-end" : ""}`}>
          {row.tags.map((tag, i) => <StageTag key={`${tag.kind}-${i}`} tag={tag} />)}
        </div>
      )}

      {readingShown && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onFindingClick?.(readingShown.findingId); }}
          className="mt-1.5 flex items-start gap-1.5 text-left text-[12px] leading-snug text-foreground/90 border-l-2 border-bitcoin/60 pl-2 cursor-pointer hover:text-foreground focus-visible:outline-2 focus-visible:outline-bitcoin rounded-sm"
        >
          <Eye size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-bitcoin" />
          <span><ReadingText reading={readingShown} bestProb={bestProb} /></span>
        </button>
      )}

      {stacked && (
        <span aria-hidden="true" className="absolute left-3 right-3 bottom-0 h-[2px] rounded-full bg-hairline overflow-hidden">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(1.5, share * 100)}%`, background: tone }} />
        </span>
      )}
    </div>
  );
}

function ReadingText({ reading, bestProb }: { reading: OutputReading; bestProb?: number | null }) {
  const { t } = useTranslation();
  switch (reading.kind) {
    case "payment":
      return <>{reading.entityName
        ? t("v2.stage.analyst.paymentTo", { name: reading.entityName, defaultValue: "Likely payment to {{name}}" })
        : t("v2.stage.analyst.payment", { defaultValue: "Likely payment to the recipient" })}</>;
    case "change": {
      const head = reading.confidence === "deterministic"
        ? t("v2.stage.analyst.changeCertain", { defaultValue: "Change back to the sender (certain)" })
        : reading.confidence === "high"
          ? t("v2.stage.analyst.changeLikely", { defaultValue: "Likely change back to the sender" })
          : reading.confidence === "medium"
            ? t("v2.stage.analyst.changePossible", { defaultValue: "Possibly change back to the sender" })
            : t("v2.stage.analyst.changeHint", { defaultValue: "Weak hint: change back to the sender" });
      return <>
        {head}
        {reading.agreement !== null && (
          <span className="v2-num text-muted">{" · "}{t("v2.stage.analyst.changeAgree", { pct: reading.agreement, defaultValue: "{{pct}}% of signals agree" })}</span>
        )}
      </>;
    }
    case "self-send":
      return <>{t("v2.stage.analyst.selfSend", { defaultValue: "Back to the sender's own address" })}</>;
    case "blinded":
      return <>
        {t("v2.stage.analyst.blinded", { n: reading.anonSet, defaultValue: "Blinded: 1 of {{n}} equal outputs" })}
        {bestProb != null && (
          <span className="v2-num text-muted">{" · "}{t("v2.stage.analyst.bestLink", { pct: Math.round(bestProb * 100), defaultValue: "best link {{pct}}%" })}</span>
        )}
      </>;
  }
}

export const StageRow = memo(StageRowImpl);
