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
  /** Whether the app is running on the Umbrel Docker backend */
  isUmbrel: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
  config: NETWORK_CONFIG[DEFAULT_NETWORK],
  customApiUrl: null,
  setCustomApiUrl: () => {},
  torStatus: "checking",
  localApiStatus: "checking",
  isUmbrel: false,
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { network, setNetwork } = useUrlState();
  const { customUrl, setCustomUrl } = useCustomApi();
  const localApi = useLocalApi();
  const { isUmbrel } = localApi;
  const localApiStatus = localApi.status;
  const torStatus = useTorDetection(isUmbrel);
  const baseConfig = NETWORK_CONFIG[network];

  const config = useMemo(() => {
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
        } else if (localApi.mempoolPort) {
          // LAN: use same hostname with mempool's port
          explorerUrl = `${window.location.protocol}//${window.location.hostname}:${localApi.mempoolPort}`;
        }
      }
      return {
        ...baseConfig,
        mempoolBaseUrl: "/api",
        explorerUrl,
      };
    }
    // Priority 3: Tor detected and onion URL available - use onion endpoint
    if (torStatus === "tor" && baseConfig.mempoolOnionUrl) {
      return {
        ...baseConfig,
        mempoolBaseUrl: baseConfig.mempoolOnionUrl,
        explorerUrl: baseConfig.mempoolOnionUrl.replace(/\/api\/?$/, ""),
      };
    }
    // Priority 4: Hardcoded defaults
    return baseConfig;
  }, [baseConfig, customUrl, isUmbrel, localApi.mempoolPort, localApi.mempoolOnion, torStatus]);

  const value = useMemo(
    () => ({
      network,
      setNetwork,
      config,
      customApiUrl: customUrl,
      setCustomApiUrl: setCustomUrl,
      torStatus,
      localApiStatus,
      isUmbrel,
    }),
    [network, setNetwork, config, customUrl, setCustomUrl, torStatus, localApiStatus, isUmbrel],
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
