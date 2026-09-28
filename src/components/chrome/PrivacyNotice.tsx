"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";

const STORAGE_KEY = "privacy-notice-dismissed";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // sessionStorage unavailable (private browsing)
  }
}

function getServerSnapshot(): boolean {
  return true; // Dismissed on server to avoid hydration mismatch
}

/** Visibility/dismiss logic for the clearnet privacy notice (dismissal lasts the session). */
function usePrivacyNotice() {
  const { torStatus, isCustomApi } = useNetwork();
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dismiss = useCallback(() => {
    sessionStorage.setItem(STORAGE_KEY, "1");
    // Trigger re-render by dispatching storage event
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return { visible: !dismissed && torStatus === "clearnet" && !isCustomApi, dismiss };
}

/**
 * Slim, dismissible clearnet notice under the header.
 * `inFlow`: rendered below the sticky header in page flow (phones), so it scrolls away instead of covering content.
 */
export function PrivacyNotice({ inFlow = false }: { inFlow?: boolean }) {
  const { t } = useTranslation();
  const { visible, dismiss } = usePrivacyNotice();
  const ref = useRef<HTMLDivElement>(null);

  // In flow, publish the live height (0 when hidden or dismissed) so the home hero can fit the first screen exactly.
  useEffect(() => {
    const el = ref.current;
    if (!inFlow || !el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--notice-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--notice-h"); };
  }, [inFlow]);

  return (
    <div ref={ref}>
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="privacy-notice"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={`overflow-hidden border-hairline ${inFlow ? "border-b" : "border-t"}`}
        >
          <div className="mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8 flex items-center gap-2.5 min-h-9">
            <span className="size-1.5 shrink-0 rounded-full bg-severity-medium" aria-hidden="true" />
            <p className="flex-1 py-2 text-[13px] leading-snug text-muted">
              {t("common.privacyNotice", { defaultValue: "Queries are sent to mempool.space - your IP is visible. Use Tor or a VPN for stronger privacy." })}
            </p>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
              className="-mr-2 inline-flex size-11 sm:size-8 shrink-0 items-center justify-center rounded-lg text-faint hover:text-foreground transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}
