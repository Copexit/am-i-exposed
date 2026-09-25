import { runTxHeuristics, finalizeTxResult } from "@/lib/analysis/orchestrator";
import { selectRecommendations } from "@/lib/recommendations/primary-recommendation";
import { DEFAULT_ANALYSIS_SETTINGS } from "@/lib/analysis/settings";
import type { TxContext } from "@/lib/analysis/heuristics/types";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import type { TraceLayer } from "@/lib/analysis/chain/recursive-trace";
import { runChainTrace, runChainAnalysis as runSharedChainAnalysis } from "@/lib/analysis/chain-trace";
import { createClient } from "../util/api";
import type { GlobalOpts } from "../index";
import { setJsonMode, startSpinner, updateSpinner, succeedSpinner } from "../util/progress";
import { formatTxResult } from "../output/formatter";
import { txJson } from "../output/json";

export async function scanTx(txid: string, opts: GlobalOpts): Promise<void> {
  const isJson = !!opts.json;
  setJsonMode(isJson);

  // Validate txid
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error(`Invalid txid: expected 64 hex characters, got "${txid}"`);
  }

  startSpinner("Fetching transaction...");
  const { tx, result, primary, chainAnalysis } = await analyzeTxid(createClient(opts), txid, {
    fast: !!opts.fast,
    chainDepth: Number(opts.chainDepth ?? opts["chain-depth"] ?? 0),
    minSats: Number(opts.minSats ?? opts["min-sats"] ?? DEFAULT_ANALYSIS_SETTINGS.minSats),
    onProgress: updateSpinner,
  });

  succeedSpinner("Analysis complete");

  // Output
  if (isJson) {
    txJson(txid, result, tx, opts.network, primary, chainAnalysis, opts.api);
  } else {
    console.log(formatTxResult(txid, result, tx, opts.network, primary));
  }
}

/**
 * The tx scan pipeline shared by `scan tx` and the MCP scan_transaction tool:
 * context fetch, heuristics, optional chain findings, one finalize.
 */
export async function analyzeTxid(
  client: ReturnType<typeof createClient>,
  txid: string,
  {
    fast = false,
    chainDepth = 0,
    minSats = DEFAULT_ANALYSIS_SETTINGS.minSats,
    onProgress = () => {},
  }: { fast?: boolean; chainDepth?: number; minSats?: number; onProgress?: (msg: string) => void },
) {
  // Raw hex is not fetched: no heuristic reads it (same as the web pipeline)
  const tx = await client.getTransaction(txid);

  // Build TxContext (parent txs, output tx counts) - skip with --fast
  let ctx: TxContext = {};
  if (!fast) {
    onProgress("Fetching context (parent transactions)...");
    ctx = await buildTxContext(tx, client);
  }

  onProgress("Running heuristic analysis...");
  const findings = runTxHeuristics(tx, undefined, ctx);

  // Chain analysis (optional) - its findings count toward the grade.
  // Without --chain-depth no chain module runs, while the web scan always runs
  // the layer-free ones (spending patterns from outspends), so a tx-only CLI
  // grade can differ from the web grade for the same tx.
  let chainAnalysis: unknown = null;
  if (chainDepth > 0) {
    onProgress(`Tracing transaction graph (depth ${chainDepth})...`);
    const { findings: chainFindings, ...summary } =
      await runChainAnalysis(tx, chainDepth, minSats, client, ctx.parentTx ?? null);
    findings.push(...chainFindings);
    chainAnalysis = summary;
  }

  const result = finalizeTxResult(findings);
  const [primary] = selectRecommendations({
    findings: result.findings,
    grade: result.grade,
    txType: result.txType,
    walletGuess: null,
  });
  return { tx, result, primary, chainAnalysis };
}

/** Build TxContext for richer heuristic analysis. All fetches run concurrently. */
async function buildTxContext(
  tx: MempoolTransaction,
  client: ReturnType<typeof createClient>,
): Promise<TxContext> {
  const ctx: TxContext = {};
  const parentTxs = new Map<string, MempoolTransaction>();
  const txCounts = new Map<string, number>();

  // Collect all fetches to run in a single concurrent batch
  const allFetches: Promise<void>[] = [];

  // Parent transaction fetches
  const parentTxids = new Set<string>();
  for (const vin of tx.vin) {
    if (!vin.is_coinbase && vin.txid) {
      parentTxids.add(vin.txid);
    }
  }
  for (const ptxid of parentTxids) {
    allFetches.push(
      client.getTransaction(ptxid).then(
        (ptx) => { parentTxs.set(ptxid, ptx); },
        () => {},
      ),
    );
  }

  // Output address tx count fetches (for fresh-address change detection)
  const outputAddresses = tx.vout
    .map((v) => v.scriptpubkey_address)
    .filter((a): a is string => !!a);

  if (outputAddresses.length <= 20) {
    for (const addr of outputAddresses) {
      allFetches.push(
        client.getAddress(addr).then(
          (addrData) => {
            txCounts.set(
              addr,
              addrData.chain_stats.tx_count + addrData.mempool_stats.tx_count,
            );
          },
          () => {},
        ),
      );
    }
  }

  // Run all fetches concurrently (single batch instead of two sequential batches)
  await Promise.all(allFetches);

  ctx.parentTxs = parentTxs;
  if (tx.vin[0] && !tx.vin[0].is_coinbase && tx.vin[0].txid) {
    ctx.parentTx = parentTxs.get(tx.vin[0].txid);
  }
  if (txCounts.size > 0) {
    ctx.outputTxCounts = txCounts;
  }

  return ctx;
}

/** Trace the tx graph and run the shared chain analysis modules on it. */
async function runChainAnalysis(
  tx: MempoolTransaction,
  depth: number,
  minSats: number,
  client: ReturnType<typeof createClient>,
  parentTx: MempoolTransaction | null,
): Promise<{ backward: unknown; forward: unknown; findings: Finding[] }> {
  const outspends = await client.getTxOutspends(tx.txid).catch(() => null);
  // The web trace (entity/CoinJoin barrier, per-phase timeout). ponytail: a CLI
  // user waits on purpose, so the timeout is the settings maximum (600s).
  const trace = await runChainTrace({
    tx,
    settings: { ...DEFAULT_ANALYSIS_SETTINGS, maxDepth: depth, minSats, timeout: 600 },
    api: client,
    controller: new AbortController(),
    onProgress: () => {},
    parentTx,
    childTx: null,
    outspends,
  });

  const findings: Finding[] = [];
  // Shared with the web pipeline; it only appends to result.findings
  await runSharedChainAnalysis({
    tx,
    result: { findings },
    backwardLayers: trace.backwardLayers,
    forwardLayers: trace.forwardLayers,
    parentTx,
    childTx: null,
    outspends,
    onStep: () => {},
  });

  const summarize = (layers: TraceLayer[], failed: boolean) => ({
    depth,
    txsFetched: layers.reduce((n, l) => n + l.txs.size, 0),
    aborted: failed,
    layers: layers.map((l) => ({ depth: l.depth, txCount: l.txs.size })),
  });
  return {
    backward: summarize(trace.backwardLayers, trace.backwardFailed),
    forward: summarize(trace.forwardLayers, trace.forwardFailed),
    findings,
  };
}
