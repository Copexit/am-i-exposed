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

interface NetworkContextValue {
  network: BitcoinNetwork;
  setNetwork: (n: BitcoinNetwork) => void;
  config: NetworkConfig;
  customApiUrl: string | null;
  setCustomApiUrl: (url: string | null) => void;
}

const NetworkContext = createContext<NetworkContextValue>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
  config: NETWORK_CONFIG[DEFAULT_NETWORK],
  customApiUrl: null,
  setCustomApiUrl: () => {},
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { network, setNetwork } = useUrlState();
  const { customUrl, setCustomUrl } = useCustomApi();
  const baseConfig = NETWORK_CONFIG[network];

  const config = useMemo(() => {
    if (!customUrl) return baseConfig;
    return {
      ...baseConfig,
      mempoolBaseUrl: customUrl,
      esploraBaseUrl: customUrl, // Disable fallback when custom URL is active
      explorerUrl: customUrl.replace(/\/api\/?$/, ""),
    };
  }, [baseConfig, customUrl]);

  const value = useMemo(
    () => ({
      network,
      setNetwork,
      config,
      customApiUrl: customUrl,
      setCustomApiUrl: setCustomUrl,
    }),
    [network, setNetwork, config, customUrl, setCustomUrl],
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
