import { traceBackward, traceForward } from "@/lib/analysis/chain/recursive-trace";
import { analyzeEntityProximity } from "@/lib/analysis/chain/entity-proximity";
import { analyzeBackwardTaint } from "@/lib/analysis/chain/taint";
import { matchEntitySync } from "@/lib/analysis/entity-filter/entity-match";
import type { Finding } from "@/lib/types";
import { createClient } from "../util/api";
import type { GlobalOpts } from "../index";
import {
  setJsonMode,
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../util/progress";
import { severityLabel, dim, header } from "../output/colors";
import { jsonOutput } from "../output/json";

export async function chainTrace(
  txid: string,
  opts: GlobalOpts,
): Promise<void> {
  const isJson = !!opts.json;
  setJsonMode(isJson);

  // Validate txid
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error(`Invalid txid: expected 64 hex characters, got "${txid}"`);
  }

  const client = createClient(opts);
  const direction = String(opts.direction ?? "both");
  const depth = Number(opts.depth ?? 3);
  const minSats = Number(opts.minSats ?? opts["min-sats"] ?? 1000);

  // Fetch starting tx
  startSpinner("Fetching transaction...");
  const tx = await client.getTransaction(txid);

  const doBackward = direction === "both" || direction === "backward";
  const doForward = direction === "both" || direction === "forward";

  // Trace
  let backwardResult = null;
  let forwardResult = null;

  if (doBackward) {
    updateSpinner(`Tracing backward (depth ${depth})...`);
    backwardResult = await traceBackward(
      tx,
      depth,
      minSats,
      client,
      undefined,
      (p) => {
        updateSpinner(
          `Tracing backward: depth ${p.currentDepth}/${p.maxDepth} (${p.txsFetched} txs fetched)`,
        );
      },
    );
  }

  if (doForward) {
    updateSpinner(`Tracing forward (depth ${depth})...`);
    forwardResult = await traceForward(
      tx,
      depth,
      minSats,
      client,
      undefined,
      (p) => {
        updateSpinner(
          `Tracing forward: depth ${p.currentDepth}/${p.maxDepth} (${p.txsFetched} txs fetched)`,
        );
      },
    );
  }

  // Run chain analysis modules
  updateSpinner("Running chain analysis...");
  const findings: Finding[] = [];

  const backwardLayers = backwardResult?.layers ?? [];
  const forwardLayers = forwardResult?.layers ?? [];

  // Entity proximity
  if (backwardLayers.length > 0 || forwardLayers.length > 0) {
    const proximityResult = analyzeEntityProximity(tx, backwardLayers, forwardLayers);
    findings.push(...proximityResult.findings);
  }

  // Taint analysis (backward only)
  if (backwardLayers.length > 0) {
    const entityChecker = (addr: string) => {
      const match = matchEntitySync(addr);
      return match ? { category: match.category, entityName: match.entityName } : null;
    };
    const taintResult = analyzeBackwardTaint(tx, backwardLayers, entityChecker);
    findings.push(...taintResult.findings);
  }

  succeedSpinner("Chain trace complete");

  // Output
  const trace = {
    backward: backwardResult
      ? {
          depth,
          txsFetched: backwardResult.fetchCount,
          aborted: backwardResult.aborted,
          layers: backwardResult.layers.map((l) => ({
            depth: l.depth,
            txCount: l.txs.size,
          })),
        }
      : null,
    forward: forwardResult
      ? {
          depth,
          txsFetched: forwardResult.fetchCount,
          aborted: forwardResult.aborted,
          layers: forwardResult.layers.map((l) => ({
            depth: l.depth,
            txCount: l.txs.size,
          })),
        }
      : null,
    findings,
  };

  if (isJson) {
    jsonOutput({
      version: "0.34.3",
      input: { type: "txid", value: txid },
      network: opts.network ?? "mainnet",
      score: 0,
      grade: "N/A",
      findings: [],
      trace,
    });
  } else {
    console.log(formatTraceResult(txid, trace));
  }
}

function formatTraceResult(
  txid: string,
  trace: {
    backward: { depth: number; txsFetched: number; aborted: boolean; layers: { depth: number; txCount: number }[] } | null;
    forward: { depth: number; txsFetched: number; aborted: boolean; layers: { depth: number; txCount: number }[] } | null;
    findings: Finding[];
  },
): string {
  const lines: string[] = [];
  lines.push(dim("am-i-exposed Chain Trace"));
  lines.push("");
  lines.push(`${dim("Transaction:")}  ${txid}`);
  lines.push("");

  if (trace.backward) {
    lines.push(header("BACKWARD TRACE:"));
    for (const layer of trace.backward.layers) {
      lines.push(`  Depth ${layer.depth}: ${layer.txCount} transactions`);
    }
    lines.push(
      dim(
        `  Total: ${trace.backward.txsFetched} fetched${trace.backward.aborted ? " (aborted)" : ""}`,
      ),
    );
    lines.push("");
  }

  if (trace.forward) {
    lines.push(header("FORWARD TRACE:"));
    for (const layer of trace.forward.layers) {
      lines.push(`  Depth ${layer.depth}: ${layer.txCount} transactions`);
    }
    lines.push(
      dim(
        `  Total: ${trace.forward.txsFetched} fetched${trace.forward.aborted ? " (aborted)" : ""}`,
      ),
    );
    lines.push("");
  }

  if (trace.findings.length > 0) {
    lines.push(header(`CHAIN FINDINGS (${trace.findings.length}):`));
    for (const f of trace.findings) {
      const impact =
        f.scoreImpact > 0 ? `+${f.scoreImpact}` : String(f.scoreImpact);
      lines.push(
        `  ${severityLabel(f.severity)} ${f.title}  ${dim(impact)}`,
      );
    }
  } else {
    lines.push(dim("No chain findings."));
  }

  return lines.join("\n");
}
