/**
 * Type definitions for the CoinJoin Observatory.
 *
 * Whirlpool data is the rich JSON served by whirlpoolstats.xyz (the revived
 * Whirlpool.Observer for Ashigaru Whirlpool), reverse-proxied unchanged by the
 * Worker / tor-proxy sidecar:
 *   - GET /api/summary - per-pool stats + sync metadata
 *   - GET /api/charts  - per-block time series (capacity, entered, utxos)
 *   - GET /api/txs     - paginated coinjoin cycle history (TX0 activity)
 *
 * WabiSabi data is the unchanged LiquiSabi JSON-RPC `dashboard` method.
 */

// ---------- whirlpool (from whirlpoolstats.xyz/api via Worker/sidecar) ----------

export interface WhirlpoolPoolStats {
  /** Stable pool id, e.g. "0.025_BTC_Pool". */
  pool: string;
  /** Display label, e.g. "0.025 BTC Pool". */
  label: string;
  /** Hex color for the pool, assigned by the upstream. */
  color: string;
  /** Lifetime cumulative BTC that has entered the pool. */
  entered_btc: number;
  /** BTC currently sitting in unspent (mixed) UTXOs of this pool. */
  unspent_btc: number;
  /** Count of unspent UTXOs currently in this pool. */
  unspent_utxos: number;
  /** Lifetime coinjoin-cycle count for this pool. */
  cycles: number;
  /** Lifetime count of TX0 (premix) transactions feeding this pool. */
  tx0_count: number;
  /** Average mining-fee efficiency paid across cycles, as a percentage. */
  avg_fee_efficiency_pct: number;
}

export interface WhirlpoolSummary {
  title: string;
  /** Whether the upstream indexer is caught up to the chain tip. */
  is_synced: boolean;
  /** Indexing progress toward the tip, 0-100. */
  progress_pct: number;
  /** The most recent block the upstream has scanned to. */
  tip_height: number;
  last_processed_block: number;
  current_processing_block: number;
  start_block_height: number;
  /** Unix seconds of the upstream's last report refresh. */
  last_report_refresh_ts: number;
  /** Seconds until the upstream's next scheduled refresh. */
  next_update_seconds: number;
  /** How many hours of chain the upstream rescans each pass. */
  rescan_hours: number;
  pools: WhirlpoolPoolStats[];
}

/** A per-pool time series indexed by block height. */
export interface WhirlpoolSeriesChart {
  blocks: number[];
  series: { [pool: string]: number[] };
}

/** An aggregate (all-pools) UTXO-count time series indexed by block height. */
export interface WhirlpoolTotalChart {
  blocks: number[];
  total_utxos: number[];
}

/**
 * The full charts payload. `capacity` (BTC currently in unspent UTXOs) and
 * `entered` (cumulative BTC entered) are per-pool series; `capacity`
 * OSCILLATES while `entered` is cumulative. `entered_utxos` and `utxos` are
 * aggregate UTXO counts.
 */
export interface WhirlpoolCharts {
  capacity: WhirlpoolSeriesChart;
  entered: WhirlpoolSeriesChart;
  entered_utxos: WhirlpoolTotalChart;
  utxos: WhirlpoolTotalChart;
}

/** A single TX0 premix input feeding a coinjoin cycle. */
export interface WhirlpoolTx0Input {
  txid: string;
  /** Mining-fee efficiency of the TX0, as a string percentage e.g. "0.50". */
  fee_efficiency_pct: string;
}

/** One Whirlpool coinjoin cycle (a mix transaction). */
export interface WhirlpoolTx {
  txid: string;
  block_height: number;
  pool_name: string;
  pool_label: string;
  pool_color: string;
  /** Deep link the upstream builds back to am-i.exposed for this cycle. */
  am_i_exposed_url: string;
  tx0_inputs: WhirlpoolTx0Input[];
}

/** A page of the paginated coinjoin-cycle history (`/api/txs`). */
export interface WhirlpoolTxsPage {
  items: WhirlpoolTx[];
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface WhirlpoolStructuredError {
  error: {
    code: "UPSTREAM_DOWN" | "UPSTREAM_HTTP";
    message: string;
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

/** A recent-cycle row shaped for the RecentCyclesTable UI. */
export interface CycleRow {
  txid: string;
  blockHeight: number;
  poolLabel: string;
  poolColor: string;
  tx0Count: number;
  /** Same-origin scanner link, e.g. "/#tx=<txid>". */
  scanHref: string;
}
