"use client";

import { useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { generateShareCard } from "@/lib/share-card";
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

  const handleGenerate = async () => {
    setGenerating(true);
    try {
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
    } finally {
      setGenerating(false);
    }
  };

  return (
    <button
      onClick={handleGenerate}
      disabled={generating}
      className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border border-card-border hover:border-muted/50 bg-surface-elevated/50 disabled:opacity-50 disabled:cursor-wait"
    >
      {generating ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
      {t("share.scoreCard", { defaultValue: "Score card" })}
    </button>
  );
}
