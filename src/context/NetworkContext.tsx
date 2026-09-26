"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  type BitcoinNetwork,
  type NetworkConfig,
  NETWORK_CONFIG,
  DEFAULT_NETWORK,
} from "@/lib/bitcoin/networks";
import { useUrlState } from "@/hooks/useUrlState";
import { useCustomApi } from "@/hooks/useCustomApi";
import { useTorDetection, canUseOnionEndpoint, type TorStatus } from "@/hooks/useTorDetection";
import { useLocalApi, type LocalApiStatus } from "@/hooks/useLocalApi";

/**
 * Network served by the Umbrel backend. /api/local-info does not expose the
 * node's network and the local mempool runs mainnet, so the app pins it there
 * (?network= and saved-graph networks are ignored).
 */
export const UMBREL_NETWORK: BitcoinNetwork = DEFAULT_NETWORK;

interface NetworkContextValue {
  network: BitcoinNetwork;
  setNetwork: (n: BitcoinNetwork) => void;
  config: NetworkConfig;
  /** Resolve the API config for any network on the current backend (custom / Umbrel / Tor). */
  configFor: (n: BitcoinNetwork) => NetworkConfig;
  customApiUrl: string | null;
  setCustomApiUrl: (url: string | null) => void;
  torStatus: TorStatus;
  localApiStatus: LocalApiStatus;
  /** Whether the app is running on the Umbrel Docker backend */
  isUmbrel: boolean;
  /**
   * The backend is a self-hosted mempool (a user-set custom URL, or Umbrel's),
   * not mempool.space. The Tor onion endpoint is mempool.space, so it is not custom.
   */
  isCustomApi: boolean;
  /**
   * `config` is final: the local API probe (unless on Umbrel) and Tor detection
   * have settled. Before that, requests could go to clearnet mempool.space
   * instead of the local node or the onion.
   */
  apiReady: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
  config: NETWORK_CONFIG[DEFAULT_NETWORK],
  configFor: (n) => NETWORK_CONFIG[n],
  customApiUrl: null,
  setCustomApiUrl: () => {},
  torStatus: "checking",
  localApiStatus: "checking",
  isUmbrel: false,
  isCustomApi: false,
  apiReady: false,
});

interface ResolveOptions {
  customUrl: string | null;
  isUmbrel: boolean;
  torStatus: TorStatus;
  localApi: {
    mempoolPort?: string | null;
    mempoolOnion?: string | null;
    mempoolExternalUrl?: string | null;
  };
}

/** Pick the API backend for `network`: custom URL > Umbrel > Tor onion > public defaults. */
export function resolveNetworkConfig(
  network: BitcoinNetwork,
  { customUrl, isUmbrel, torStatus, localApi }: ResolveOptions,
): NetworkConfig {
  const baseConfig = NETWORK_CONFIG[network];
  // Priority 1: Custom API URL takes priority over everything
  if (customUrl) {
    return {
      ...baseConfig,
      mempoolBaseUrl: customUrl,
      explorerUrl: customUrl.replace(/\/api\/?$/, ""),
    };
  }
  // Priority 2: Umbrel detected - always route through /api
  // (regardless of mempool health - if mempool is down, scans fail with clear error)
  if (isUmbrel) {
    // Build explorer URL pointing to the local mempool UI
    let explorerUrl = "";
    if (typeof window !== "undefined") {
      const isOnion = window.location.hostname.endsWith(".onion");
      if (isOnion && localApi.mempoolOnion) {
        // Tor: use mempool's .onion hostname (from Umbrel's exports.sh)
        explorerUrl = `http://${localApi.mempoolOnion.trim()}`;
      } else if (localApi.mempoolExternalUrl) {
        // Packager-supplied explicit external URL (e.g. StartOS where
        // mempool's user-facing URL is on a different hostname entirely
        // from this app's hostname - the `host:port` heuristic below
        // can't build it).
        explorerUrl = localApi.mempoolExternalUrl.trim().replace(/\/$/, "");
      } else if (localApi.mempoolPort) {
        // LAN (Umbrel): same hostname, mempool's external port.
        explorerUrl = `${window.location.protocol}//${window.location.hostname}:${localApi.mempoolPort}`;
      }
    }
    return {
      ...baseConfig,
      mempoolBaseUrl: "/api",
      explorerUrl,
    };
  }
  // Priority 3: Tor detected and onion URL available - use onion endpoint.
  // Only use .onion if the browser supports it (Firefox/Tor Browser).
  // Chromium-based browsers (Brave Tor) block http .onion from https pages
  // due to mixed content, so they must use https://mempool.space via Tor circuit.
  if (torStatus === "tor" && baseConfig.mempoolOnionUrl && canUseOnionEndpoint()) {
    return {
      ...baseConfig,
      mempoolBaseUrl: baseConfig.mempoolOnionUrl,
      explorerUrl: baseConfig.mempoolOnionUrl.replace(/\/api\/?$/, ""),
    };
  }
  // Priority 4: Hardcoded defaults
  return baseConfig;
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const url = useUrlState();
  const { customUrl, setCustomUrl } = useCustomApi();
  const localApi = useLocalApi();
  const { isUmbrel, mempoolPort, mempoolOnion, mempoolExternalUrl } = localApi;
  const localApiStatus = localApi.status;
  // Hold Tor detection until the local API probe settles. On Umbrel or with a
  // custom API (own node) it never fires: resolveNetworkConfig ignores Tor there,
  // so the probe would only leak the IP to Cloudflare and mempool.space.
  // On Umbrel, phase 1 sets isUmbrel before the status settles, so skip wins.
  const skipTor = isUmbrel || !!customUrl;
  const torStatus = useTorDetection(skipTor, !skipTor && localApiStatus === "checking");

  const network = isUmbrel ? UMBREL_NETWORK : url.network;
  const urlSetNetwork = url.setNetwork;
  const setNetwork = useCallback(
    (n: BitcoinNetwork) => {
      if (!isUmbrel) urlSetNetwork(n);
    },
    [isUmbrel, urlSetNetwork],
  );

  const configFor = useCallback(
    (n: BitcoinNetwork) =>
      resolveNetworkConfig(n, {
        customUrl,
        isUmbrel,
        torStatus,
        localApi: { mempoolPort, mempoolOnion, mempoolExternalUrl },
      }),
    [customUrl, isUmbrel, torStatus, mempoolPort, mempoolOnion, mempoolExternalUrl],
  );
  const config = useMemo(() => configFor(network), [configFor, network]);

  const value = useMemo(
    () => ({
      network,
      setNetwork,
      config,
      configFor,
      customApiUrl: customUrl,
      setCustomApiUrl: setCustomUrl,
      torStatus,
      localApiStatus,
      isUmbrel,
      isCustomApi: !!customUrl || isUmbrel,
      apiReady: (isUmbrel || localApiStatus !== "checking") && torStatus !== "checking",
    }),
    [network, setNetwork, config, configFor, customUrl, setCustomUrl, torStatus, localApiStatus, isUmbrel],
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
