"use client";

import { useState, useEffect } from "react";
import { abortSignalAny, abortSignalTimeout } from "@/lib/abort-signal";

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
 * Detect Tor-capable browsers through local heuristics (no network).
 *
 * 1. Tor Browser (Firefox-based): WebRTC is disabled via
 *    media.peerconnection.enabled=false - constructor exists but throws.
 * 2. Brave Private Window with Tor: navigator.brave exists and
 *    WebRTC is restricted in Tor mode.
 */
function detectTorBrowserLocally(): boolean {
  if (typeof window === "undefined") return false;

  // Tor Browser: Firefox UA + disabled WebRTC
  if (/Firefox\//i.test(navigator.userAgent)) {
    try {
      if (typeof RTCPeerConnection === "undefined") return true;
      const pc = new RTCPeerConnection();
      pc.close();
      return false; // WebRTC works - not Tor Browser
    } catch {
      return true; // WebRTC disabled - likely Tor Browser
    }
  }

  // Brave Tor Window: has navigator.brave API.
  // We can't distinguish Tor vs regular private window locally,
  // but if both worker check and onion probe failed to reach the
  // network, and we're in Brave, there's a good chance it's Tor mode.
  // Return false here - Brave Tor detection relies on the worker check.
  return false;
}

/**
 * Whether `.onion` API endpoints can be used.
 * Chromium-based browsers (Brave) block mixed content (http .onion from https page),
 * so even when Tor is detected, we must use https://mempool.space through the Tor circuit.
 * Only Firefox-based Tor Browser exempts .onion from mixed content.
 */
export function canUseOnionEndpoint(): boolean {
  if (typeof window === "undefined") return false;
  // Page already on .onion - always works
  if (window.location.hostname.endsWith(".onion")) return true;
  // Page on HTTPS - only Firefox/Tor Browser has the mixed content exemption
  if (window.location.protocol === "https:") {
    return /Firefox\//i.test(navigator.userAgent);
  }
  // Page on HTTP - no mixed content issue
  return true;
}

/** Ask the Cloudflare Worker if our IP is a Tor exit node */
async function checkWorker(signal: AbortSignal): Promise<TorStatus> {
  try {
    const res = await fetch(TOR_CHECK_URL, {
      signal: abortSignalAny([signal, abortSignalTimeout(WORKER_TIMEOUT_MS)]),
    });
    if (!res.ok) return "unknown";
    const data: TorCheckResponse = await res.json();
    return data.isTor ? "tor" : "clearnet";
  } catch {
    return "unknown";
  }
}

/**
 * Probe mempool's .onion address to test Tor connectivity.
 * On clearnet browsers, .onion DNS resolution fails immediately.
 * On Tor Browser (Firefox-based), .onion is exempt from mixed-content
 * blocking even from HTTPS pages. On Brave Tor, this exemption does
 * NOT exist (Chromium-based), so the probe will fail due to mixed
 * content when the page is served over HTTPS.
 */
async function probeOnion(signal: AbortSignal): Promise<boolean> {
  // Skip probe if page is HTTPS and browser is Chromium-based
  // (mixed content will block http://*.onion from https:// pages)
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    !window.location.hostname.endsWith(".onion") &&
    !/Firefox\//i.test(navigator.userAgent)
  ) {
    return false;
  }
  try {
    await fetch(ONION_PROBE_URL, {
      signal: abortSignalAny([signal, abortSignalTimeout(ONION_PROBE_TIMEOUT_MS)]),
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

/**
 * @param skip When true (e.g. local API detected on Umbrel), return "clearnet"
 *   immediately without firing any external checks. This prevents IP leakage
 *   to tor-check.copexit.workers.dev on every page load.
 * @param defer When true (e.g. local API detection still pending), stay in
 *   "checking" and fire nothing until the caller knows whether to skip.
 */
export function useTorDetection(skip?: boolean, defer?: boolean): TorStatus {
  const [status, setStatus] = useState<TorStatus>(() => {
    if (skip) return "clearnet";
    return cachedStatus ?? "checking";
  });

  useEffect(() => {
    if (skip || defer || cachedStatus) return;

    const controller = new AbortController();

    // Deduplicate concurrent calls. An aborted probe (StrictMode unmount)
    // clears itself in cleanup, so a remount starts a fresh one.
    if (!inflight) {
      const p: Promise<TorStatus> = checkTor(controller.signal).then((result) => {
        if (!controller.signal.aborted) cachedStatus = result;
        if (inflight === p) inflight = null;
        return result;
      });
      inflight = p;
    }
    const current = inflight;

    current.then((result) => {
      if (!controller.signal.aborted) {
        setStatus(result);
      }
    });

    return () => {
      controller.abort();
      if (!cachedStatus && inflight === current) inflight = null;
    };
  }, [skip, defer]);

  return skip ? "clearnet" : status;
}
