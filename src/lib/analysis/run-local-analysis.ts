/**
 * Analysis pipeline for a transaction that is not on chain yet (PSBT or raw tx).
 * Network access only through `deps.lookup`, which the caller builds without the
 * IndexedDB cache and only after consent (or on a self-hosted backend).
 */
import { runTxHeuristicSteps, finalizeTxResult } from "@/lib/analysis/orchestrator";
import { getAddressedOutputs } from "@/lib/analysis/heuristics/tx-utils";
import { computeBoltzmann, isAutoComputable } from "@/lib/analysis/boltzmann-compute";
import { enhanceEntropyFinding } from "@/lib/analysis/boltzmann-enhance";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolClient } from "@/lib/api/mempool";
import type { MempoolTransaction } from "@/lib/api/types";
import type { TxContext } from "@/lib/analysis/heuristics/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { Finding, ScoringResult } from "@/lib/types";

export type LookupClient = Pick<MempoolClient, "getTransaction" | "getAddress">;

export interface LocalAnalysisDeps {
  /** Uncached client for parent/address lookups; null = no network access. */
  lookup: LookupClient | null;
  signal: AbortSignal;
  onStep?: (stepId: string, impact?: number) => void;
  boltzmannTimeoutMs: number;
  isCustomApi: boolean;
}

export interface LocalAnalysisResult {
  result: ScoringResult;
  /** prevouts patched when looked up */
  tx: MempoolTransaction;
  lookedUp: boolean;
  outputTxCounts: Map<string, number> | null;
  boltzmannResult: BoltzmannWorkerResult | null;
  boltzmannStatus: "idle" | "complete" | "error";
}

const MAX_PARENTS = 50;
const MAX_ADDRESSES = 20;
const CONCURRENCY = 4;

/** Findings that describe a broadcast tx and make no sense before broadcast. */
const NOT_FOR_LOCAL = new Set<string>(["timing-unconfirmed"]);

const parentIds = (tx: MempoolTransaction) =>
  [...new Set(tx.vin.map((v) => v.txid).filter((id) => !id.startsWith("unknown_")))].slice(0, MAX_PARENTS);
const outputAddresses = (tx: MempoolTransaction) =>
  [...new Set(getAddressedOutputs(tx.vout).flatMap((o) => (o.scriptpubkey_address ? [o.scriptpubkey_address] : [])))]
    .slice(0, MAX_ADDRESSES);

/** How many requests a lookup would make (shown on the consent button). */
export function countLookups(local: LocalTx): { inputs: number; addresses: number } {
  return { inputs: parentIds(local.tx).length, addresses: outputAddresses(local.tx).length };
}

async function inBatches<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
  }
  return out;
}

function needsAmountsFinding(count: number): Finding {
  return {
    id: "local-needs-amounts",
    severity: "low",
    confidence: "deterministic",
    params: { count },
    title: `${count} input amount${count > 1 ? "s" : ""} unknown`,
    description:
      "This transaction does not include the amounts of the coins it spends. Fee, change detection, " +
      "entropy and the Link Probability Matrix need them.",
    recommendation: "Complete the analysis with the lookup button, or paste a PSBT, which includes the amounts.",
    scoreImpact: 0,
  };
}

const abortError = () => new DOMException("Aborted", "AbortError");

export async function runLocalAnalysis(local: LocalTx, deps: LocalAnalysisDeps): Promise<LocalAnalysisResult> {
  const { lookup, signal, onStep, boltzmannTimeoutMs, isCustomApi } = deps;
  const tx: MempoolTransaction = structuredClone(local.tx);

  let parentTxs: Map<string, MempoolTransaction> | undefined;
  let outputTxCounts: Map<string, number> | null = null;
  if (lookup) {
    const ids = parentIds(tx);
    const parents = await inBatches(ids, (id) => lookup.getTransaction(id, signal).catch(() => null));
    parentTxs = new Map();
    ids.forEach((id, i) => { const p = parents[i]; if (p) parentTxs!.set(id, p); });
    for (const v of tx.vin) {
      if (v.prevout) continue;
      const o = parentTxs.get(v.txid)?.vout[v.vout];
      // Bare multisig / non-standard outputs have no address; heuristics expect a string
      if (o) v.prevout = { ...o, scriptpubkey_address: o.scriptpubkey_address ?? "" };
    }
    const addrs = outputAddresses(tx);
    const counts = await inBatches(addrs, (a) =>
      lookup.getAddress(a, signal).then((d) => d.chain_stats.tx_count + d.mempool_stats.tx_count).catch(() => null),
    );
    outputTxCounts = new Map();
    addrs.forEach((a, i) => { const c = counts[i]; if (c != null) outputTxCounts!.set(a, c); });
  }
  if (signal.aborted) throw abortError();

  const missing = tx.vin.filter((v) => !v.prevout).length;
  if (missing === 0) {
    const inTotal = tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
    const outTotal = tx.vout.reduce((s, o) => s + o.value, 0);
    tx.fee = inTotal - outTotal;
  }

  const firstVin = tx.vin[0];
  const firstParent = tx.vin.length === 1 && firstVin ? parentTxs?.get(firstVin.txid) : undefined;
  const ctx: TxContext = {
    isCustomApi,
    ...(parentTxs && parentTxs.size > 0 ? { parentTxs } : {}),
    ...(firstParent ? { parentTx: firstParent } : {}),
    ...(outputTxCounts && outputTxCounts.size > 0 ? { outputTxCounts } : {}),
  };

  const boltzmannWanted = missing === 0 && isAutoComputable(tx);
  const boltzmannPromise = boltzmannWanted
    ? computeBoltzmann(tx, { timeoutMs: boltzmannTimeoutMs, signal }).catch(() => null)
    : Promise.resolve(null);

  const findings = (await runTxHeuristicSteps(tx, local.signedHex ?? undefined, onStep, ctx))
    .filter((f) => !NOT_FOR_LOCAL.has(f.id));
  if (missing > 0) findings.push(needsAmountsFinding(missing));

  const boltzmannResult = await boltzmannPromise;
  if (boltzmannResult && !boltzmannResult.timedOut) enhanceEntropyFinding(findings, boltzmannResult);
  if (signal.aborted) throw abortError();

  return {
    result: finalizeTxResult(findings),
    tx,
    lookedUp: !!lookup,
    outputTxCounts,
    boltzmannResult,
    boltzmannStatus: boltzmannResult ? "complete" : boltzmannWanted ? "error" : "idle",
  };
}
