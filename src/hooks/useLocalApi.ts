"use client";

import { useState, useEffect } from "react";

export type LocalApiStatus = "checking" | "available" | "unavailable";

interface LocalApiResult {
  status: LocalApiStatus;
  mempoolPort: string | null;
}

const PROBE_TIMEOUT_MS = 3_000;

/** Module-level cache so the probe runs at most once per page load */
let cachedResult: LocalApiResult | null = null;
let inflight: Promise<LocalApiResult> | null = null;

/**
 * Probe the same origin for a mempool-compatible API.
 * On Umbrel the nginx container proxies /api/* to the local mempool instance,
 * so /api/blocks/tip/height returns a block height integer.
 * On GitHub Pages (or any host without the proxy) this 404s instantly.
 */
async function probeLocalApi(signal: AbortSignal): Promise<LocalApiResult> {
  try {
    const res = await fetch("/api/blocks/tip/height", {
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    });
    if (!res.ok) return { status: "unavailable", mempoolPort: null };
    const text = await res.text();
    // A valid mempool API returns a block height (positive integer)
    const height = parseInt(text, 10);
    if (isNaN(height) || height <= 0) return { status: "unavailable", mempoolPort: null };

    // Fetch mempool connection info for explorer links
    let mempoolPort: string | null = null;
    try {
      const infoRes = await fetch("/api/local-info", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
      });
      if (infoRes.ok) {
        const info = await infoRes.json();
        if (info.mempoolPort) mempoolPort = info.mempoolPort;
      }
    } catch {
      // Non-critical - explorer links will fall back to same-origin
    }

    return { status: "available", mempoolPort };
  } catch {
    return { status: "unavailable", mempoolPort: null };
  }
}

/**
 * Detects whether a same-origin mempool API proxy is available (e.g. Umbrel).
 * Returns "available" if /api/blocks/tip/height responds with a valid block height,
 * "unavailable" otherwise. Also returns the mempool port for explorer links.
 * Cached per page load.
 */
export function useLocalApi(): LocalApiResult {
  const [result, setResult] = useState<LocalApiResult>(
    () => cachedResult ?? { status: "checking", mempoolPort: null },
  );

  useEffect(() => {
    if (cachedResult) return;

    const controller = new AbortController();

    // Deduplicate concurrent calls (e.g. StrictMode double-mount)
    if (!inflight) {
      inflight = probeLocalApi(controller.signal).then((r) => {
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
