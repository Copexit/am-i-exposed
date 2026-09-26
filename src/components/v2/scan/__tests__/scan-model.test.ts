import { describe, it, expect } from "vitest";
import { scanStages, summarizeSteps, impactSeverity, apiHost } from "../scan-model";
import type { HeuristicStep } from "@/lib/analysis/orchestrator";

const fp = (status: "fetching-tx" | "tracing-backward" | "tracing-forward" | "done") =>
  ({ status, timeoutSec: 30, currentDepth: 1, maxDepth: 3, txsFetched: 4 });

describe("scanStages", () => {
  it("walks the tx pipeline", () => {
    const states = (s: ReturnType<typeof scanStages>) => s.map((x) => x.state).join(",");
    expect(states(scanStages("txid", "fetching", null))).toBe("active,pending,pending,pending");
    expect(states(scanStages("txid", "fetching", fp("tracing-backward")))).toBe("done,active,pending,pending");
    expect(states(scanStages("txid", "fetching", fp("tracing-forward")))).toBe("done,done,active,pending");
    expect(states(scanStages("txid", "analyzing", fp("done")))).toBe("done,done,done,active");
  });
  it("has no trace for addresses and only checks for PSBTs", () => {
    expect(scanStages("address", "fetching", null).map((s) => s.id)).toEqual(["fetch", "checks"]);
    expect(scanStages("psbt", "analyzing", null)).toEqual([{ id: "checks", state: "active" }]);
  });
});

describe("summarizeSteps", () => {
  const steps: HeuristicStep[] = [
    { id: "a", label: "A", status: "done", impact: -80 },
    { id: "b", label: "B", status: "done", impact: 0 },
    { id: "c", label: "C", status: "running" },
    { id: "d", label: "D", status: "pending" },
  ];
  it("counts, finds the running step and sums raw impact (not a score)", () => {
    expect(summarizeSteps(steps, "txid")).toEqual({ done: 2, runningIndex: 2, impact: -80, hasImpact: true });
    expect(summarizeSteps(steps.slice(2), "address")).toEqual({ done: 0, runningIndex: 0, impact: 0, hasImpact: false });
  });
});

describe("helpers", () => {
  it("maps impact sign to a severity", () => {
    expect([impactSeverity(5), impactSeverity(-3), impactSeverity(0), impactSeverity(undefined)])
      .toEqual(["good", "critical", null, null]);
  });
  it("extracts the api host", () => {
    expect(apiHost("https://mempool.space/api")).toBe("mempool.space");
    expect(apiHost("/api")).toBeNull();
  });
});
