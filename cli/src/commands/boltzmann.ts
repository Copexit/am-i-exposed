import { createClient } from "../util/api";
import type { GlobalOpts } from "../index";
import {
  setJsonMode,
  startSpinner,
  updateSpinner,
  succeedSpinner,
} from "../util/progress";
import { dim, bold, header } from "../output/colors";
import { jsonOutput } from "../output/json";
import {
  computeBoltzmann,
  computeBoltzmannWabiSabi,
  computeBoltzmannJoinMarket,
  type BoltzmannResult,
} from "../adapters/boltzmann-node";
import { analyzeCoinJoin } from "@/lib/analysis/heuristics/coinjoin";

export async function boltzmann(
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
  const timeoutSec = Number(opts.timeout ?? 300);
  const intrafees = Number(opts.intrafees ?? opts["intrafees-ratio"] ?? 0.005);

  // Fetch transaction
  startSpinner("Fetching transaction...");
  const tx = await client.getTransaction(txid);

  const inputValues = tx.vin.map((v) => v.prevout?.value ?? 0);
  const outputValues = tx.vout.filter((v) => v.value > 0).map((v) => v.value);

  if (inputValues.length < 2) {
    throw new Error(
      "Boltzmann analysis requires at least 2 inputs. This transaction has " +
        `${inputValues.length} input(s).`,
    );
  }

  // Detect CoinJoin type via existing heuristic for turbo mode selection
  const { findings: cjFindings } = analyzeCoinJoin(tx);
  const mode = detectBoltzmannMode(cjFindings);
  updateSpinner(
    `Computing Boltzmann analysis (${inputValues.length}x${outputValues.length}${mode.label ? `, ${mode.label}` : ""})...`,
  );

  let result: BoltzmannResult;
  if (mode.type === "wabisabi") {
    result = await computeBoltzmannWabiSabi(
      inputValues, outputValues, tx.fee, timeoutSec * 1000,
    );
  } else if (mode.type === "joinmarket" && mode.denomination) {
    result = await computeBoltzmannJoinMarket(
      inputValues, outputValues, tx.fee, mode.denomination, intrafees, timeoutSec * 1000,
    );
  } else {
    result = await computeBoltzmann(
      inputValues, outputValues, tx.fee, intrafees, timeoutSec * 1000,
    );
  }

  succeedSpinner(
    `Boltzmann analysis complete (${result.elapsedMs}ms)`,
  );

  // Output
  if (isJson) {
    jsonOutput({
      version: "0.34.3",
      input: { type: "txid", value: txid },
      network: opts.network ?? "mainnet",
      score: 0,
      grade: "N/A",
      findings: [],
      boltzmann: {
        entropy: result.entropy,
        efficiency: result.efficiency,
        nbCombinations: result.nbCmbn,
        nbCombinationsPerfectCj: result.nbCmbnPrfctCj,
        deterministicLinks: result.deterministicLinks,
        timedOut: result.timedOut,
        elapsedMs: result.elapsedMs,
        nInputs: result.nInputs,
        nOutputs: result.nOutputs,
        fee: result.fees,
        intraFeesMaker: result.intraFeesMaker,
        intraFeesTaker: result.intraFeesTaker,
        matrix: {
          probabilities: result.matLnkProbabilities,
          combinations: result.matLnkCombinations,
        },
      },
    });
  } else {
    console.log(formatBoltzmannResult(txid, tx, result));
  }
}

function formatBoltzmannResult(
  txid: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  result: BoltzmannResult,
): string {
  const lines: string[] = [];
  lines.push(dim("am-i-exposed Boltzmann Analysis"));
  lines.push("");
  lines.push(`${dim("Transaction:")}  ${txid}`);

  const inputTotal = tx.vin.reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: number, v: any) => s + (v.prevout?.value ?? 0),
    0,
  );
  const outputTotal = tx.vout.reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: number, v: any) => s + v.value,
    0,
  );

  lines.push(
    `${dim("Inputs:")}       ${tx.vin.length} (${inputTotal.toLocaleString("en-US")} sats)`,
  );
  lines.push(
    `${dim("Outputs:")}      ${tx.vout.length} (${outputTotal.toLocaleString("en-US")} sats)`,
  );
  lines.push(
    `${dim("Fee:")}          ${(tx.fee ?? 0).toLocaleString("en-US")} sats`,
  );
  lines.push("");
  lines.push(`${bold("Entropy:")}       ${result.entropy.toFixed(2)} bits`);
  lines.push(
    `${bold("Efficiency:")}    ${(result.efficiency * 100).toFixed(1)}%`,
  );
  lines.push(
    `${bold("Combinations:")}  ${result.nbCmbn.toLocaleString("en-US")}`,
  );
  lines.push(
    `${bold("Det. links:")}    ${result.deterministicLinks.length === 0 ? "None (all probabilistic)" : result.deterministicLinks.length}`,
  );
  lines.push(
    `${dim("Computation:")}   ${result.elapsedMs}ms${result.timedOut ? " (TIMED OUT - partial results)" : ""}`,
  );

  // Matrix
  if (
    result.matLnkProbabilities.length > 0 &&
    result.matLnkProbabilities.length <= 20
  ) {
    lines.push("");
    lines.push(header("Link Probability Matrix:"));
    const nIn = result.matLnkProbabilities[0].length;
    const colHeader =
      "           " +
      Array.from({ length: nIn }, (_, i) => `in[${i}]`.padStart(8)).join("");
    lines.push(dim(colHeader));
    for (let o = 0; o < result.matLnkProbabilities.length; o++) {
      const row = result.matLnkProbabilities[o]
        .map((p: number) => p.toFixed(3).padStart(8))
        .join("");
      lines.push(`${dim(`out[${o}]`.padStart(10))}  ${row}`);
    }
  } else if (result.matLnkProbabilities.length > 20) {
    lines.push("");
    lines.push(
      dim(
        `Matrix too large to display (${result.nOutputs}x${result.nInputs}). Use --json for full data.`,
      ),
    );
  }

  // Deterministic links
  if (result.deterministicLinks.length > 0) {
    lines.push("");
    lines.push(header("Deterministic Links:"));
    for (const [outIdx, inIdx] of result.deterministicLinks) {
      lines.push(`  output[${outIdx}] <- input[${inIdx}]  (P = 1.000)`);
    }
  }

  return lines.join("\n");
}

/**
 * Pick Boltzmann turbo mode based on CoinJoin heuristic findings.
 * Reuses the existing analyzeCoinJoin() detection instead of reimplementing it.
 */
function detectBoltzmannMode(
  findings: import("@/lib/types").Finding[],
): { type: "standard" | "wabisabi" | "joinmarket"; label?: string; denomination?: number } {
  for (const f of findings) {
    if (f.params?.isWabiSabi === 1) {
      return { type: "wabisabi", label: "WabiSabi turbo" };
    }
    if (f.id === "h4-joinmarket" && typeof f.params?.denomination === "number") {
      return { type: "joinmarket", label: "JoinMarket turbo", denomination: f.params.denomination as number };
    }
  }
  return { type: "standard" };
}
