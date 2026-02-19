export type BitcoinNetwork = "mainnet" | "testnet4" | "signet";

export interface NetworkConfig {
  label: string;
  mempoolBaseUrl: string;
  /** mempool.space v3 onion - used when Tor is detected (mainnet only) */
  mempoolOnionUrl?: string;
  esploraBaseUrl: string;
  explorerUrl: string;
}

export const NETWORK_CONFIG: Record<BitcoinNetwork, NetworkConfig> = {
  mainnet: {
    label: "Mainnet",
    mempoolBaseUrl: "https://mempool.space/api",
    mempoolOnionUrl: "http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion/api",
    esploraBaseUrl: "https://blockstream.info/api",
    explorerUrl: "https://mempool.space",
  },
  testnet4: {
    label: "Testnet4",
    mempoolBaseUrl: "https://mempool.space/testnet4/api",
    esploraBaseUrl: "https://mempool.space/testnet4/api",
    explorerUrl: "https://mempool.space/testnet4",
  },
  signet: {
    label: "Signet",
    mempoolBaseUrl: "https://mempool.space/signet/api",
    esploraBaseUrl: "https://mempool.space/signet/api",
    explorerUrl: "https://mempool.space/signet",
  },
};

export const DEFAULT_NETWORK: BitcoinNetwork = "mainnet";

export function isValidNetwork(value: string): value is BitcoinNetwork {
  return value === "mainnet" || value === "testnet4" || value === "signet";
}
