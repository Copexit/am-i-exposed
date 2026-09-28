import { describe, it, expect } from "vitest";
import { shareUrl } from "../share-url";

describe("shareUrl", () => {
  it("mainnet links carry no network parameter", () => {
    expect(shareUrl("abc", "txid", "mainnet")).toBe("https://am-i.exposed/#tx=abc");
  });
  it("other networks keep ?network= so the link opens on the right chain", () => {
    expect(shareUrl("tb1qx", "address", "testnet4")).toBe("https://am-i.exposed/?network=testnet4#addr=tb1qx");
    expect(shareUrl("abc", "txid", "signet")).toBe("https://am-i.exposed/?network=signet#tx=abc");
  });
});
