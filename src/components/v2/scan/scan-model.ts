import type { HeuristicStep } from "@/lib/analysis/orchestrator";
import type { FetchProgress } from "@/hooks/useAnalysis";
import type { Severity } from "@/lib/types";

export type StageId = "fetch" | "trace-back" | "trace-fwd" | "checks";
export type StageState = "pending" | "active" | "done";
export interface Stage { id: StageId; state: StageState }

/**
 * The pipeline stages a scan really goes through, and where it is now.
 * Transactions: fetch, trace inputs, trace outputs, checks. Addresses: fetch,
 * checks (no chain trace). PSBTs are parsed locally: checks only.
 */
export function scanStages(
  inputType: string | null,
  phase: "fetching" | "analyzing",
  fp: FetchProgress | null,
): Stage[] {
  const ids: StageId[] =
    inputType === "psbt" ? ["checks"]
      : inputType === "address" ? ["fetch", "checks"]
        : ["fetch", "trace-back", "trace-fwd", "checks"];
  let current: StageId = "fetch";
  if (phase === "analyzing" || fp?.status === "done") current = "checks";
  else if (fp?.status === "tracing-backward") current = "trace-back";
  else if (fp?.status === "tracing-forward") current = "trace-fwd";
  const at = ids.indexOf(current);
  return ids.map((id, i) => ({ id, state: i < at ? "done" : i === at ? "active" : "pending" }));
}

export interface StepSummary {
  done: number;
  /** Index of the running step, or -1. */
  runningIndex: number;
  /**
   * Sum of the impacts reported so far. This is NOT a score: cross-heuristic
   * rules and chain findings adjust the result after the checks run.
   */
  impact: number;
  /** True once any step has reported an impact. */
  hasImpact: boolean;
}

export function summarizeSteps(steps: HeuristicStep[], inputType: string | null): StepSummary {
  void inputType;
  let done = 0, impact = 0, hasImpact = false;
  for (const s of steps) {
    if (s.status === "done") done++;
    if (s.impact !== undefined) { impact += s.impact; hasImpact = true; }
  }
  return {
    done,
    runningIndex: steps.findIndex((s) => s.status === "running"),
    impact,
    hasImpact,
  };
}

/** Cell color while scanning: the only fact known per step is the sign of its impact. */
export function impactSeverity(impact: number | undefined): Severity | null {
  if (!impact) return null;
  return impact > 0 ? "good" : "critical";
}

/** Host of the API base URL (relative URLs such as "/api" resolve to null). */
export function apiHost(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host || null;
  } catch {
    return null;
  }
}
