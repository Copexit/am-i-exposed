/**
 * Type definitions for the CoinJoin Observatory.
 *
 * Whirlpool data is parsed by `workers/coinjoin-stats/parser.js` from
 * whirlpoolstats.xyz - the HTML root for headline numbers (lifetime entered,
 * lifetime cycles, last updated, block range) and `whirlpool_stats.csv` for
 * the per-block current-capacity time series.
 *
 * WabiSabi data is the unchanged LiquiSabi JSON-RPC `dashboard` method.
 */

// ---------- whirlpool (from whirlpoolstats.xyz via Worker/sidecar) ----------

export interface WhirlpoolPoolStats {
  /** Stable pool id, e.g. "0.025_BTC_Pool". */
  pool: string;
  /** Display label, e.g. "0.025 BTC Pool". */
  label: string;
  /** Hex color for the pool, assigned by parser. */
  color: string;
  /** Pool denomination in BTC (0.025 or 0.25). */
  denomination_btc: number;
  /** Lifetime cumulative BTC entered the pool (from HTML headline). */
  total_entered_btc: number;
  /** Lifetime mix-cycle count for this pool. */
  cycles: number;
}

export interface WhirlpoolSummary {
  title: string;
  /** ISO-8601 UTC of the upstream's "Last Updated" timestamp. */
  last_updated_iso: string;
  start_block_height: number;
  /** The most recent block whirlpoolstats has scanned to. */
  tip_block_height: number;
  /** Lifetime cumulative BTC entered across all pools. */
  total_entered_btc: number;
  pools: WhirlpoolPoolStats[];
}

/**
 * Per-block current-capacity time series for each pool.
 * Capacity = BTC currently in unspent/unmixed UTXOs of that pool at that
 * block height. It OSCILLATES (goes up on TX0s, down on exits) - it is not
 * a cumulative metric.
 */
export interface WhirlpoolCharts {
  blocks: number[];
  capacity_btc: { [pool: string]: number[] };
}

export interface WhirlpoolStructuredError {
  error: {
    code:
      | "UPSTREAM_DOWN"
      | "UPSTREAM_HTTP"
      | "PARSER_HTML"
      | "PARSER_CSV"
      | "PARSER_INCOMPLETE";
    message: string;
    fields_missing?: string[];
  };
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

// ---------- aggregated view models ----------

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
