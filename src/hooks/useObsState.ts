"use client";

import { useCallback, useMemo } from "react";
import { useLocationHash } from "@/components/chrome/useLocationHash";
import { setHash } from "@/lib/hash-nav";
import { parseObsHash, serializeObsHash, type ObsState } from "@/lib/observatory/obs-hash";

/** Observatory tabs, in display order; the first is the default. */
export const OBSERVATORY_TABS = ["wabisabi", "whirlpool", "p2p"] as const;
export type ObservatoryTab = (typeof OBSERVATORY_TABS)[number];

/** Patches that only move the selection (coordinator, tx, P2P market) rewrite the current history entry. */
const SELECTION_KEYS: ReadonlySet<string> = new Set(["coordinator", "tx", "cur", "side", "venue", "pm"]);

/**
 * The Observatory's URL state (tab, period, coordinator, tx, view), backed by the hash so every
 * state is bookmarkable and Back/Forward restore it. The hash is the single source of truth.
 */
export function useObsState(): [ObsState, (patch: Partial<ObsState>) => void] {
  const hash = useLocationHash();
  const state = useMemo(() => parseObsHash(hash, OBSERVATORY_TABS), [hash]);
  const update = useCallback((patch: Partial<ObsState>) => {
    // Read the live hash, not the render-time one, so back-to-back patches compose.
    const next = { ...parseObsHash(window.location.hash, OBSERVATORY_TABS), ...patch };
    setHash(serializeObsHash(next), { replace: Object.keys(patch).every((k) => SELECTION_KEYS.has(k)) });
  }, []);
  return [state, update];
}
