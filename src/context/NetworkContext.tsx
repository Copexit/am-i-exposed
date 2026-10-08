"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
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
import {
  detectBackendChain,
  isSupportedChain,
  genesisCacheKey,
  knownBackendChain,
  subscribeBackendChains,
  type BackendChain,
} from "@/lib/api/backend-network";
import { idbChainStore } from "@/lib/api/idb-cache";

/**
 * Which network the app runs on. A self-hosted backend (Umbrel / StartOS, or a
 * custom URL) serves one chain, read from its genesis block hash
 * (backend-network.ts): a supported one pins the network (?network= and
 * saved-graph networks apply only when they match), an unsupported one
 * (testnet3, regtest, an unknown genesis) is reported, not treated as mainnet.
 * Umbrel falls back to the packager hint, then mainnet, when the node cannot
 * be asked; a custom URL that cannot be asked keeps the selected network.
 */
export function resolveBackendNetwork(
  chain: BackendChain | null | undefined,
  { isUmbrel, selected }: { isUmbrel: boolean; selected: BitcoinNetwork },
): { network: BitcoinNetwork; pinned: boolean; unsupportedChain: BackendChain | null } {
  if (chain && isSupportedChain(chain)) return { network: chain, pinned: true, unsupportedChain: null };
  return {
    network: isUmbrel ? DEFAULT_NETWORK : selected,
    pinned: isUmbrel,
    unsupportedChain: chain ?? null,
  };
}

/**
 * Chain of a custom API URL, re-asked on every load (a node can switch chains
 * behind the same URL). The value stored by the last load is shown at once,
 * but `verified` stays false until the backend answers.
 * chain: undefined while nothing is known, null when the backend could not be asked.
 */
function useCustomBackendChain(customUrl: string | null): { chain: BackendChain | null | undefined; verified: boolean } {
  const known = useSyncExternalStore(
    subscribeBackendChains,
    () => (customUrl ? knownBackendChain(customUrl) : undefined),
    () => undefined,
  );
  const [check, setCheck] = useState<{ url: string; stored?: BackendChain; failed?: boolean } | null>(null);
  useEffect(() => {
    // Already asked during this page load (e.g. by settings "Apply")
    if (!customUrl || knownBackendChain(customUrl)) return;
    const ac = new AbortController();
    void idbChainStore.get(genesisCacheKey(customUrl)).then((stored) => {
      if (stored && !ac.signal.aborted) setCheck((c) => (c?.url === customUrl ? c : { url: customUrl, stored }));
    }, () => {});
    void detectBackendChain(customUrl, { store: idbChainStore, refresh: true, signal: ac.signal }).then((chain) => {
      if (!chain && !ac.signal.aborted) setCheck({ url: customUrl, failed: true });
    });
    return () => ac.abort();
  }, [customUrl]);
  if (!customUrl) return { chain: null, verified: true };
  if (known) return { chain: known, verified: true };
  const mine = check?.url === customUrl ? check : null;
  if (mine?.failed) return { chain: null, verified: true };
  return { chain: mine?.stored, verified: false };
}

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
  /**
   * `isUmbrel` is final (Umbrel known, or the local API probe settled). Enough for
   * services routed only by isUmbrel (Observatory), which need not wait for Tor detection.
   */
  routeReady: boolean;
  /** The network is set by the backend (Umbrel, or a custom URL that reported a supported chain). */
  networkPinned: boolean;
  /**
   * Chain the self-hosted backend reported (a custom URL shows last load's value
   * until re-asked): undefined while checking, null when unknown (public
   * mempool.space, or the backend could not be asked).
   */
  backendChain: BackendChain | null | undefined;
  /** The backend serves a chain the app does not support (testnet3, regtest, unknown genesis). */
  unsupportedChain: BackendChain | null;
  /** The backend could not report its chain: `network` is assumed, not verified. */
  networkUnverified: boolean;
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
  routeReady: false,
  networkPinned: false,
  backendChain: null,
  unsupportedChain: null,
  networkUnverified: false,
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
  const custom = useCustomBackendChain(isUmbrel ? null : customUrl);
  const localApiStatus = localApi.status;
  // Hold Tor detection until the local API probe settles. On Umbrel or with a
  // custom API (own node) it never fires: resolveNetworkConfig ignores Tor there,
  // so the probe would only leak the IP to Cloudflare and mempool.space.
  // On Umbrel, phase 1 sets isUmbrel before the status settles, so skip wins.
  const skipTor = isUmbrel || !!customUrl;
  const torStatus = useTorDetection(skipTor, !skipTor && localApiStatus === "checking");

  const backendChain = isUmbrel ? localApi.chain : customUrl ? custom.chain : null;
  // The backend's network is assumed (Umbrel: mainnet; custom URL: the selected one), not reported
  const networkUnverified = backendChain === null && (isUmbrel ? localApiStatus !== "checking" : !!customUrl && custom.verified);
  const { network, pinned, unsupportedChain } = resolveBackendNetwork(backendChain, { isUmbrel, selected: url.network });
  const urlSetNetwork = url.setNetwork;
  const setNetwork = useCallback(
    (n: BitcoinNetwork) => {
      if (!pinned) urlSetNetwork(n);
    },
    [pinned, urlSetNetwork],
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
      // On Umbrel the node's chain is known once its probe settles; a custom URL waits for its re-check
      apiReady: localApiStatus !== "checking" && torStatus !== "checking" && (isUmbrel || custom.verified),
      routeReady: isUmbrel || localApiStatus !== "checking",
      networkPinned: pinned,
      backendChain,
      unsupportedChain,
      networkUnverified,
    }),
    [network, setNetwork, config, configFor, customUrl, setCustomUrl, torStatus, localApiStatus, isUmbrel, pinned, backendChain, unsupportedChain, networkUnverified, custom.verified],
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
