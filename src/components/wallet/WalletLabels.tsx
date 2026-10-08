"use client";

import { createContext, useContext, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LabelTag, WalletLabels } from "@/lib/wallet/labels";

/** Wallet labels matched to the scanned wallet, or null when none are loaded. */
export const WalletLabelsContext = createContext<WalletLabels | null>(null);
export const useWalletLabels = () => useContext(WalletLabelsContext);

const TAG_TONE: Record<LabelTag, string> = {
  kyc: "text-severity-high border-severity-high/30",
  nokyc: "text-severity-low border-severity-low/30",
  cj: "text-severity-good border-severity-good/30",
  change: "text-muted border-hairline-strong",
  toxic: "text-severity-critical border-severity-critical/30",
  person: "text-severity-medium border-severity-medium/30",
};

const TAG_DEFAULT: Record<LabelTag, string> = {
  kyc: "KYC", nokyc: "no-KYC", cj: "CoinJoin", change: "Change", toxic: "Toxic", person: "Person",
};

/** Width of the tag explanation popup (w-64). */
const TIP_W = 256;

/**
 * Origin class from a label prefix. Dashed when inherited from the coins that funded it.
 * With `tip` (default) the chip is a button that shows its meaning on hover, focus or tap,
 * with a link to the labeling guide (a toggletip: the link inside stays reachable).
 */
export function LabelTagChip({ tag, inherited = false, tip = true }: { tag: LabelTag; inherited?: boolean; tip?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const cls = `text-[11px] leading-none whitespace-nowrap border rounded px-1.5 py-1 font-medium ${inherited ? "border-dashed" : ""} ${TAG_TONE[tag]}`;
  const name = t(`wallet.labels.tag.${tag}`, { defaultValue: TAG_DEFAULT[tag] });
  if (!tip) return <span data-testid={`label-tag-${tag}`} className={cls}>{name}</span>;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    // Keep the popup inside the viewport (no horizontal page scroll).
    if (r) setShift(Math.min(0, document.documentElement.clientWidth - 16 - (r.left + TIP_W)));
    setOpen(true);
  };
  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={() => setOpen(false)}
      onFocus={show}
      onBlur={e => { if (!ref.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}
      onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
    >
      <button
        type="button"
        data-testid={`label-tag-${tag}`}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={show}
        className={`${cls} cursor-help focus-visible:outline focus-visible:outline-2 focus-visible:outline-bitcoin/60`}
      >
        {name}
      </button>
      {open && (
        <span id={tipId} data-testid="label-tag-tip" style={{ left: shift }} className="absolute top-full left-0 z-30 pt-1.5 w-64 max-w-[calc(100vw-2rem)]">
          <span className="block rounded-md border border-card-border bg-surface-elevated shadow-lg px-3 py-2.5 text-[12px] leading-relaxed text-foreground whitespace-normal font-normal space-y-1.5">
            <span className="block">{t(`guide.labeling.prefix.${tag}`)}</span>
            {inherited && <span className="block text-muted">{t("wallet.labels.inheritedTip", { defaultValue: "Inherited from the coins it came from." })}</span>}
            <a href="/guide/#labeling-coins" className="inline-block text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline">
              {t("wallet.labels.howTo", { defaultValue: "Labeling recommendations" })}
            </a>
          </span>
        </span>
      )}
    </span>
  );
}

/** A label's text, one line, truncated with the full text on hover. */
export function LabelText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span data-testid="label-text" title={text} className={`text-[12px] leading-5 text-foreground/80 truncate min-w-0 ${className}`}>
      {text}
    </span>
  );
}
