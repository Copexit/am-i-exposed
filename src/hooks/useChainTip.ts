"use client";

import { useEffect, useState } from "react";
import { useNetwork } from "@/context/NetworkContext";

/**
 * Fetches the current chain-tip block height from the active mempool.space
 * endpoint (or local Umbrel mempool). Polls on tab focus. Returns null
 * while the request is in flight or if the endpoint can't be reached.
 *
 * Direct fetch (no mempool client wrapper) - avoids retro-fitting an
 * optional method across the project's many client-mocking tests.
 */
export function useChainTip(): number | null {
  const { config } = useNetwork();
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const base = config.mempoolBaseUrl.replace(/\/+$/, "");

    async function fetchTip() {
      try {
        const res = await fetch(`${base}/blocks/tip/height`, {
          signal: controller.signal,
          headers: { Accept: "text/plain" },
        });
        if (!res.ok) return;
        const raw = (await res.text()).trim();
        const n = parseInt(raw, 10);
        if (!cancelled && Number.isFinite(n) && n > 0) {
          setHeight(n);
        }
      } catch {
        // Silent - tip is a best-effort enhancement, not load-bearing.
      }
    }

    void fetchTip();
    const onFocus = () => { void fetchTip(); };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("focus", onFocus);
    };
  }, [config.mempoolBaseUrl]);

  return height;
}
