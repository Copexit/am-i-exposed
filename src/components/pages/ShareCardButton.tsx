"use client";

import { useState, useRef, useEffect } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Grade } from "@/lib/types";

interface ShareCardButtonProps {
  grade: Grade;
  score: number;
  query: string;
  inputType: "txid" | "address";
  /** Transaction type label from the view model, if any. */
  txType?: string | null;
  /** Title of the most negative-impact finding, if any. */
  topLeak?: string | null;
  className?: string;
}

/** Share card: calm evidence-tag image (grade, score, type, top leak), shared or downloaded. */
export function ShareCardButton({ grade, score, query, inputType, txType, topLeak, className }: ShareCardButtonProps) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleGenerate = async () => {
    setGenerating(true);
    setFailed(false);
    try {
      const { generateShareCard, sharePng } = await import("@/lib/share-card");
      const blob = await generateShareCard({
        grade,
        score,
        query,
        inputType,
        txType,
        topLeak,
        labels: {
          privacyScore: t("pages.shareCard.privacyScore", { defaultValue: "PRIVACY SCORE" }),
          topLeak: t("pages.shareCard.topLeak", { defaultValue: "TOP LEAK" }),
          scannedClientSide: t("pages.shareCard.scannedClientSide", { defaultValue: "SCANNED CLIENT-SIDE" }),
          tx: t("pages.shareCard.tx", { defaultValue: "TX" }),
          address: t("pages.shareCard.address", { defaultValue: "ADDRESS" }),
        },
      });
      await sharePng(blob, `am-i-exposed-${grade.replace("+", "plus")}-${score}.png`);
    } catch (err) {
      // Dismissing the share sheet is not an error
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFailed(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFailed(false), 2000);
    } finally {
      setGenerating(false);
    }
  };

  const label = t("pages.shareCard.button", { defaultValue: "Share card" });
  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={generating}
      aria-label={label}
      aria-busy={generating}
      className={`inline-flex items-center gap-2 min-h-11 sm:min-h-9 px-3 rounded-lg border border-hairline text-[13px] text-muted hover:text-foreground hover:border-hairline-strong transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin ${className ?? ""}`}
    >
      {generating ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} className={failed ? "text-severity-critical" : undefined} />}
      <span>{failed ? t("pages.shareCard.failed", { defaultValue: "Card failed" }) : label}</span>
    </button>
  );
}
