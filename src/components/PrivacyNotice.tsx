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
          className="bg-surface-elevated border border-card-border rounded-lg p-4 mx-4 mb-4"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              size={18}
              className="text-warning shrink-0 mt-0.5"
            />
            <div className="flex-1 space-y-2">
              <p className="text-sm font-medium text-foreground">
                A note on your privacy
              </p>
              <p className="text-sm text-muted leading-relaxed">
                This tool analyzes Bitcoin data by requesting it from
                mempool.space. Their servers can see which addresses or
                transactions you look up, along with your IP address. For
                stronger privacy, use Tor Browser or a VPN. Your funds are
                never at risk - this only affects who can see what you
                searched for.
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer"
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
