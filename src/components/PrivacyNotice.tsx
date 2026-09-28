"use client";

import { useSyncExternalStore, useCallback } from "react";
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

/** Shared visibility/dismiss logic for the clearnet privacy notice. */
export function usePrivacyNotice() {
  const { torStatus, isCustomApi } = useNetwork();
  const dismissed = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const dismiss = useCallback(() => {
    sessionStorage.setItem(STORAGE_KEY, "1");
    // Trigger re-render by dispatching storage event
    window.dispatchEvent(new StorageEvent("storage"));
  }, []);

  return { visible: !dismissed && torStatus === "clearnet" && !isCustomApi, dismiss };
}
