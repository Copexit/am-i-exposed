"use client";

import { useState, useEffect, useCallback } from "react";
import {
  type BitcoinNetwork,
  DEFAULT_NETWORK,
  isValidNetwork,
} from "@/lib/bitcoin/networks";

function readNetworkFromUrl(): BitcoinNetwork {
  if (typeof window === "undefined") return DEFAULT_NETWORK;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("network");
  return raw && isValidNetwork(raw) ? raw : DEFAULT_NETWORK;
}

export function useUrlState() {
  const [network, setNetworkState] = useState<BitcoinNetwork>(DEFAULT_NETWORK);

  // Read network from URL on mount and on popstate (back/forward)
  useEffect(() => {
    setNetworkState(readNetworkFromUrl());

    const handlePopState = () => setNetworkState(readNetworkFromUrl());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const setNetwork = useCallback((n: BitcoinNetwork) => {
    setNetworkState(n);
    const params = new URLSearchParams(window.location.search);
    if (n === DEFAULT_NETWORK) {
      params.delete("network");
    } else {
      params.set("network", n);
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}${window.location.hash}` : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, []);

  return { network, setNetwork };
}
