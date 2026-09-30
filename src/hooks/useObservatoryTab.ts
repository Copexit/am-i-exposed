"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useLocationHash } from "@/components/chrome/useLocationHash";
import { setHash } from "@/lib/hash-nav";

export const OBSERVATORY_TABS = ["whirlpool", "wabisabi"] as const;
export type ObservatoryTab = (typeof OBSERVATORY_TABS)[number];

const STORAGE_KEY = "ami-observatory-tab";
const DEFAULT_TAB: ObservatoryTab = "whirlpool";

function asTab(value: string | null | undefined): ObservatoryTab | null {
  const v = value?.replace(/^#/, "").toLowerCase();
  return OBSERVATORY_TABS.find((tab) => tab === v) ?? null;
}

/** URL hash wins (shareable links), then the viewer's last choice, then Whirlpool. */
export function resolveObservatoryTab(
  hash: string,
  stored: string | null,
): ObservatoryTab {
  return asTab(hash) ?? asTab(stored) ?? DEFAULT_TAB;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// localStorage has no same-tab change event; selecting a tab also sets the
// hash, which is what triggers the re-render.
const noSubscribe = () => () => {};

/** Active observatory tab, synced to `#whirlpool` / `#wabisabi` and localStorage. */
export function useObservatoryTab(): [ObservatoryTab, (tab: ObservatoryTab) => void] {
  const hash = useLocationHash();
  const stored = useSyncExternalStore(noSubscribe, readStored, () => null);
  const select = useCallback((tab: ObservatoryTab) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, tab);
    } catch {
      // Private mode / blocked storage: the hash still carries the choice.
    }
    setHash(tab, { replace: true });
  }, []);
  return [resolveObservatoryTab(hash, stored), select];
}
