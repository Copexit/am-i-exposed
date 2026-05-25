/**
 * Type definitions for the CoinJoin Observatory.
 *
 * These mirror the live JSON shapes returned by:
 * - whirlpool.observer/api/{summary,charts} (REST)
 * - liquisabi.com/api (JSON-RPC 2.0, method "dashboard")
 *
 * Field names match the upstream exactly to keep selectors trivial.
 */

// ---------- whirlpool.observer ----------

export interface WhirlpoolPoolStats {
  pool: string;
  label: string;
  color: string;
  poolsize_btc: number;
  unspent_btc: number;
  unspent_utxos: number;
  unmixed_btc: number;
  unmixed_utxos: number;
  utxos_in_pool: number;
  cycles: number;
  mixed_count: number;
  exited_count: number;
  removed_count: number;
  tx0_count: number;
  total_premix_outputs: number;
  avg_fee_paid_pct: number;
}

export interface WhirlpoolSummary {
  title: string;
  is_synced: boolean;
  progress_pct: number;
  tip_height: number;
  last_processed_block: number;
  current_processing_block: number;
  start_block_height: number;
  last_report_refresh_ts: number;
  next_update_seconds: number;
  rescan_hours: number;
  api_url: string;
  fallback_api_url: string;
  pools: WhirlpoolPoolStats[];
}

export interface WhirlpoolChartSeries {
  blocks: number[];
  series: Record<string, number[]>;
}

export interface WhirlpoolUtxoSeries {
  blocks: number[];
  total_utxos: number[];
}

export interface WhirlpoolCharts {
  capacity: WhirlpoolChartSeries;
  poolsize: WhirlpoolChartSeries;
  utxos: WhirlpoolUtxoSeries;
  utxos_in_pool: WhirlpoolUtxoSeries;
}

// ---------- liquisabi.com ----------

export interface LiquiSabiSavedRound {
  CoordinatorEndpoint: string;
  EstimatedCoordinatorEarningsSats: number;
  RoundId: string;
  IsBlame: boolean;
  CoordinationFeeRate: number;
  MinInputCount: number;
  ParametersMiningFeeRate: number;
  RoundStartTime: string;
  RoundEndTime: string;
  TxId: string;
  FinalMiningFeeRate: number;
  VirtualSize: number;
  TotalMiningFee: number;
  InputCount: number;
  TotalInputAmount: number;
  FreshInputsEstimateBtc: number;
  AverageStandardInputsAnonSet: number;
  OutputCount: number;
  TotalOutputAmount: number;
  ChangeOutputsAmountRatio: number;
  AverageStandardOutputsAnonSet: number;
  TotalLeftovers: number;
}

export interface LiquiSabiCoordinatorMeta {
  PubKey: string;
  Endpoint: string;
  LastUpdate: string;
  Name: string;
  Content: string;
  ReadMore: string;
  AbsoluteMinInputCount: string;
}

export interface LiquiSabiCoordinator {
  Coordinator: LiquiSabiCoordinatorMeta;
  FreshInputPercent: number;
  NbRounds: number;
}

export interface LiquiSabiGraphEntry {
  Date: string;
  Averages: LiquiSabiSavedRound | null;
}

export interface LiquiSabiPaginatedRounds {
  Rounds: LiquiSabiSavedRound[];
  TotalCount: number;
  Page: number;
  PageSize: number;
  TotalPages: number;
  Statistics: unknown;
}

export interface LiquiSabiDashboard {
  Summary: LiquiSabiSavedRound | null;
  Totals: LiquiSabiSavedRound | null;
  PaginatedRounds: LiquiSabiPaginatedRounds;
  Graph: LiquiSabiGraphEntry[];
  Coordinators: LiquiSabiCoordinator[];
}

// ---------- Aggregated view models (used by UI) ----------

export interface CoordinatorView {
  endpoint: string;
  name: string;
  readMore: string;
  description: string;
  freshInputPercent: number;
  roundCount: number;
  isPaid: boolean;
}

export interface SparklinePoint {
  x: number;
  y: number;
}
