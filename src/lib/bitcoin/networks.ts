export type BitcoinNetwork = "mainnet" | "testnet4" | "signet";

export interface NetworkConfig {
  label: string;
  mempoolBaseUrl: string;
  esploraBaseUrl: string;
  explorerUrl: string;
}

export const NETWORK_CONFIG: Record<BitcoinNetwork, NetworkConfig> = {
  mainnet: {
    label: "Mainnet",
    mempoolBaseUrl: "https://mempool.space/api",
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
