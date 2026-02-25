"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";
import type { Grade } from "@/lib/types";

interface ShareButtonsProps {
  grade: Grade;
  score: number;
  query: string;
  inputType: "txid" | "address";
  findingCount: number;
}

/** Always use the canonical production URL for social sharing - never localhost or custom API hosts. */
function getShareUrl(query: string, inputType: "txid" | "address"): string {
  const prefix = inputType === "txid" ? "tx" : "addr";
  return `https://am-i.exposed/#${prefix}=${encodeURIComponent(query)}`;
}

function getShareText(
  grade: Grade,
  score: number,
  findingCount: number,
  t: (key: string, opts: { defaultValue: string; grade?: string; score?: number; count?: number }) => string,
): string {
  if (score <= 30) {
    return t("share.textBad", {
      defaultValue: "Privacy score: {{grade}} ({{score}}/100) - {{count}} issues found. Address reuse, no coin control, zero privacy hygiene. This is what chain analysis firms love to see.",
      grade, score, count: findingCount,
    });
  } else if (score <= 60) {
    return t("share.textMedium", {
      defaultValue: "Privacy score: {{grade}} ({{score}}/100) - {{count}} issues. Some effort, but chain analysis can still connect the dots. Bitcoin privacy is hard.",
      grade, score, count: findingCount,
    });
  } else {
    return t("share.textGood", {
      defaultValue: "Privacy score: {{grade}} ({{score}}/100) - solid privacy practices. This is how it should be done. {{count}} heuristics checked.",
      grade, score, count: findingCount,
    });
  }
}

const btnClass =
  "inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors cursor-pointer px-3 py-2 min-h-[44px] rounded-lg border border-card-border hover:border-muted/50 bg-surface-elevated/50";

export function ShareButtons({
  grade,
  score,
  query,
  inputType,
  findingCount,
}: ShareButtonsProps) {
  const { t } = useTranslation();
  const [linkCopied, setLinkCopied] = useState(false);

  const shareUrl = getShareUrl(query, inputType);
  const shareText = getShareText(grade, score, findingCount, t);

  const handleTwitterShare = () => {
    const fullText = `${shareText}\n\n${shareUrl}`;
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(fullText)}`;
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=400");
  };

  const handleCopyLink = async () => {
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  return (
    <>
      <button onClick={handleTwitterShare} className={btnClass}>
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 fill-current"
          aria-hidden="true"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        {t("share.twitter", { defaultValue: "Share" })}
      </button>

      <button onClick={handleCopyLink} className={btnClass}>
        {linkCopied ? <Check size={14} /> : <Copy size={14} />}
        {linkCopied
          ? t("share.copied", { defaultValue: "Copied" })
          : t("share.copyLink", { defaultValue: "Copy link" })}
      </button>
    </>
  );
}
