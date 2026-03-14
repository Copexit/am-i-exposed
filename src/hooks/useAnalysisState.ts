import type { ScoringResult, InputType, TxAnalysisResult, Finding } from "@/lib/types";
import type { MempoolTransaction, MempoolAddress, MempoolUtxo, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/hooks/useBoltzmann";
import type { HeuristicStep, PreSendResult } from "@/lib/analysis/orchestrator";
import type { PSBTParseResult } from "@/lib/bitcoin/psbt";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";

export type AnalysisPhase =
  | "idle"
  | "fetching"
  | "analyzing"
  | "complete"
  | "error";

export interface FetchProgress {
  status: "fetching-tx" | "tracing-backward" | "tracing-forward" | "done";
  timeoutSec: number;
  currentDepth: number;
  maxDepth: number;
  txsFetched: number;
}

export interface AnalysisState {
  phase: AnalysisPhase;
  query: string | null;
  inputType: InputType | null;
  steps: HeuristicStep[];
  result: ScoringResult | null;
  txData: MempoolTransaction | null;
  addressData: MempoolAddress | null;
  addressTxs: MempoolTransaction[] | null;
  addressUtxos: MempoolUtxo[] | null;
  txBreakdown: TxAnalysisResult[] | null;
  preSendResult: PreSendResult | null;
  error: string | null;
  /** Error classification for UI logic (e.g. hide retry on non-retryable errors) */
  errorCode: "retryable" | "not-retryable" | null;
  durationMs: number | null;
  /** USD per BTC at the time the transaction was confirmed (mainnet only). */
  usdPrice: number | null;
  /** Per-output spend status (null = not fetched yet). */
  outspends: MempoolOutspend[] | null;
  /** Parsed PSBT metadata (only set when input is a PSBT). */
  psbtData: PSBTParseResult | null;
  /** Progress during fetch/trace phase. */
  fetchProgress: FetchProgress | null;
  /** Backward trace layers from recursive tracing. */
  backwardLayers: TraceLayer[] | null;
  /** Forward trace layers from recursive tracing. */
  forwardLayers: TraceLayer[] | null;
  /** Whether this result was loaded from the analysis result cache. */
  fromCache?: boolean;
  /** Boltzmann link probability result (null = not computed yet or unsupported). */
  boltzmannResult: BoltzmannWorkerResult | null;
  /** Boltzmann computation status. */
  boltzmannStatus: "idle" | "computing" | "complete" | "error" | "unsupported" | null;
}

export const INITIAL_STATE: AnalysisState = {
  phase: "idle",
  query: null,
  inputType: null,
  steps: [],
  result: null,
  txData: null,
  addressData: null,
  addressTxs: null,
  addressUtxos: null,
  txBreakdown: null,
  preSendResult: null,
  error: null,
  errorCode: null,
  durationMs: null,
  usdPrice: null,
  outspends: null,
  psbtData: null,
  fetchProgress: null,
  backwardLayers: null,
  forwardLayers: null,
  boltzmannResult: null,
  boltzmannStatus: null,
};

/** Build a finding for missing prevout data after enrichment. */
export function makeIncompletePrevoutFinding(remainingNulls: number, isAddress = false): Finding {
  return {
    id: "api-incomplete-prevout",
    severity: "low",
    title: `${remainingNulls} input${remainingNulls > 1 ? "s" : ""} missing data${isAddress ? " across transactions" : ""}`,
    description:
      `Could not retrieve full data for ${remainingNulls} transaction input${remainingNulls > 1 ? "s" : ""}. ` +
      "Some heuristics (CIOH, entropy, change detection, script type analysis) may be incomplete. " +
      "This typically happens with self-hosted mempool instances.",
    recommendation:
      "For complete analysis, try using the public mempool.space API or upgrade your self-hosted instance to mempool/electrs.",
    scoreImpact: 0,
  };
}

/** Build the PreSendResult for an OFAC-sanctioned address. */
export function makeOfacPreSendResult(
  t: (key: string, opts?: Record<string, unknown>) => string,
): PreSendResult {
  return {
    riskLevel: "CRITICAL",
    summaryKey: "presend.adviceCritical",
    summary: t("presend.adviceCritical", { defaultValue: "Do NOT send to this address. It poses severe privacy or legal risks." }),
    findings: [
      {
        id: "h13-presend-check",
        severity: "critical",
        params: { riskLevel: "CRITICAL" },
        title: t("finding.h13-presend-check.title", { riskLevel: "CRITICAL", defaultValue: "Destination risk: CRITICAL" }),
        description: t("presend.adviceCritical", { defaultValue: "Do NOT send to this address. It poses severe privacy or legal risks." }),
        recommendation: t("finding.h13-ofac-match.recommendation", { defaultValue: "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address." }),
        scoreImpact: 0,
      },
      {
        id: "h13-ofac-match",
        severity: "critical",
        title: t("finding.h13-ofac-match.title", { defaultValue: "OFAC sanctioned address" }),
        description: t("finding.h13-ofac-match.description", { defaultValue: "This address matches an entry on the U.S. Treasury OFAC Specially Designated Nationals (SDN) list. Transacting with sanctioned addresses may have serious legal consequences." }),
        recommendation: t("finding.h13-ofac-match.recommendation", { defaultValue: "Do NOT send funds to this address. Consult legal counsel if you have already transacted with this address." }),
        scoreImpact: -100,
      },
    ],
    txCount: 0,
    timesReceived: 0,
    totalReceived: 0,
  };
}

/** Mark all heuristic steps as done (used when analysis completes or errors). */
export function markAllDone(steps: HeuristicStep[]): HeuristicStep[] {
  return steps.map((s) => ({ ...s, status: "done" as const }));
}
