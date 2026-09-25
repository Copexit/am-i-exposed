import { describe, it, expect } from "vitest";
import { analyzeDestination } from "../address-orchestrator";
import { makeAddress } from "../heuristics/__tests__/fixtures/tx-factory";
import { makeOfacPreSendResult } from "@/lib/analysis/analysis-state";
import ofacData from "@/data/ofac-addresses.json";

const t = (_key: string, opts?: Record<string, unknown>) => String(opts?.defaultValue ?? "");

describe("pre-send findings carry finding metadata", () => {
  it("analyzeDestination enriches h13-presend-check and h13-ofac-match", async () => {
    const result = await analyzeDestination(makeAddress({ address: ofacData.addresses[0] }), [], []);
    const presend = result.findings.find((f) => f.id === "h13-presend-check");
    const ofac = result.findings.find((f) => f.id === "h13-ofac-match");
    expect(presend?.adversaryTiers?.length).toBeGreaterThan(0);
    expect(presend?.temporality).toBeDefined();
    expect(ofac?.adversaryTiers?.length).toBeGreaterThan(0);
    expect(ofac?.temporality).toBeDefined();
  });

  it("makeOfacPreSendResult enriches both findings", () => {
    for (const f of makeOfacPreSendResult(t).findings) {
      expect(f.adversaryTiers?.length, f.id).toBeGreaterThan(0);
      expect(f.temporality, f.id).toBeDefined();
    }
  });
});
