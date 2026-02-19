"use client";

import { useState, useEffect } from "react";

export type TorStatus = "checking" | "tor" | "clearnet" | "unknown";

/** Response shape from the tor-check Cloudflare Worker */
interface TorCheckResponse {
  isTor: boolean;
}

// Cloudflare Worker that checks CF-Connecting-IP against Tor exit node list.
// Deploy from workers/tor-check/ with `wrangler deploy`.
const TOR_CHECK_URL =
  process.env.NEXT_PUBLIC_TOR_CHECK_URL ||
  "https://tor-check.copexit.workers.dev";

const TIMEOUT_MS = 5000;

/** Module-level cache so we call the API at most once per page load */
let cachedStatus: TorStatus | null = null;
let inflight: Promise<TorStatus> | null = null;

async function checkTor(signal: AbortSignal): Promise<TorStatus> {
  // Instant check: if the page itself is served from a .onion address
  if (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".onion")
  ) {
    return "tor";
  }

  try {
    const res = await fetch(TOR_CHECK_URL, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!res.ok) return "unknown";
    const data: TorCheckResponse = await res.json();
    return data.isTor ? "tor" : "clearnet";
  } catch {
    return "unknown";
  }
}

export function useTorDetection(): TorStatus {
  const [status, setStatus] = useState<TorStatus>(() =>
    cachedStatus ?? "checking"
  );

  useEffect(() => {
    // Already resolved from a previous render / page load
    // (initial state handles this via the useState initializer)
    if (cachedStatus) return;

    const controller = new AbortController();

    // Deduplicate concurrent calls (e.g. StrictMode double-mount)
    if (!inflight) {
      inflight = checkTor(controller.signal).then((result) => {
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
