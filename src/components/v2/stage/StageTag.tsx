"use client";

import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { SEVERITY_DOT } from "@/lib/severity";
import type { IoTag } from "@/lib/view/tx-io";
import { useStage } from "./StageContext";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Short chip label for a view-model tag. Values come from the tag's own params. */
export function tagLabel(tag: IoTag, t: TFn): string {
  const p = tag.params ?? {};
  switch (tag.kind) {
    case "change": return t("v2.stage.tag.change", { defaultValue: "Change" });
    case "self-send": return t("v2.stage.tag.selfSend", { defaultValue: "Self-send" });
    case "dust": return t("v2.stage.tag.dust", { defaultValue: "Dust" });
    case "op-return": return p.protocol !== undefined ? `OP_RETURN · ${p.protocol}` : "OP_RETURN";
    case "entity": return p.entityName !== undefined ? String(p.entityName) : t("v2.stage.tag.entity", { defaultValue: "Known entity" });
    case "ofac": return p.entityName !== undefined
      ? t("v2.stage.tag.ofacNamed", { name: String(p.entityName), defaultValue: "OFAC · {{name}}" })
      : t("v2.stage.tag.ofac", { defaultValue: "OFAC sanctioned" });
    case "p2p-fee": return t("v2.stage.tag.p2pFee", { name: String(p.entityName ?? ""), defaultValue: "{{name}} fee" });
    case "anon-set": return t("v2.stage.tag.anonSet", { n: Number(p.anonSet), defaultValue: "1 of {{n}}" });
    case "co-spent": return t("v2.stage.tag.coSpent", { n: Number(p.count), defaultValue: "Spent with {{n}}" });
    case "same-parent": return t("v2.stage.tag.sameParent", { n: Number(p.count), defaultValue: "Same parent ×{{n}}" });
  }
}

/** The transaction a structural tag points at (co-spent child, shared parent), if any. */
export function tagTxid(tag: IoTag): string | null {
  const id = tag.kind === "co-spent" ? tag.params?.childTxid : tag.kind === "same-parent" ? tag.params?.parentTxid : undefined;
  return id !== undefined ? String(id) : null;
}

export const shortTxid = (txid: string) => `${txid.slice(0, 8)}…${txid.slice(-4)}`;

/** Explanation for tags that are structural facts (no finding behind them). */
function txFactText(tag: IoTag, t: TFn): string {
  const txid = tagTxid(tag);
  switch (tag.kind) {
    case "anon-set":
      return t("v2.stage.tag.anonSetFact", { n: Number(tag.params?.anonSet), defaultValue: "{{n}} outputs share this exact value" });
    case "co-spent":
      return t("v2.stage.tag.coSpentFact", { n: Number(tag.params?.count), txid: shortTxid(txid ?? ""), defaultValue: "{{n}} outputs of this transaction were later spent together in {{txid}}" });
    case "same-parent":
      return t("v2.stage.tag.sameParentFact", { n: Number(tag.params?.count), txid: shortTxid(txid ?? ""), defaultValue: "{{n}} inputs spend outputs of the same transaction {{txid}}" });
    default:
      return "";
  }
}

/**
 * A tag on an input/output. Finding-backed tags are buttons: hover/focus shows
 * the finding title, click opens that finding. Hidden until the Reveal lands
 * on its finding.
 */
export function StageTag({ tag }: { tag: IoTag }) {
  const { t } = useTranslation();
  const { findingTitle, onFindingClick, onTxClick, highlightFindingId, isRevealed, showTip, hideTip } = useStage();
  const txid = tagTxid(tag);
  const findingId = tag.source.kind === "finding" ? String(tag.source.findingId) : null;
  if (findingId && !isRevealed(findingId)) return null;

  const label = tagLabel(tag, t);
  const detail = findingId ? findingTitle(findingId) ?? "" : txFactText(tag, t);
  const hot = findingId !== null && findingId === highlightFindingId;
  const base = "relative inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-[11px] leading-none whitespace-nowrap transition-colors duration-150";
  const tone = hot
    ? "border-bitcoin/70 bg-bitcoin/10 text-foreground"
    : "border-hairline-strong bg-surface-2 text-muted";
  const dot = <span aria-hidden="true" className={`size-1.5 rounded-full shrink-0 ${SEVERITY_DOT[tag.severity]}`} />;
  const tip = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => detail && showTip(e.currentTarget, detail),
    onMouseLeave: hideTip,
    onFocus: (e: React.FocusEvent<HTMLElement>) => detail && showTip(e.currentTarget, detail),
    onBlur: hideTip,
  };

  const body = (
    <>
      {dot}
      <span className="max-w-[16ch] truncate">{label}</span>
    </>
  );

  return (
    <motion.span initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: "easeOut" }} className="inline-flex">
      {findingId ? (
        <button
          type="button"
          {...tip}
          onClick={() => onFindingClick?.(findingId)}
          aria-label={detail ? `${label}: ${detail}` : label}
          data-finding-id={findingId}
          // Invisible hit-area extension to reach 44px on touch without a larger chip.
          className={`${base} ${tone} cursor-pointer hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']`}
        >
          {body}
        </button>
      ) : txid && onTxClick ? (
        <button
          type="button"
          {...tip}
          onClick={(e) => { e.stopPropagation(); onTxClick(txid); }}
          aria-label={`${label}: ${detail}`}
          className={`${base} ${tone} cursor-pointer hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']`}
        >
          {body}
        </button>
      ) : (
        <span {...tip} tabIndex={0} role="note" aria-label={detail ? `${label}: ${detail}` : label} className={`${base} ${tone} focus-visible:outline-2 focus-visible:outline-bitcoin`}>
          {body}
        </span>
      )}
    </motion.span>
  );
}
