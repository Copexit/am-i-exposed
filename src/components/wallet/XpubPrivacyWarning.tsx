"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, X } from "lucide-react";

interface XpubPrivacyWarningProps {
  addressCount: number;
  apiEndpoint: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const SESSION_KEY = "xpub-privacy-ack";

export function XpubPrivacyWarning({
  addressCount,
  apiEndpoint,
  onConfirm,
  onCancel,
}: XpubPrivacyWarningProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<Element | null>(null);

  // Focus trap + escape key
  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    dialogRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (prevFocusRef.current instanceof HTMLElement) {
        prevFocusRef.current.focus();
      }
    };
  }, [onCancel]);

  const handleConfirm = useCallback(() => {
    if (dontShowAgain) {
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // sessionStorage not available
      }
    }
    onConfirm();
  }, [dontShowAgain, onConfirm]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={handleBackdropClick}
      >
        <motion.div
          ref={dialogRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="xpub-warn-title"
          aria-describedby="xpub-warn-desc"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative w-full max-w-lg bg-surface-elevated border border-severity-critical/30 rounded-2xl shadow-2xl outline-none overflow-hidden"
        >
          {/* Close button */}
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 text-muted hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>

          <div className="p-6 sm:p-8 space-y-5">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-severity-critical/10">
                <ShieldAlert size={24} className="text-severity-critical" />
              </div>
              <h2 id="xpub-warn-title" className="text-lg font-semibold text-foreground">
                Privacy Warning - Wallet Scan
              </h2>
            </div>

            {/* Body */}
            <div id="xpub-warn-desc" className="space-y-4 text-sm text-foreground/90 leading-relaxed">
              <p>
                Scanning this extended public key will query approximately{" "}
                <strong className="text-foreground">{addressCount}</strong> derived
                addresses through{" "}
                <strong className="text-foreground">{apiEndpoint}</strong>.
              </p>

              <div className="space-y-2">
                <p className="text-muted">
                  This reveals to the API operator that all queried addresses belong
                  to the same wallet. A third party observing these queries could:
                </p>
                <ul className="space-y-1.5 ml-4">
                  <li className="flex items-start gap-2">
                    <span className="text-severity-critical mt-0.5">&#x2022;</span>
                    <span>Link all addresses and transactions to a single identity</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-severity-critical mt-0.5">&#x2022;</span>
                    <span>Calculate total wallet balance and spending history</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-severity-critical mt-0.5">&#x2022;</span>
                    <span>Monitor future activity across all derived addresses</span>
                  </li>
                </ul>
              </div>

              <div className="bg-surface-inset rounded-lg px-4 py-3 text-xs text-muted">
                For maximum privacy, connect to a personal mempool instance or use the Umbrel app.
              </div>
            </div>

            {/* Don't show again */}
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={e => setDontShowAgain(e.target.checked)}
                className="rounded border-card-border bg-surface-elevated accent-bitcoin"
              />
              Don&apos;t show again this session
            </label>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
              <button
                onClick={handleConfirm}
                className="px-4 py-2 bg-severity-critical/90 hover:bg-severity-critical text-white font-semibold text-sm rounded-lg transition-all duration-150 cursor-pointer"
              >
                I understand the risk, proceed
              </button>
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/** Check if user dismissed the warning this session. */
export function isXpubPrivacyAcked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}
