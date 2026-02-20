"use client";

import { useState, useEffect } from "react";

export type LocalApiStatus = "checking" | "available" | "unavailable";

const PROBE_TIMEOUT_MS = 3_000;

/** Module-level cache so the probe runs at most once per page load */
let cachedStatus: LocalApiStatus | null = null;
let inflight: Promise<LocalApiStatus> | null = null;

/**
 * Probe the same origin for a mempool-compatible API.
 * On Umbrel the nginx container proxies /api/* to the local mempool instance,
 * so /api/blocks/tip/height returns a block height integer.
 * On GitHub Pages (or any host without the proxy) this 404s instantly.
 */
async function probeLocalApi(signal: AbortSignal): Promise<LocalApiStatus> {
  try {
    const res = await fetch("/api/blocks/tip/height", {
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    });
    if (!res.ok) return "unavailable";
    const text = await res.text();
    // A valid mempool API returns a block height (positive integer)
    const height = parseInt(text, 10);
    if (!isNaN(height) && height > 0) return "available";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Detects whether a same-origin mempool API proxy is available (e.g. Umbrel).
 * Returns "available" if /api/blocks/tip/height responds with a valid block height,
 * "unavailable" otherwise. Cached per page load.
 */
export function useLocalApi(): LocalApiStatus {
  const [status, setStatus] = useState<LocalApiStatus>(
    () => cachedStatus ?? "checking",
  );

  useEffect(() => {
    if (cachedStatus) return;

    const controller = new AbortController();

    // Deduplicate concurrent calls (e.g. StrictMode double-mount)
    if (!inflight) {
      inflight = probeLocalApi(controller.signal).then((result) => {
        cachedStatus = result;
        inflight = null;
        return result;
      });
    }

    inflight.then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    });

    return () => controller.abort();
  }, []);

  return status;
}
