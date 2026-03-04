"use client";

import { useState, useRef, useEffect } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACTION_BTN_CLASS } from "@/lib/constants";
import type { Grade } from "@/lib/types";

interface ShareCardButtonProps {
  grade: Grade;
  score: number;
  query: string;
  inputType: "txid" | "address";
  findingCount: number;
}

export function ShareCardButton({
  grade,
  score,
  query,
  inputType,
  findingCount,
}: ShareCardButtonProps) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleGenerate = async () => {
    setGenerating(true);
    setFailed(false);
    try {
      const { generateShareCard } = await import("@/lib/share-card");
      const blob = await generateShareCard({
        grade,
        score,
        query,
        inputType,
        findingCount,
        labels: {
          privacyGrade: t("shareCard.privacyGrade", { defaultValue: "PRIVACY GRADE" }),
          findingsAnalyzed: t("shareCard.findingsAnalyzed", { defaultValue: "findings analyzed" }),
          footerLeft: t("shareCard.footerLeft", { defaultValue: "am-i.exposed - Bitcoin Privacy Scanner" }),
          footerRight: t("shareCard.footerRight", { defaultValue: "Scan any address or txid at am-i.exposed" }),
        },
      });

      // Try Web Share API with file first (mobile)
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], "privacy-score.png", {
          type: "image/png",
        });
        const shareData = { files: [file] };
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData);
          return;
        }
      }

      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `privacy-score-${grade.replace("+", "plus")}-${score}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      // User cancellation of share sheet is not an error
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFailed(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFailed(false), 2000);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={generating}
      aria-label={t("share.scoreCard", { defaultValue: "Score card" })}
      className={`${ACTION_BTN_CLASS} disabled:opacity-50 disabled:cursor-wait`}
    >
      {generating ? <Loader2 size={14} className="animate-spin" /> : failed ? <ImageIcon size={14} className="text-severity-critical" /> : <ImageIcon size={14} />}
      <span className="hidden sm:inline">{t("share.scoreCard", { defaultValue: "Score card" })}</span>
    </button>
  );
}
