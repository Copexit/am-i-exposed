"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Wrench, X } from "lucide-react";

const DISMISS_KEY = "ami-crosspromo-dismissed";

function isDismissedInSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {}
}

export function CrossPromo() {
  const [dismissed, setDismissed] = useState(isDismissedInSession);

  if (dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.8 }}
      className="w-full relative"
    >
      <a
        href="https://txfix.click"
        target="_blank"
        rel="noopener noreferrer"
        className="group block w-full rounded-lg border border-dashed border-card-border/60 px-4 py-3 transition-all duration-200 hover:border-bitcoin/30 hover:bg-bitcoin/[0.02]"
      >
        <p className="flex items-center gap-2 text-sm text-muted/90 group-hover:text-muted transition-colors duration-200">
          <Wrench size={14} className="shrink-0 text-muted/90 group-hover:text-bitcoin/60 transition-colors duration-200" />
          Transaction stuck or slow? Unstick it in 3 clicks.
        </p>
        <p className="mt-0.5 ml-[22px] text-[11px] text-muted/90 group-hover:text-muted/90 transition-colors duration-200">
          txfix.click - free, open-source transaction rescue
        </p>
      </a>

      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          persistDismiss();
          setDismissed(true);
        }}
        className="absolute top-2.5 right-2.5 text-muted hover:text-foreground transition-colors cursor-pointer p-0.5"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}
