import { describe, it, expect } from "vitest";
import { isValidNetwork, resolveNetwork, NETWORK_CONFIG, DEFAULT_NETWORK } from "../networks";

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
    expect(isValidNetwork("testnet3")).toBe(false);
    expect(isValidNetwork("toString")).toBe(false);
    expect(isValidNetwork("__proto__")).toBe(false);
    expect(isValidNetwork("regtest")).toBe(false);
    expect(isValidNetwork("")).toBe(false);
    expect(isValidNetwork("MAINNET")).toBe(false);
  });
});

describe("NETWORK_CONFIG", () => {
  it("has config for exactly mainnet, testnet4 and signet", () => {
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
      expect(config.explorerUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("DEFAULT_NETWORK", () => {
  it("is mainnet", () => {
    expect(DEFAULT_NETWORK).toBe("mainnet");
  });
});

describe("resolveNetwork", () => {
  it("prefers a valid ?network= value over the saved one", () => {
    expect(resolveNetwork("signet", "testnet4")).toBe("signet");
  });

  it("uses the saved value when the URL has none", () => {
    expect(resolveNetwork(null, "testnet4")).toBe("testnet4");
  });

  it("defaults to mainnet when nothing is set", () => {
    expect(resolveNetwork(null, null)).toBe("mainnet");
  });

  it("migrates a retired testnet3 URL or saved value to mainnet", () => {
    expect(resolveNetwork("testnet3", null)).toBe("mainnet");
    expect(resolveNetwork(null, "testnet3")).toBe("mainnet");
    expect(resolveNetwork("testnet3", "testnet3")).toBe("mainnet");
  });

  it("ignores an unsupported URL value and keeps a valid saved one", () => {
    expect(resolveNetwork("testnet3", "signet")).toBe("signet");
  });
});
