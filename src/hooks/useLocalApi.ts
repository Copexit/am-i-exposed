"use client";

import { useState, useEffect } from "react";
import { abortSignalAny, abortSignalTimeout } from "@/lib/abort-signal";

export type LocalApiStatus = "checking" | "available" | "unavailable";

interface LocalApiResult {
  /** Whether the app is running on the Umbrel Docker backend (detected via /api/local-info) */
  isUmbrel: boolean;
  /** Mempool API health: "checking" while probing, "available" if responsive, "unavailable" if down */
  status: LocalApiStatus;
  mempoolPort: string | null;
  mempoolOnion: string | null;
}

const MEMPOOL_TIMEOUT_MS = 3_000;
const LOCAL_INFO_TIMEOUT_MS = 1_500;

/** Module-level cache so the probe runs at most once per page load */
let cachedResult: LocalApiResult | null = null;
let inflight: Promise<LocalApiResult> | null = null;

/**
 * Phase 1: Probe /api/local-info to detect Umbrel backend.
 * This endpoint is served directly by nginx (<100ms), with NO mempool dependency.
 * On GitHub Pages it returns HTML (SPA fallback) or 404 - JSON.parse fails.
 */
async function probeLocalInfo(
  signal: AbortSignal,
): Promise<{ mempoolPort: string | null; mempoolOnion: string | null } | null> {
  try {
    const res = await fetch("/api/local-info", {
      signal: abortSignalAny([signal, abortSignalTimeout(LOCAL_INFO_TIMEOUT_MS)]),
    });
    if (!res.ok) return null;
    const info = await res.json();
    // Validate it's our JSON (not an HTML fallback page)
    if (typeof info !== "object" || info === null) return null;
    return {
      mempoolPort: info.mempoolPort ?? null,
      mempoolOnion:
        info.mempoolOnion && typeof info.mempoolOnion === "string" && info.mempoolOnion.endsWith(".onion")
          ? info.mempoolOnion
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * Phase 2: Probe /api/blocks/tip/height to check mempool health.
 * Only called when isUmbrel = true. May take up to 3s if mempool is stuck.
 */
async function probeMempool(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/blocks/tip/height", {
      signal: abortSignalAny([signal, abortSignalTimeout(MEMPOOL_TIMEOUT_MS)]),
    });
    if (!res.ok) return false;
    const text = await res.text();
    const height = parseInt(text, 10);
    return !isNaN(height) && height > 0;
  } catch {
    return false;
  }
}

/**
 * Two-phase probe:
 *  1. /api/local-info (fast, nginx-served) -> determines isUmbrel
 *  2. /api/blocks/tip/height (proxied to mempool) -> determines health
 *
 * earlyUpdate is called after Phase 1 so the UI can show "Local" immediately.
 */
async function probe(
  signal: AbortSignal,
  earlyUpdate: (partial: LocalApiResult) => void,
): Promise<LocalApiResult> {
  // Phase 1: Fast backend detection
  const info = await probeLocalInfo(signal);

  if (!info) {
    // Not on Umbrel - skip Phase 2 entirely
    return { isUmbrel: false, status: "unavailable", mempoolPort: null, mempoolOnion: null };
  }

  // Umbrel detected! Push early state so badge shows "Local" immediately
  const earlyResult: LocalApiResult = {
    isUmbrel: true,
    status: "checking",
    mempoolPort: info.mempoolPort,
    mempoolOnion: info.mempoolOnion,
  };
  earlyUpdate(earlyResult);

  // Phase 2: Mempool health check
  if (signal.aborted) return earlyResult;
  const healthy = await probeMempool(signal);

  return {
    isUmbrel: true,
    status: healthy ? "available" : "unavailable",
    mempoolPort: info.mempoolPort,
    mempoolOnion: info.mempoolOnion,
  };
}

/**
 * Detects whether the app is running on Umbrel (via /api/local-info)
 * and whether the local mempool API is healthy (via /api/blocks/tip/height).
 *
 * Two independent concerns:
 * - isUmbrel: true if /api/local-info responded with valid JSON (nginx-served, instant)
 * - status: mempool health ("available" / "unavailable" / "checking")
 *
 * Cached per page load.
 */
export function useLocalApi(): LocalApiResult {
  const [result, setResult] = useState<LocalApiResult>(
    () => cachedResult ?? { isUmbrel: false, status: "checking", mempoolPort: null, mempoolOnion: null },
  );

  useEffect(() => {
    if (cachedResult) return;

    const controller = new AbortController();

    // Deduplicate concurrent calls (e.g. StrictMode double-mount)
    if (!inflight) {
      inflight = probe(controller.signal, (partial) => {
        // Early update from Phase 1 - don't cache yet, Phase 2 still running
        if (!controller.signal.aborted) {
          setResult(partial);
        }
      }).then((r) => {
        cachedResult = r;
        inflight = null;
        return r;
      });
    }

    inflight.then((r) => {
      if (!controller.signal.aborted) {
        setResult(r);
      }
    });

    return () => controller.abort();
  }, []);

  return result;
}
