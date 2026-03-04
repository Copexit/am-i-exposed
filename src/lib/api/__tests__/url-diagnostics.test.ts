import { describe, it, expect, vi, afterEach } from "vitest";
import { diagnoseUrl } from "../url-diagnostics";

describe("diagnoseUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults for invalid URLs", () => {
    const result = diagnoseUrl("not-a-url");
    expect(result.isMixedContent).toBe(false);
    expect(result.isOnion).toBe(false);
    expect(result.isLocal).toBe(false);
    expect(result.hint).toBeNull();
  });

  it("detects .onion addresses", () => {
    const result = diagnoseUrl("http://abc123.onion/api");
    expect(result.isOnion).toBe(true);
  });

  it("detects localhost as local", () => {
    const result = diagnoseUrl("http://localhost:3006/api");
    expect(result.isLocal).toBe(true);
  });

  it("detects private IPs as local", () => {
    expect(diagnoseUrl("http://192.168.1.100:3006/api").isLocal).toBe(true);
    expect(diagnoseUrl("http://10.0.0.1:3006/api").isLocal).toBe(true);
    expect(diagnoseUrl("http://172.16.0.1:3006/api").isLocal).toBe(true);
  });

  it("detects .local hostnames as local", () => {
    expect(diagnoseUrl("http://umbrel.local:3006/api").isLocal).toBe(true);
  });

  it("detects missing /api suffix for node-like URLs", () => {
    const result = diagnoseUrl("http://localhost:3006");
    expect(result.isMissingApiSuffix).toBe(true);
    expect(result.hint).toContain("/api");
  });

  it("does not flag /api suffix for public URLs without port", () => {
    const result = diagnoseUrl("https://mempool.space");
    expect(result.isMissingApiSuffix).toBe(false);
  });

  it("does not flag /api suffix when present", () => {
    const result = diagnoseUrl("http://localhost:3006/api");
    expect(result.isMissingApiSuffix).toBe(false);
  });

  it("does not flag known mempool.space .onion", () => {
    const result = diagnoseUrl("http://mempoolhqx4isw62xs7.onion/api");
    expect(result.hint).toBeNull();
  });
});
