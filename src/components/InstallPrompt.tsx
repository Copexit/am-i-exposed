"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function getIsStandalone(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as unknown as { standalone: boolean }).standalone)
  );
}

function subscribeStandalone(callback: () => void) {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

/**
 * PWA install prompt - shows a banner suggesting installation
 * when the app is running in a browser (not already installed as PWA).
 */
export function InstallPrompt() {
  const { t } = useTranslation();
  const isStandalone = useSyncExternalStore(
    subscribeStandalone,
    getIsStandalone,
    () => true,
  );

  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [enoughVisits] = useState(() => {
    if (typeof window === "undefined") return false;
    const key = "ami-visit-count";
    const count = parseInt(localStorage.getItem(key) ?? "0", 10) + 1;
    localStorage.setItem(key, String(count));
    return count >= 5;
  });

  useEffect(() => {
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
    setDismissed(true);
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (isStandalone || dismissed || !deferredPrompt || !enoughVisits) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-4 left-4 right-4 max-w-sm mx-auto rounded-xl overflow-hidden border border-glass-border p-4 z-50"
        style={{ background: "var(--card-bg)", boxShadow: "var(--glass-shadow)" }}
      >
        <div className="flex items-start gap-3">
          <Download size={18} className="text-bitcoin shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-foreground">
              {t("install.title", { defaultValue: "Install am-i.exposed" })}
            </p>
            <p className="text-sm text-muted">
              {t("install.description", { defaultValue: "Install as an app for faster access. No app store needed." })}
            </p>
            <button
              onClick={handleInstall}
              className="text-xs font-medium text-bitcoin bg-bitcoin/10 hover:bg-bitcoin/20 px-3 py-2.5 rounded-lg transition-colors cursor-pointer"
            >
              {t("install.installNow", { defaultValue: "Install now" })}
            </button>
          </div>
          <button
            onClick={handleDismiss}
            className="text-muted hover:text-foreground transition-colors shrink-0 cursor-pointer p-2"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
