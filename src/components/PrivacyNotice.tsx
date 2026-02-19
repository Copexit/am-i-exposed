"use client";

import { useSyncExternalStore, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ShieldAlert, X } from "lucide-react";

const STORAGE_KEY = "privacy-notice-dismissed";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function getServerSnapshot(): boolean {
  return true; // Dismissed on server to avoid hydration mismatch
}

export function PrivacyNotice() {
  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "1");
    // Trigger re-render by dispatching storage event
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return (
    <AnimatePresence>
      {!dismissed && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="bg-surface-elevated border border-card-border rounded-lg px-3 py-2 mx-4 mb-3 max-w-6xl sm:mx-auto w-auto"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-warning shrink-0" />
            <p className="text-sm text-muted flex-1">
              Queries are sent to mempool.space - your IP is visible. Use
              Tor or a VPN for stronger privacy.
            </p>
            <button
              onClick={handleDismiss}
              className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer p-3 -m-1.5 rounded-lg"
              aria-label="Dismiss notice"
            >
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
