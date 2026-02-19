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

const WORKER_TIMEOUT_MS = 5_000;
const ONION_PROBE_TIMEOUT_MS = 10_000;
const ONION_PROBE_URL =
  "http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api/v1/fees/recommended";

/** Module-level cache so we call the API at most once per page load */
let cachedStatus: TorStatus | null = null;
let inflight: Promise<TorStatus> | null = null;

/**
 * Detect Tor Browser through browser characteristics.
 * Tor Browser is Firefox-based and disables WebRTC via
 * media.peerconnection.enabled=false (constructor exists but throws).
 */
function detectTorBrowserLocally(): boolean {
  if (typeof window === "undefined") return false;
  if (!/Firefox\//i.test(navigator.userAgent)) return false;

  // Tor Browser keeps RTCPeerConnection in scope but makes it throw
  try {
    if (typeof RTCPeerConnection === "undefined") return true;
    const pc = new RTCPeerConnection();
    pc.close();
    return false; // WebRTC works - not Tor Browser
  } catch {
    return true; // WebRTC disabled - likely Tor Browser
  }
}

/** Ask the Cloudflare Worker if our IP is a Tor exit node */
async function checkWorker(signal: AbortSignal): Promise<TorStatus> {
  try {
    const res = await fetch(TOR_CHECK_URL, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(WORKER_TIMEOUT_MS)]),
    });
    if (!res.ok) return "unknown";
    const data: TorCheckResponse = await res.json();
    return data.isTor ? "tor" : "clearnet";
  } catch {
    return "unknown";
  }
}

/**
 * Probe mempool's .onion address to definitively test Tor connectivity.
 * On clearnet browsers, .onion DNS resolution fails immediately.
 * On Tor Browser, .onion is exempt from mixed-content blocking and
 * routes through Tor, so the fetch succeeds.
 */
async function probeOnion(signal: AbortSignal): Promise<boolean> {
  try {
    await fetch(ONION_PROBE_URL, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(ONION_PROBE_TIMEOUT_MS)]),
    });
    return true;
  } catch {
    return false;
  }
}

async function checkTor(signal: AbortSignal): Promise<TorStatus> {
  // Instant check: page served from a .onion address
  if (
    typeof window !== "undefined" &&
    window.location.hostname.endsWith(".onion")
  ) {
    return "tor";
  }

  // Run worker check and .onion probe in parallel for speed.
  // The worker is fast but can have stale exit-node lists.
  // The .onion probe is the definitive test (if it succeeds, we're on Tor).
  const workerPromise = checkWorker(signal);
  const onionPromise = probeOnion(signal);

  const workerResult = await workerPromise;
  if (workerResult === "tor") return "tor";

  // Worker didn't confirm Tor - check .onion probe (authoritative)
  const onionReachable = await onionPromise;
  if (onionReachable) return "tor";

  // Both remote checks failed - try local browser heuristic as last resort
  if (detectTorBrowserLocally()) return "tor";

  return workerResult;
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
