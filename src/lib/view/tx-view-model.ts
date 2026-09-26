import type { Finding, Grade, ScoringResult, TxType } from "@/lib/types";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import { getSummarySentiment, type SummarySentiment } from "@/lib/scoring/score";
import { isCoinJoinFinding } from "@/lib/analysis/heuristics/coinjoin";
import { visibleFindings, isStatusFinding, groupFindings, countFindings, buildExposureMatrix, type FindingGroups, type FindingCounts, type ExposureMatrix } from "./findings";
import { buildScoreWaterfall, type ScoreWaterfall } from "./waterfall";
import { buildTxIoView, type TxIoView } from "./tx-io";

export interface ResultViewModel {
  score: number;
  grade: Grade;
  txType: TxType | undefined;
  partial: boolean;
  sentiment: SummarySentiment;
  /** Every finding the engine emitted (feeds the score). */
  all: Finding[];
  /** Findings shown to the user (see visibleFindings). */
  visible: Finding[];
  /** Analysis status notices (incomplete fetches, partial traces). */
  status: Finding[];
  groups: FindingGroups;
  counts: FindingCounts;
  waterfall: ScoreWaterfall;
  exposure: ExposureMatrix;
  isCoinJoin: boolean;
  /** h11 wallet guess, when the engine made one. */
  walletGuess: string | null;
  /** Per-input/output tags (transactions only). */
  io: TxIoView | null;
}

export interface ViewModelInput {
  result: ScoringResult;
  baseScore: number;
  tx?: MempoolTransaction | null;
  outspends?: readonly MempoolOutspend[] | null;
  entityName?: (address: string) => string | null;
}

/**
 * The single source of truth for everything the v2 results UI displays.
 * Pure: derives from the engine result and raw data, never re-runs heuristics.
 */
export function buildResultViewModel({ result, baseScore, tx, outspends, entityName }: ViewModelInput): ResultViewModel {
  const visible = visibleFindings(result.findings);
  const walletGuess = result.findings.find((f) => f.id === "h11-wallet-fingerprint")?.params?.walletGuess;
  return {
    score: result.score,
    grade: result.grade,
    txType: result.txType,
    partial: result.partial === true,
    sentiment: getSummarySentiment(result.grade, result.findings),
    all: result.findings,
    visible,
    status: result.findings.filter(isStatusFinding),
    groups: groupFindings(visible),
    counts: countFindings(visible),
    waterfall: buildScoreWaterfall(result.findings, baseScore),
    exposure: buildExposureMatrix(visible),
    isCoinJoin: result.findings.some(isCoinJoinFinding),
    walletGuess: walletGuess !== undefined ? String(walletGuess) : null,
    // Tags come from visible findings only, so every tag links to a finding the user can open.
    io: tx ? buildTxIoView(tx, visible, outspends, entityName) : null,
  };
}
