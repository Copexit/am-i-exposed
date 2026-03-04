import { describe, it, expect } from "vitest";
import { isValidNetwork, NETWORK_CONFIG, DEFAULT_NETWORK } from "../networks";

describe("isValidNetwork", () => {
  it("accepts mainnet", () => {
    expect(isValidNetwork("mainnet")).toBe(true);
  });

  it("accepts testnet4", () => {
    expect(isValidNetwork("testnet4")).toBe(true);
  });

  it("accepts signet", () => {
    expect(isValidNetwork("signet")).toBe(true);
  });

  it("rejects invalid network names", () => {
    expect(isValidNetwork("testnet")).toBe(false);
    expect(isValidNetwork("regtest")).toBe(false);
    expect(isValidNetwork("")).toBe(false);
    expect(isValidNetwork("MAINNET")).toBe(false);
  });
});

describe("NETWORK_CONFIG", () => {
  it("has config for all three networks", () => {
    expect(Object.keys(NETWORK_CONFIG)).toEqual(["mainnet", "testnet4", "signet"]);
  });

  it("mainnet has onion URL", () => {
    expect(NETWORK_CONFIG.mainnet.mempoolOnionUrl).toContain(".onion");
  });

  it("testnet4 and signet lack onion URL", () => {
    expect(NETWORK_CONFIG.testnet4.mempoolOnionUrl).toBeUndefined();
    expect(NETWORK_CONFIG.signet.mempoolOnionUrl).toBeUndefined();
  });

  it("all configs have required fields", () => {
    for (const [, config] of Object.entries(NETWORK_CONFIG)) {
      expect(config.label).toBeTruthy();
      expect(config.mempoolBaseUrl).toMatch(/^https:\/\//);
      expect(config.esploraBaseUrl).toMatch(/^https:\/\//);
      expect(config.explorerUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("DEFAULT_NETWORK", () => {
  it("is mainnet", () => {
    expect(DEFAULT_NETWORK).toBe("mainnet");
  });
});
