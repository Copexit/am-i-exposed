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

interface NetworkContextValue {
  network: BitcoinNetwork;
  setNetwork: (n: BitcoinNetwork) => void;
  config: NetworkConfig;
  customApiUrl: string | null;
  setCustomApiUrl: (url: string | null) => void;
  torStatus: TorStatus;
}

const NetworkContext = createContext<NetworkContextValue>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
  config: NETWORK_CONFIG[DEFAULT_NETWORK],
  customApiUrl: null,
  setCustomApiUrl: () => {},
  torStatus: "checking",
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { network, setNetwork } = useUrlState();
  const { customUrl, setCustomUrl } = useCustomApi();
  const torStatus = useTorDetection();
  const baseConfig = NETWORK_CONFIG[network];

  const config = useMemo(() => {
    // Custom API URL takes priority over everything
    if (customUrl) {
      return {
        ...baseConfig,
        mempoolBaseUrl: customUrl,
        esploraBaseUrl: customUrl, // Disable fallback when custom URL is active
        explorerUrl: customUrl.replace(/\/api\/?$/, ""),
      };
    }
    // When Tor detected and onion URL available, use it as primary
    // with clearnet mempool as fallback (still routed through Tor exit nodes)
    if (torStatus === "tor" && baseConfig.mempoolOnionUrl) {
      return {
        ...baseConfig,
        mempoolBaseUrl: baseConfig.mempoolOnionUrl,
        esploraBaseUrl: baseConfig.mempoolBaseUrl, // clearnet fallback via Tor
        explorerUrl: baseConfig.mempoolOnionUrl.replace(/\/api\/?$/, ""),
      };
    }
    return baseConfig;
  }, [baseConfig, customUrl, torStatus]);

  const value = useMemo(
    () => ({
      network,
      setNetwork,
      config,
      customApiUrl: customUrl,
      setCustomApiUrl: setCustomUrl,
      torStatus,
    }),
    [network, setNetwork, config, customUrl, setCustomUrl, torStatus],
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
