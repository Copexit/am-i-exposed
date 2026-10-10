"use client";

import { useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useLocationHash } from "@/components/chrome/useLocationHash";
import { setHash } from "@/lib/hash-nav";
import { parseObsHash, serializeObsHash, type ObsState } from "@/lib/observatory/obs-hash";

/** Observatory tabs, in display order; the first is the default. */
export const OBSERVATORY_TABS = ["wabisabi", "whirlpool", "p2p"] as const;
export type ObservatoryTab = (typeof OBSERVATORY_TABS)[number];

/** The tab a path selects: /observatory/<tab>/ is that tab, anything else (the hub) is null. */
export function obsRouteTab(pathname: string | null): ObservatoryTab | null {
  const m = /^\/observatory\/([a-z0-9]+)\/?$/.exec(pathname ?? "");
  return m && (OBSERVATORY_TABS as readonly string[]).includes(m[1]!) ? (m[1] as ObservatoryTab) : null;
}

/**
 * Where a legacy hub deep link (/observatory/#p2p&cur=EUR) lives now (/observatory/p2p/#cur=EUR),
 * or null when the hash names no tab.
 */
export function legacyObsRedirect(hash: string): string | null {
  const [tab = "", ...rest] = hash.replace(/^#/, "").split("&");
  if (!(OBSERVATORY_TABS as readonly string[]).includes(tab)) return null;
  return `/observatory/${tab}/${rest.length ? `#${rest.join("&")}` : ""}`;
}

/** Patches that only move the selection (coordinator, tx, P2P market) rewrite the current history entry. */
const SELECTION_KEYS: ReadonlySet<string> = new Set(["coordinator", "tx", "cur", "side", "venue", "pm", "amt", "amtu"]);

/**
 * The Observatory's URL state. The tab is the path (/observatory/<tab>/, the hub shows the first
 * tab); period, coordinator, tx, view and the P2P market live in the hash ("#period=7&coordinator=kruw"),
 * so every state is bookmarkable and Back/Forward restore it.
 */
export function useObsState(): [ObsState, (patch: Partial<Omit<ObsState, "tab">>) => void] {
  const tab = obsRouteTab(usePathname()) ?? OBSERVATORY_TABS[0];
  const hash = useLocationHash();
  const state = useMemo(() => parseObsHash(`#${tab}&${hash.slice(1)}`, OBSERVATORY_TABS), [hash, tab]);
  const update = useCallback((patch: Partial<Omit<ObsState, "tab">>) => {
    // Read the live hash, not the render-time one, so back-to-back patches compose.
    const next = { ...parseObsHash(`#${tab}&${window.location.hash.slice(1)}`, OBSERVATORY_TABS), ...patch };
    // The tab is in the path, so drop it from the hash.
    setHash(serializeObsHash(next).replace(/^#[^&]*&?/, ""), { replace: Object.keys(patch).every((k) => SELECTION_KEYS.has(k)) });
  }, [tab]);
  return [state, update];
}
