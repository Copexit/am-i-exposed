// Boltzmann WASM Web Worker
// Loads the pre-built WASM module and computes link probability matrices.
// Uses the chunked DFS API for progress reporting.

/** Convert BigInt to number (safe for u32/i32/u64 values we use). */
function toNum(v) {
  if (typeof v === "bigint") return Number(v);
  return v;
}

/** Deep-convert any BigInts in nested arrays to numbers. */
function toNumMatrix(m) {
  return m.map(row => row.map(toNum));
}

let wasmExports = null;
let initPromise = null;

async function initWasm() {
  if (wasmExports) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Fetch the JS glue and WASM binary from absolute paths
    const jsResponse = await fetch("/wasm/boltzmann/boltzmann_rs.js");
    const jsText = await jsResponse.text();

    // Create a blob URL for the JS module so we can import it
    const blob = new Blob([jsText], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    try {
      const mod = await import(blobUrl);
      const wasmUrl = new URL("/wasm/boltzmann/boltzmann_rs_bg.wasm", self.location.origin);
      await mod.default(wasmUrl.href);
      wasmExports = mod;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  })();

  return initPromise;
}

/** Duration of each DFS chunk in milliseconds. */
const CHUNK_MS = 100;

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === "compute-jm") {
    // --- JoinMarket turbo mode: synchronous, always fast ---
    try {
      await initWasm();
      const inputValues = new BigInt64Array(msg.inputValues.map(v => BigInt(v)));
      const outputValues = new BigInt64Array(msg.outputValues.map(v => BigInt(v)));
      const raw = wasmExports.compute_boltzmann_joinmarket(
        inputValues, outputValues,
        BigInt(msg.fee), BigInt(msg.denomination),
        msg.maxCjIntrafeesRatio, msg.timeoutMs,
      );
      if (!raw || !raw.mat_lnk_combinations) {
        throw new Error("WASM returned null result");
      }
      self.postMessage(buildResultMessage(raw, msg.id));
    } catch (err) {
      self.postMessage({
        type: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "compute-wabisabi") {
    // --- WabiSabi turbo mode: synchronous, always fast (<1ms) ---
    try {
      await initWasm();
      const inputValues = new BigInt64Array(msg.inputValues.map(v => BigInt(v)));
      const outputValues = new BigInt64Array(msg.outputValues.map(v => BigInt(v)));
      const raw = wasmExports.compute_boltzmann_wabisabi(
        inputValues, outputValues,
        BigInt(msg.fee), msg.timeoutMs,
      );
      if (!raw || !raw.mat_lnk_combinations) {
        throw new Error("WASM returned null result");
      }
      self.postMessage(buildResultMessage(raw, msg.id));
    } catch (err) {
      self.postMessage({
        type: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "compute-range") {
    // --- Multi-worker ranged DFS path ---
    try {
      const t0 = performance.now();
      await initWasm();
      const t1 = performance.now();

      const inputValues = new BigInt64Array(msg.inputValues.map(v => BigInt(v)));
      const outputValues = new BigInt64Array(msg.outputValues.map(v => BigInt(v)));

      const prepRaw = wasmExports.prepare_boltzmann_ranged(
        inputValues, outputValues,
        BigInt(msg.fee),
        BigInt(msg.feesMaker),
        BigInt(msg.feesTaker),
        msg.timeoutMs,
        msg.workerIndex,
        msg.totalWorkers,
      );
      const t2 = performance.now();

      const assignedBranches = toNum(prepRaw.assigned_branches);
      const totalBranches = toNum(prepRaw.total_root_branches);
      console.log(`[boltzmann w${msg.workerIndex}] init=${(t1-t0).toFixed(0)}ms phase1+2=${(t2-t1).toFixed(0)}ms branches=${assignedBranches}/${totalBranches}`);

      // If no DFS needed (degenerate), finalize immediately
      if (assignedBranches === 0) {
        const raw = wasmExports.dfs_finalize();
        self.postMessage({
          ...buildResultMessage(raw, msg.id),
          workerIndex: msg.workerIndex,
        });
        return;
      }

      const startTime = performance.now();

      // Chunked DFS loop
      let stepResult;
      do {
        stepResult = wasmExports.dfs_step(CHUNK_MS);
        const completed = toNum(stepResult.completed_branches);
        const total = toNum(stepResult.total_branches);
        const fraction = total > 0 ? completed / total : 0;

        self.postMessage({
          type: "progress",
          id: msg.id,
          fraction,
          elapsedMs: performance.now() - startTime,
          workerIndex: msg.workerIndex,
        });

        await new Promise(r => setTimeout(r, 0));
      } while (!stepResult.done && !stepResult.timed_out);

      const raw = wasmExports.dfs_finalize();
      self.postMessage({
        ...buildResultMessage(raw, msg.id),
        workerIndex: msg.workerIndex,
      });
    } catch (err) {
      self.postMessage({
        type: "error",
        id: msg.id,
        workerIndex: msg.workerIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type !== "compute") return;

  try {
    await initWasm();

    const inputValues = new BigInt64Array(msg.inputValues.map(v => BigInt(v)));
    const outputValues = new BigInt64Array(msg.outputValues.map(v => BigInt(v)));

    // Check if chunked API is available (new WASM build)
    if (typeof wasmExports.prepare_boltzmann === "function") {
      // --- Chunked DFS path with progress reporting ---
      const prepRaw = wasmExports.prepare_boltzmann(
        inputValues,
        outputValues,
        BigInt(msg.fee),
        msg.maxCjIntrafeesRatio,
        msg.timeoutMs,
      );

      const hasDualRun = prepRaw.has_dual_run;
      const totalBranches = toNum(prepRaw.total_root_branches);

      // If no DFS needed (degenerate), finalize immediately
      if (totalBranches === 0) {
        const raw = wasmExports.dfs_finalize();
        self.postMessage(buildResultMessage(raw, msg.id));
        return;
      }

      const startTime = performance.now();
      let runStartTime = startTime;
      let lastRunIndex = 0;

      // Chunked DFS loop
      let stepResult;
      do {
        stepResult = wasmExports.dfs_step(CHUNK_MS);
        const completed = toNum(stepResult.completed_branches);
        const total = toNum(stepResult.total_branches);
        const runIndex = toNum(stepResult.run_index);

        // Reset run timer when switching to run 1
        if (runIndex !== lastRunIndex) {
          runStartTime = performance.now();
          lastRunIndex = runIndex;
        }

        // Compute overall fraction (0-1)
        const runFraction = total > 0 ? completed / total : 0;
        let fraction;
        if (hasDualRun) {
          fraction = runIndex === 0 ? runFraction * 0.5 : 0.5 + runFraction * 0.5;
        } else {
          fraction = runFraction;
        }

        self.postMessage({
          type: "progress",
          id: msg.id,
          fraction,
          elapsedMs: performance.now() - startTime,
          // For time estimation: per-run progress is more accurate
          runFraction,
          runElapsedMs: performance.now() - runStartTime,
          runIndex,
          hasDualRun,
        });

        // Yield to event loop so postMessage gets delivered
        await new Promise(r => setTimeout(r, 0));
      } while (!stepResult.done && !stepResult.timed_out);

      // Finalize
      const raw = wasmExports.dfs_finalize();
      self.postMessage(buildResultMessage(raw, msg.id));
    } else {
      // --- Legacy path (old WASM without chunked API) ---
      const raw = wasmExports.compute_boltzmann(
        inputValues,
        outputValues,
        BigInt(msg.fee),
        msg.maxCjIntrafeesRatio,
        msg.timeoutMs,
      );
      self.postMessage(buildResultMessage(raw, msg.id));
    }
  } catch (err) {
    const response = {
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};

/** Build the result message from raw WASM output. */
function buildResultMessage(raw, id) {
  return {
    type: "result",
    id,
    matLnkCombinations: toNumMatrix(raw.mat_lnk_combinations),
    matLnkProbabilities: toNumMatrix(raw.mat_lnk_probabilities),
    nbCmbn: toNum(raw.nb_cmbn),
    entropy: raw.entropy,
    efficiency: raw.efficiency,
    nbCmbnPrfctCj: toNum(raw.nb_cmbn_prfct_cj),
    deterministicLinks: raw.deterministic_links.map(
      ([a, b]) => [toNum(a), toNum(b)]
    ),
    timedOut: raw.timed_out,
    elapsedMs: toNum(raw.elapsed_ms),
    nInputs: toNum(raw.n_inputs),
    nOutputs: toNum(raw.n_outputs),
    fees: toNum(raw.fees),
    intraFeesMaker: toNum(raw.intra_fees_maker),
    intraFeesTaker: toNum(raw.intra_fees_taker),
  };
}
