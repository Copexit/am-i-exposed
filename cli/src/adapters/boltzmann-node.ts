/**
 * Boltzmann WASM adapter for Node.js.
 *
 * Loads the wasm-pack --target nodejs bindings and exposes a simple
 * computeBoltzmann() function. No Web Worker needed - calls Rust directly.
 */

import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;

/** Same shape the web worker returns, minus the worker envelope. */
export type BoltzmannResult = Omit<BoltzmannWorkerResult, "type" | "id" | "method">;

/** Convert BigInt values in WASM result to regular numbers. */
function toNum(val: unknown): number {
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "number") return val;
  return 0;
}

/** Deep-convert BigInt values in an object to numbers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertBigInts(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (typeof obj === "object") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = convertBigInts(obj[key]);
    }
    return result;
  }
  return obj;
}

/** Map a raw snake_case WASM result to BoltzmannResult. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResult(raw: any): BoltzmannResult {
  const result = convertBigInts(raw);
  return {
    matLnkCombinations: result.mat_lnk_combinations ?? [],
    matLnkProbabilities: result.mat_lnk_probabilities ?? [],
    nbCmbn: toNum(result.nb_cmbn),
    entropy: result.entropy ?? 0,
    efficiency: result.efficiency ?? 0,
    nbCmbnPrfctCj: toNum(result.nb_cmbn_prfct_cj),
    deterministicLinks: result.deterministic_links ?? [],
    timedOut: result.timed_out ?? false,
    elapsedMs: toNum(result.elapsed_ms),
    nInputs: toNum(result.n_inputs),
    nOutputs: toNum(result.n_outputs),
    fees: toNum(result.fees),
    intraFeesMaker: toNum(result.intra_fees_maker),
    intraFeesTaker: toNum(result.intra_fees_taker),
  };
}

async function loadWasm(): Promise<void> {
  if (wasmModule) return;
  try {
    // Resolve WASM path - search upward from this file to find cli/wasm/
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const { existsSync } = await import("fs");
    const thisDir = typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    // Try progressively higher parents until we find the wasm/ directory
    let wasmPath = "";
    for (const rel of ["../wasm", "../../wasm", "../../../wasm"]) {
      const candidate = join(thisDir, rel, "boltzmann_rs.js");
      if (existsSync(candidate)) { wasmPath = candidate; break; }
    }
    if (!wasmPath) throw new Error("WASM directory not found");
    wasmModule = await import(wasmPath);
  } catch (err) {
    throw new Error(
      `Failed to load Boltzmann WASM bindings. Build with: bash scripts/build-boltzmann-wasm-node.sh\n${err}`,
    );
  }
}

/**
 * Compute Boltzmann analysis for a transaction.
 *
 * @param inputValues - Input amounts in satoshis
 * @param outputValues - Output amounts in satoshis (excluding zero-value OP_RETURN)
 * @param fee - Transaction fee in satoshis
 * @param maxCjIntrafeesRatio - Max intrafees ratio (0.005 default)
 * @param timeoutMs - Maximum computation time in milliseconds
 */
export async function computeBoltzmann(
  inputValues: number[],
  outputValues: number[],
  fee: number,
  maxCjIntrafeesRatio: number = 0.005,
  timeoutMs: number = 300_000,
): Promise<BoltzmannResult> {
  await loadWasm();

  const inputs = new BigInt64Array(inputValues.map(BigInt));
  const outputs = new BigInt64Array(outputValues.map(BigInt));

  const raw = wasmModule.compute_boltzmann(
    inputs,
    outputs,
    BigInt(fee),
    maxCjIntrafeesRatio,
    timeoutMs,
  );

  return toResult(raw);
}

/**
 * Compute Boltzmann using JoinMarket turbo mode.
 */
export async function computeBoltzmannJoinMarket(
  inputValues: number[],
  outputValues: number[],
  fee: number,
  denomination: number,
  maxCjIntrafeesRatio: number = 0.005,
  timeoutMs: number = 300_000,
): Promise<BoltzmannResult> {
  await loadWasm();

  const raw = wasmModule.compute_boltzmann_joinmarket(
    new BigInt64Array(inputValues.map(BigInt)),
    new BigInt64Array(outputValues.map(BigInt)),
    BigInt(fee),
    BigInt(denomination),
    maxCjIntrafeesRatio,
    timeoutMs,
  );

  return toResult(raw);
}

/**
 * Compute Boltzmann using WabiSabi turbo mode.
 */
export async function computeBoltzmannWabiSabi(
  inputValues: number[],
  outputValues: number[],
  fee: number,
  timeoutMs: number = 300_000,
): Promise<BoltzmannResult> {
  await loadWasm();

  const raw = wasmModule.compute_boltzmann_wabisabi(
    new BigInt64Array(inputValues.map(BigInt)),
    new BigInt64Array(outputValues.map(BigInt)),
    BigInt(fee),
    timeoutMs,
  );

  return toResult(raw);
}
