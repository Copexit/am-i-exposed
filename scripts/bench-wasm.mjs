#!/usr/bin/env node
// WASM benchmark script - runs Boltzmann test vectors through the actual WASM module
// in Node.js to measure real-world performance (V8's WASM JIT).

import { readFile, writeFile, unlink } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = resolve(__dirname, "../public/wasm/boltzmann");

async function loadWasm() {
  const jsPath = resolve(wasmDir, "boltzmann_rs.js");
  const wasmPath = resolve(wasmDir, "boltzmann_rs_bg.wasm");

  let jsCode = await readFile(jsPath, "utf-8");

  // Patch the JS glue for Node.js:
  // 1. Remove `new URL(...)` that references import.meta.url (not needed, we pass bytes)
  // 2. Make input/output work without browser APIs
  // Write patched version to a temp file so we can import it
  const tempPath = resolve(tmpdir(), `boltzmann_bench_${Date.now()}.mjs`);

  // The wasm-pack generated JS expects to be imported as ESM. Write it as-is.
  await writeFile(tempPath, jsCode);

  try {
    const mod = await import(`file://${tempPath}`);

    // Initialize with WASM bytes directly
    const wasmBytes = await readFile(wasmPath);
    await mod.default(wasmBytes);

    return mod;
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

// Test vectors matching criterion benchmarks
const VECTORS = [
  {
    name: "5x5 perfect CJ",
    inputs: [5, 5, 5, 5, 5],
    outputs: [5, 5, 5, 5, 5],
    fee: 0,
    ratio: 0.0,
    expectedNbCmbn: 1496,
    iterations: 50,
  },
  {
    name: "7x7 perfect CJ",
    inputs: [5, 5, 5, 5, 5, 5, 5],
    outputs: [5, 5, 5, 5, 5, 5, 5],
    fee: 0,
    ratio: 0.0,
    expectedNbCmbn: 426833,
    iterations: 10,
  },
  {
    name: "8x8 perfect CJ",
    inputs: [5, 5, 5, 5, 5, 5, 5, 5],
    outputs: [5, 5, 5, 5, 5, 5, 5, 5],
    fee: 0,
    ratio: 0.0,
    expectedNbCmbn: 9934563,
    iterations: 3,
  },
  {
    name: "9x9 perfect CJ",
    inputs: [5, 5, 5, 5, 5, 5, 5, 5, 5],
    outputs: [5, 5, 5, 5, 5, 5, 5, 5, 5],
    fee: 0,
    ratio: 0.0,
    expectedNbCmbn: 277006192,
    iterations: 1,
  },
  {
    name: "9in 4out mixed",
    inputs: [203486, 5000000, 11126, 9829, 9572867, 13796, 150000, 82835, 5000000],
    outputs: [791116, 907419, 9136520, 9136520],
    fee: 72364,
    ratio: 0.005,
    expectedNbCmbn: 438,
    iterations: 50,
  },
];

function toNum(v) {
  if (typeof v === "bigint") return Number(v);
  return v;
}

async function main() {
  console.log("Loading WASM module...");
  const wasm = await loadWasm();
  console.log("WASM loaded.\n");

  console.log("Benchmark Results (Node.js WASM):");
  console.log("=".repeat(70));
  console.log(
    "Test".padEnd(22),
    "Iters".padStart(6),
    "Total(ms)".padStart(12),
    "Avg(ms)".padStart(12),
    "nb_cmbn".padStart(14),
    "OK?".padStart(4),
  );
  console.log("-".repeat(70));

  for (const v of VECTORS) {
    const inputValues = new BigInt64Array(v.inputs.map(n => BigInt(n)));
    const outputValues = new BigInt64Array(v.outputs.map(n => BigInt(n)));

    // Warmup
    wasm.compute_boltzmann(inputValues, outputValues, BigInt(v.fee), v.ratio, 600000);

    const times = [];
    let lastNbCmbn = 0;

    for (let i = 0; i < v.iterations; i++) {
      const start = performance.now();
      const result = wasm.compute_boltzmann(
        inputValues, outputValues,
        BigInt(v.fee), v.ratio, 600000,
      );
      const elapsed = performance.now() - start;
      times.push(elapsed);
      lastNbCmbn = toNum(result.nb_cmbn);
    }

    const total = times.reduce((a, b) => a + b, 0);
    const avg = total / times.length;
    const ok = lastNbCmbn === v.expectedNbCmbn ? "Y" : "N";

    console.log(
      v.name.padEnd(22),
      String(v.iterations).padStart(6),
      total.toFixed(1).padStart(12),
      avg.toFixed(1).padStart(12),
      String(lastNbCmbn).padStart(14),
      ok.padStart(4),
    );

    if (ok === "N") {
      console.log(`  WARNING: expected ${v.expectedNbCmbn}, got ${lastNbCmbn}`);
    }
  }

  console.log("=".repeat(70));
}

main().catch(console.error);
