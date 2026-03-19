"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";

interface CopyButtonProps {
  /** The text to copy to the clipboard. */
  text: string;
  /** Visual variant:
   *  - "overlay" (default): absolutely positioned in top-right corner of a `relative` parent.
   *  - "inline": inline flow, minimal size, for use inside text rows. */
  variant?: "overlay" | "inline";
  /** Icon size in pixels. Defaults to 14 for overlay, 10 for inline. */
  iconSize?: number;
  /** Additional class names. */
  className?: string;
}

/**
 * Reusable copy-to-clipboard button with visual feedback.
 * Uses the copyToClipboard utility which has a fallback for HTTP environments.
 */
export function CopyButton({
  text,
  variant = "overlay",
  iconSize,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      copyToClipboard(text).then((ok) => {
        if (ok) {
          setCopied(true);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 2000);
        }
      });
    },
    [text],
  );

  const size = iconSize ?? (variant === "inline" ? 10 : 14);

  if (variant === "inline") {
    return (
      <button
        className={`text-muted/60 hover:text-foreground transition-colors cursor-pointer ${className ?? ""}`}
        onClick={handleCopy}
        title="Copy"
      >
        {copied ? <Check size={size} /> : <Copy size={size} />}
      </button>
    );
  }

  // overlay variant
  return (
    <button
      onClick={handleCopy}
      className={`absolute top-2 right-2 p-1.5 rounded bg-surface-inset/50 hover:bg-surface-inset text-muted hover:text-foreground transition-colors cursor-pointer ${className ?? ""}`}
      title="Copy to clipboard"
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}
