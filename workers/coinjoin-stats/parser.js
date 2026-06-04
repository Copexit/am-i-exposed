/**
 * Shared parser for whirlpoolstats.xyz HTML + CSV.
 *
 * Plain ESM module - no runtime dependencies, no CF-only globals - so the
 * Cloudflare Worker and the Umbrel tor-proxy sidecar can both import it.
 *
 * Source semantics (verified against live data 2026-05-25):
 * - HTML root: "Total BTC Entered" is the LIFETIME cumulative entered per pool.
 *   "Cycles" is the lifetime mix count per pool. Both are monotonically
 *   non-decreasing over time.
 * - whirlpool_stats.csv: each row is `block_height, capacity_pool_025,
 *   capacity_pool_25` where capacity = BTC currently in unspent/unmixed
 *   UTXOs of that pool at that block height. This OSCILLATES - it goes up
 *   when TX0s enter and down when outputs leave the pool.
 */

const POOL_KEYS = ["0.025_BTC_Pool", "0.25_BTC_Pool"];
const POOL_DENOMS = { "0.025_BTC_Pool": 0.025, "0.25_BTC_Pool": 0.25 };
const POOL_LABELS = { "0.025_BTC_Pool": "0.025 BTC Pool", "0.25_BTC_Pool": "0.25 BTC Pool" };
const POOL_COLORS = { "0.025_BTC_Pool": "#8e8e93", "0.25_BTC_Pool": "#f5f5f7" };

/** Strip HTML tags, collapse whitespace, return a single normalized string. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLastUpdatedToIso(s) {
  // "08:21:07 UTC, June 01, 2026"
  const m = s.match(/(\d{1,2}):(\d{2}):(\d{2})\s+UTC,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const [, hh, mm, ss, monthName, dd, yyyy] = m;
  const months = {
    January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
    July: "07", August: "08", September: "09", October: "10", November: "11", December: "12",
  };
  const mo = months[monthName];
  if (!mo) return null;
  const day = String(dd).padStart(2, "0");
  return `${yyyy}-${mo}-${day}T${hh.padStart(2, "0")}:${mm}:${ss}Z`;
}

/**
 * Parse whirlpoolstats.xyz root HTML into a WhirlpoolSummary.
 * Returns { error: { code, fields_missing } } if any required field is missing.
 */
export function parseSummaryHtml(html) {
  const text = htmlToText(html);

  const title = "Ashigaru Whirlpool Statistics";
  const total = text.match(/Total BTC in Ashigaru Whirlpool\s+([\d.]+)\s*BTC/i);
  // Per-pool extraction: each pool has "X BTC Pool" then "Total BTC Entered VAL BTC" then "Cycles N"
  const pool025 = text.match(/0\.025\s*BTC\s*Pool[\s\S]*?Total BTC Entered\s+([\d.]+)\s*BTC[\s\S]*?Cycles\s+(\d+)/i);
  const pool25 = text.match(/0\.25\s*BTC\s*Pool[\s\S]*?Total BTC Entered\s+([\d.]+)\s*BTC[\s\S]*?Cycles\s+(\d+)/i);
  const lastUpdated = text.match(/Last Updated\s+([\d:]+\s+UTC,\s+\w+\s+\d+,\s+\d{4})/i);
  const blockRange = text.match(/Block Range\s+([\d,]+)\s*-\s*([\d,]+)/i);

  const missing = [];
  if (!total) missing.push("total_entered_btc");
  if (!pool025) missing.push("pool_0.025");
  if (!pool25) missing.push("pool_0.25");
  if (!lastUpdated) missing.push("last_updated");
  if (!blockRange) missing.push("block_range");

  if (missing.length > 0) {
    return { error: { code: "PARSER_HTML", fields_missing: missing, message: "Required fields missing from whirlpoolstats.xyz HTML" } };
  }

  const lastUpdatedIso = parseLastUpdatedToIso(lastUpdated[1]);
  if (!lastUpdatedIso) {
    return { error: { code: "PARSER_HTML", fields_missing: ["last_updated_iso"], message: "Could not parse last-updated timestamp" } };
  }

  const stripComma = (s) => Number(s.replace(/,/g, ""));

  return {
    title,
    last_updated_iso: lastUpdatedIso,
    start_block_height: stripComma(blockRange[1]),
    tip_block_height: stripComma(blockRange[2]),
    total_entered_btc: Number(total[1]),
    pools: [
      {
        pool: "0.025_BTC_Pool",
        label: POOL_LABELS["0.025_BTC_Pool"],
        color: POOL_COLORS["0.025_BTC_Pool"],
        denomination_btc: POOL_DENOMS["0.025_BTC_Pool"],
        total_entered_btc: Number(pool025[1]),
        cycles: Number(pool025[2]),
      },
      {
        pool: "0.25_BTC_Pool",
        label: POOL_LABELS["0.25_BTC_Pool"],
        color: POOL_COLORS["0.25_BTC_Pool"],
        denomination_btc: POOL_DENOMS["0.25_BTC_Pool"],
        total_entered_btc: Number(pool25[1]),
        cycles: Number(pool25[2]),
      },
    ],
  };
}

/**
 * Parse whirlpoolstats.xyz/whirlpool_stats.csv into a WhirlpoolCharts.
 * - Format: `block_height, capacity_pool_025, capacity_pool_25` (no header).
 * - Skips rows with empty or NaN columns (handles tail truncation).
 * - On duplicate block heights, keeps the LAST numeric row.
 * - Output blocks are strictly increasing.
 * - Returns { error } if fewer than 100 valid rows.
 */
export function parseStatsCsv(csv) {
  const byBlock = new Map();

  // Split lines manually to tolerate \r\n
  let start = 0;
  for (let i = 0; i <= csv.length; i++) {
    if (i === csv.length || csv.charCodeAt(i) === 10 /* \n */) {
      const line = csv.slice(start, i).replace(/\r$/, "");
      start = i + 1;
      if (!line) continue;
      const parts = line.split(",");
      if (parts.length < 3) continue;
      // Reject empty cells before Number() - Number("") returns 0 which would silently accept.
      if (parts[0] === "" || parts[1] === "" || parts[2] === "") continue;
      const b = Number(parts[0]);
      const c1 = Number(parts[1]);
      const c2 = Number(parts[2]);
      if (!Number.isFinite(b) || !Number.isFinite(c1) || !Number.isFinite(c2)) continue;
      if (b <= 0) continue;
      byBlock.set(b, [c1, c2]); // overwrite duplicates with last value
    }
  }

  if (byBlock.size < 100) {
    return { error: { code: "PARSER_CSV", message: `Too few valid rows (${byBlock.size})` } };
  }

  const sortedBlocks = [...byBlock.keys()].sort((a, b) => a - b);
  const blocks = sortedBlocks;
  const p025 = sortedBlocks.map((b) => byBlock.get(b)[0]);
  const p25 = sortedBlocks.map((b) => byBlock.get(b)[1]);

  return {
    blocks,
    capacity_btc: {
      "0.025_BTC_Pool": p025,
      "0.25_BTC_Pool": p25,
    },
  };
}

/**
 * Stride-based decimation, preserving first and last sample of each series.
 * Used by Worker + sidecar to shrink the response payload before sending.
 */
export function downsample(charts, maxPoints = 512) {
  if (!charts || !Array.isArray(charts.blocks) || charts.blocks.length <= maxPoints) {
    return charts;
  }
  const n = charts.blocks.length;
  const step = Math.ceil(n / maxPoints);
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const blocks = idx.map((i) => charts.blocks[i]);
  const capacity_btc = {};
  for (const k of Object.keys(charts.capacity_btc)) {
    capacity_btc[k] = idx.map((i) => charts.capacity_btc[k][i]);
  }
  return { blocks, capacity_btc };
}

export const POOL_REGISTRY = {
  keys: POOL_KEYS,
  denoms: POOL_DENOMS,
  labels: POOL_LABELS,
  colors: POOL_COLORS,
};
