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

interface NetworkContextValue {
  network: BitcoinNetwork;
  setNetwork: (n: BitcoinNetwork) => void;
  config: NetworkConfig;
}

const NetworkContext = createContext<NetworkContextValue>({
  network: DEFAULT_NETWORK,
  setNetwork: () => {},
  config: NETWORK_CONFIG[DEFAULT_NETWORK],
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const { network, setNetwork } = useUrlState();
  const config = NETWORK_CONFIG[network];

  const value = useMemo(
    () => ({ network, setNetwork, config }),
    [network, setNetwork, config],
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
