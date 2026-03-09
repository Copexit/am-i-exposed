import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiClient } from "../client";
import { ApiError } from "../fetch-with-retry";
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
  esploraBaseUrl: "https://blockstream.info/api",
  explorerUrl: "https://mempool.space",
};

const TESTNET_CONFIG: NetworkConfig = {
  label: "Testnet",
  mempoolBaseUrl: "https://mempool.space/testnet4/api",
  esploraBaseUrl: "https://mempool.space/testnet4/api",
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
  it("uses primary client for successful requests", async () => {
    const primary = makeMockClient();
    mockCreateClient.mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>);
    // No fallback since same URL for testnet
    const client = createApiClient(TESTNET_CONFIG);
    const result = await client.getTransaction("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345");
    expect(primary.getTransaction).toHaveBeenCalled();
    expect(result).toEqual({ txid: "abc" });
  });

  it("falls back to esplora on API_UNAVAILABLE for mainnet", async () => {
    const primary = makeMockClient({
      getTransaction: vi.fn().mockRejectedValue(new ApiError("API_UNAVAILABLE", "503")),
    });
    const fallback = makeMockClient({
      getTransaction: vi.fn().mockResolvedValue({ txid: "from-fallback" }),
    });
    mockCreateClient
      .mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>)
      .mockReturnValueOnce(fallback as ReturnType<typeof createMempoolClient>);

    const client = createApiClient(MAINNET_CONFIG);
    const result = await client.getTransaction("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345");
    expect(primary.getTransaction).toHaveBeenCalled();
    expect(fallback.getTransaction).toHaveBeenCalled();
    expect(result).toEqual({ txid: "from-fallback" });
  });

  it("falls back to esplora on NETWORK_ERROR for mainnet", async () => {
    const primary = makeMockClient({
      getTxHex: vi.fn().mockRejectedValue(new ApiError("NETWORK_ERROR", "fetch failed")),
    });
    const fallback = makeMockClient({
      getTxHex: vi.fn().mockResolvedValue("deadbeef"),
    });
    mockCreateClient
      .mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>)
      .mockReturnValueOnce(fallback as ReturnType<typeof createMempoolClient>);

    const client = createApiClient(MAINNET_CONFIG);
    const result = await client.getTxHex("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345");
    expect(result).toBe("deadbeef");
  });

  it("does not fall back for non-retryable errors", async () => {
    const primary = makeMockClient({
      getTransaction: vi.fn().mockRejectedValue(new ApiError("NOT_FOUND", "not found")),
    });
    const fallback = makeMockClient();
    mockCreateClient
      .mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>)
      .mockReturnValueOnce(fallback as ReturnType<typeof createMempoolClient>);

    const client = createApiClient(MAINNET_CONFIG);
    await expect(client.getTransaction("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345"))
      .rejects.toThrow("not found");
    expect(fallback.getTransaction).not.toHaveBeenCalled();
  });

  it("does not fall back on testnet (same base URLs)", async () => {
    const primary = makeMockClient({
      getTransaction: vi.fn().mockRejectedValue(new ApiError("API_UNAVAILABLE", "503")),
    });
    mockCreateClient.mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>);

    const client = createApiClient(TESTNET_CONFIG);
    await expect(client.getTransaction("abc123def456abc123def456abc123def456abc123def456abc123def456abc12345"))
      .rejects.toThrow("503");
  });

  it("throws non-ApiError errors without fallback", async () => {
    const primary = makeMockClient({
      getAddress: vi.fn().mockRejectedValue(new TypeError("unexpected")),
    });
    const fallback = makeMockClient();
    mockCreateClient
      .mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>)
      .mockReturnValueOnce(fallback as ReturnType<typeof createMempoolClient>);

    const client = createApiClient(MAINNET_CONFIG);
    await expect(client.getAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"))
      .rejects.toThrow("unexpected");
    expect(fallback.getAddress).not.toHaveBeenCalled();
  });

  it("exposes all six methods", () => {
    mockCreateClient.mockReturnValue(makeMockClient() as ReturnType<typeof createMempoolClient>);
    const client = createApiClient(MAINNET_CONFIG);
    expect(client.getTransaction).toBeDefined();
    expect(client.getTxHex).toBeDefined();
    expect(client.getAddress).toBeDefined();
    expect(client.getAddressTxs).toBeDefined();
    expect(client.getAddressUtxos).toBeDefined();
    expect(client.getHistoricalPrice).toBeDefined();
  });

  it("getHistoricalPrice calls mempool directly (no esplora fallback)", async () => {
    const primary = makeMockClient({
      getHistoricalPrice: vi.fn().mockResolvedValue(67_500),
    });
    const fallback = makeMockClient();
    mockCreateClient
      .mockReturnValueOnce(primary as ReturnType<typeof createMempoolClient>)
      .mockReturnValueOnce(fallback as ReturnType<typeof createMempoolClient>);

    const client = createApiClient(MAINNET_CONFIG);
    const price = await client.getHistoricalPrice(1700000000);
    expect(price).toBe(67_500);
    expect(primary.getHistoricalPrice).toHaveBeenCalledWith(1700000000);
  });
});
