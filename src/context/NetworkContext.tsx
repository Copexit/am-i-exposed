"use client";

import {
  createContext,
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
import { useTorDetection, type TorStatus } from "@/hooks/useTorDetection";
import { useLocalApi, type LocalApiStatus } from "@/hooks/useLocalApi";

interface NetworkContextValue {
  network: BitcoinNetwork;
  setNetwork: (n: BitcoinNetwork) => void;
  config: NetworkConfig;
  customApiUrl: string | null;
  setCustomApiUrl: (url: string | null) => void;
  torStatus: TorStatus;
  localApiStatus: LocalApiStatus;
}

const NetworkContext = createContext<NetworkContextValue>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
  config: NETWORK_CONFIG[DEFAULT_NETWORK],
  customApiUrl: null,
  setCustomApiUrl: () => {},
  torStatus: "checking",
  localApiStatus: "checking",
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { network, setNetwork } = useUrlState();
  const { customUrl, setCustomUrl } = useCustomApi();
  const localApi = useLocalApi();
  const localApiStatus = localApi.status;
  const torStatus = useTorDetection(localApiStatus === "available");
  const baseConfig = NETWORK_CONFIG[network];

  const config = useMemo(() => {
    // Priority 1: Custom API URL takes priority over everything
    if (customUrl) {
      return {
        ...baseConfig,
        mempoolBaseUrl: customUrl,
        esploraBaseUrl: customUrl, // Disable fallback when custom URL is active
        explorerUrl: customUrl.replace(/\/api\/?$/, ""),
      };
    }
    // Priority 2: Same-origin API proxy detected (Umbrel mode)
    if (localApiStatus === "available") {
      // Build explorer URL pointing to the local mempool UI
      // Uses the mempool port from /api/local-info, falling back to same-origin
      let explorerUrl = "";
      if (localApi.mempoolPort && typeof window !== "undefined") {
        explorerUrl = `${window.location.protocol}//${window.location.hostname}:${localApi.mempoolPort}`;
      }
      return {
        ...baseConfig,
        mempoolBaseUrl: "/api",
        esploraBaseUrl: "/api", // Disable external fallback
        explorerUrl,
      };
    }
    // Priority 3: Tor detected and onion URL available - use it as primary
    // with clearnet mempool as fallback (still routed through Tor exit nodes)
    if (torStatus === "tor" && baseConfig.mempoolOnionUrl) {
      return {
        ...baseConfig,
        mempoolBaseUrl: baseConfig.mempoolOnionUrl,
        esploraBaseUrl: baseConfig.mempoolBaseUrl, // clearnet fallback via Tor
        explorerUrl: baseConfig.mempoolOnionUrl.replace(/\/api\/?$/, ""),
      };
    }
    // Priority 4: Hardcoded defaults
    return baseConfig;
  }, [baseConfig, customUrl, localApiStatus, localApi.mempoolPort, torStatus]);

  const value = useMemo(
    () => ({
      network,
      setNetwork,
      config,
      customApiUrl: customUrl,
      setCustomApiUrl: setCustomUrl,
      torStatus,
      localApiStatus,
    }),
    [network, setNetwork, config, customUrl, setCustomUrl, torStatus, localApiStatus],
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
