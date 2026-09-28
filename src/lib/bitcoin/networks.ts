export type BitcoinNetwork = "mainnet" | "testnet4" | "signet";

export interface NetworkConfig {
  label: string;
  mempoolBaseUrl: string;
  /** mempool.space v3 onion - used when Tor is detected (mainnet only) */
  mempoolOnionUrl?: string;
  explorerUrl: string;
}

export const NETWORK_CONFIG: Record<BitcoinNetwork, NetworkConfig> = {
  mainnet: {
    label: "Mainnet",
    mempoolBaseUrl: "https://mempool.space/api",
    mempoolOnionUrl: "http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api",
    explorerUrl: "https://mempool.space",
  },
  testnet4: {
    label: "Testnet4",
    mempoolBaseUrl: "https://mempool.space/testnet4/api",
    explorerUrl: "https://mempool.space/testnet4",
  },
  signet: {
    label: "Signet",
    mempoolBaseUrl: "https://mempool.space/signet/api",
    explorerUrl: "https://mempool.space/signet",
  },
};

export const DEFAULT_NETWORK: BitcoinNetwork = "mainnet";

export function isValidNetwork(value: string): value is BitcoinNetwork {
  return Object.hasOwn(NETWORK_CONFIG, value);
}

/**
 * Pick the active network from the ?network= query param (takes priority, for
 * shared links) and the saved preference. Unsupported values, such as the
 * retired "testnet3", are ignored, so the result falls back to mainnet.
 */
export function resolveNetwork(fromUrl: string | null, stored: string | null): BitcoinNetwork {
  if (fromUrl && isValidNetwork(fromUrl)) return fromUrl;
  if (stored && isValidNetwork(stored)) return stored;
  return DEFAULT_NETWORK;
}
