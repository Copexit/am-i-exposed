import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiClient } from "../client";
import type { NetworkConfig } from "@/lib/bitcoin/networks";

// Mock the mempool module
vi.mock("../mempool", () => ({
  createMempoolClient: vi.fn(),
}));

import { createMempoolClient } from "../mempool";
const mockCreateClient = vi.mocked(createMempoolClient);

const MAINNET_CONFIG: NetworkConfig = {
  label: "Mainnet",
  mempoolBaseUrl: "https://mempool.space/api",
  explorerUrl: "https://mempool.space",
};

const TESTNET_CONFIG: NetworkConfig = {
  label: "Testnet",
  mempoolBaseUrl: "https://mempool.space/testnet4/api",
  explorerUrl: "https://mempool.space/testnet4",
};

function makeMockClient(overrides: Record<string, unknown> = {}) {
  return {
    getTransaction: vi.fn().mockResolvedValue({ txid: "abc" }),
    getTxHex: vi.fn().mockResolvedValue("0200..."),
    getAddress: vi.fn().mockResolvedValue({ address: "bc1q..." }),
    getAddressTxs: vi.fn().mockResolvedValue([]),
    getAddressUtxos: vi.fn().mockResolvedValue([]),
    getTxOutspends: vi.fn().mockResolvedValue([]),
    getHistoricalPrice: vi.fn().mockResolvedValue(50_000),
    getHistoricalEurPrice: vi.fn().mockResolvedValue(45_000),
    ...overrides,
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("createApiClient", () => {
  it("creates a client using the configured mempool URL", () => {
    mockCreateClient.mockReturnValue(makeMockClient() as ReturnType<typeof createMempoolClient>);
    createApiClient(MAINNET_CONFIG);
    expect(mockCreateClient).toHaveBeenCalledWith("https://mempool.space/api", expect.objectContaining({ timeoutMs: 15_000 }));
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it("passes abort signal to underlying client", () => {
    const abortController = new AbortController();
    mockCreateClient.mockReturnValue(makeMockClient() as ReturnType<typeof createMempoolClient>);
    createApiClient(MAINNET_CONFIG, abortController.signal);
    expect(mockCreateClient).toHaveBeenCalledWith("https://mempool.space/api", expect.objectContaining({ signal: abortController.signal }));
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it("returns all API methods", () => {
    mockCreateClient.mockReturnValue(makeMockClient() as ReturnType<typeof createMempoolClient>);
    const client = createApiClient(MAINNET_CONFIG);
    expect(client.getTransaction).toBeDefined();
    expect(client.getTxHex).toBeDefined();
    expect(client.getAddress).toBeDefined();
    expect(client.getAddressTxs).toBeDefined();
    expect(client.getAddressUtxos).toBeDefined();
    expect(client.getTxOutspends).toBeDefined();
    expect(client.getHistoricalPrice).toBeDefined();
    expect(client.getHistoricalEurPrice).toBeDefined();
  });

  it("delegates calls to the mempool client", async () => {
    const mock = makeMockClient();
    mockCreateClient.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);
    const client = createApiClient(MAINNET_CONFIG);
    const result = await client.getTransaction("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345");
    expect(mock.getTransaction).toHaveBeenCalled();
    expect(result).toEqual({ txid: "abc" });
  });

  it("works with testnet config", async () => {
    const mock = makeMockClient();
    mockCreateClient.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);
    const client = createApiClient(TESTNET_CONFIG);
    expect(mockCreateClient).toHaveBeenCalledWith("https://mempool.space/testnet4/api", expect.objectContaining({ timeoutMs: 15_000 }));
    const result = await client.getTransaction("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345");
    expect(result).toEqual({ txid: "abc" });
  });

  it("getHistoricalPrice returns price data", async () => {
    const mock = makeMockClient({
      getHistoricalPrice: vi.fn().mockResolvedValue(67_500),
    });
    mockCreateClient.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);
    const client = createApiClient(MAINNET_CONFIG);
    const price = await client.getHistoricalPrice(1700000000);
    expect(price).toBe(67_500);
    expect(mock.getHistoricalPrice).toHaveBeenCalledWith(1700000000);
  });

  it("getHistoricalEurPrice returns EUR price data", async () => {
    const mock = makeMockClient({
      getHistoricalEurPrice: vi.fn().mockResolvedValue(62_000),
    });
    mockCreateClient.mockReturnValue(mock as ReturnType<typeof createMempoolClient>);
    const client = createApiClient(MAINNET_CONFIG);
    const price = await client.getHistoricalEurPrice(1700000000);
    expect(price).toBe(62_000);
    expect(mock.getHistoricalEurPrice).toHaveBeenCalledWith(1700000000);
  });
});
