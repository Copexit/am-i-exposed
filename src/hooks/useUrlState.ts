"use client";

import { useCallback, useSyncExternalStore } from "react";
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

// External store for network state synced with URL
let listeners: Array<() => void> = [];
let cachedNetwork: BitcoinNetwork = DEFAULT_NETWORK;

// Initialize cache on first client-side access
let initialized = false;

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];

  // Initialize cache on first subscription
  if (!initialized) {
    cachedNetwork = readNetworkFromUrl();
    initialized = true;
  }

  const handlePopState = () => {
    const next = readNetworkFromUrl();
    if (next !== cachedNetwork) {
      cachedNetwork = next;
      emitChange();
    }
  };
  window.addEventListener("popstate", handlePopState);

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    window.removeEventListener("popstate", handlePopState);
  };
}

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function getSnapshot(): BitcoinNetwork {
  // Return cached value - only updated via subscribe/setNetwork
  if (!initialized && typeof window !== "undefined") {
    cachedNetwork = readNetworkFromUrl();
    initialized = true;
  }
  return cachedNetwork;
}

function getServerSnapshot(): BitcoinNetwork {
  return DEFAULT_NETWORK;
}

export function useUrlState() {
  const network = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setNetwork = useCallback((n: BitcoinNetwork) => {
    cachedNetwork = n;
    const params = new URLSearchParams(window.location.search);
    if (n === DEFAULT_NETWORK) {
      params.delete("network");
    } else {
      params.set("network", n);
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}${window.location.hash}` : `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, "", url);
    emitChange();
  }, []);

  return { network, setNetwork };
}
