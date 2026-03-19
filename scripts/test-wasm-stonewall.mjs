#!/usr/bin/env node
/**
 * Test the actual WASM binary with the Stonewall transaction.
 * Tests both the monolithic compute_boltzmann and the chunked API.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(__dirname, '..', 'public', 'wasm', 'boltzmann');

// Load and instantiate WASM
const jsGlue = await readFile(join(wasmDir, 'boltzmann_rs.js'), 'utf-8');
const wasmBytes = await readFile(join(wasmDir, 'boltzmann_rs_bg.wasm'));

// We can't easily import the blob URL in Node, so use initSync directly
const mod = await import(join(wasmDir, 'boltzmann_rs.js'));
const wasmModule = new WebAssembly.Module(wasmBytes);
mod.initSync({ module: wasmModule });

// Stonewall TX 19a79be3 values (from mempool.space API, in API order)
const inputValues = new BigInt64Array([46834n, 205000n, 100000n]);
const outputValues = new BigInt64Array([40034n, 98200n, 104000n, 104000n]);
const fee = 5600n;

function toNum(v) {
  if (typeof v === 'bigint') return Number(v);
  return v;
}

console.log('=== Test 1: Monolithic compute_boltzmann (no intrafees) ===');
{
  const raw = mod.compute_boltzmann(inputValues, outputValues, fee, 0.0, 60000);
  console.log('nb_cmbn:', toNum(raw.nb_cmbn));
  console.log('entropy:', raw.entropy);
  console.log('deterministic_links:', raw.deterministic_links.map(([a,b]) => [toNum(a), toNum(b)]));
  console.log('mat_lnk_combinations:');
  for (const [o, row] of raw.mat_lnk_combinations.entries()) {
    console.log(`  out[${o}]:`, row.map(toNum));
  }
  console.log('mat_lnk_probabilities:');
  for (const [o, row] of raw.mat_lnk_probabilities.entries()) {
    console.log(`  out[${o}]:`, row.map(v => `${(v * 100).toFixed(1)}%`));
  }
}

console.log('\n=== Test 2: Monolithic compute_boltzmann (with intrafees 0.005) ===');
{
  const raw = mod.compute_boltzmann(inputValues, outputValues, fee, 0.005, 60000);
  console.log('nb_cmbn:', toNum(raw.nb_cmbn));
  console.log('entropy:', raw.entropy);
  console.log('intra_fees_maker:', toNum(raw.intra_fees_maker));
  console.log('intra_fees_taker:', toNum(raw.intra_fees_taker));
  console.log('deterministic_links:', raw.deterministic_links.map(([a,b]) => [toNum(a), toNum(b)]));
  console.log('mat_lnk_combinations:');
  for (const [o, row] of raw.mat_lnk_combinations.entries()) {
    console.log(`  out[${o}]:`, row.map(toNum));
  }
}

console.log('\n=== Test 3: Chunked API (with intrafees 0.005, same as browser) ===');
{
  const prep = mod.prepare_boltzmann(inputValues, outputValues, fee, 0.005, 60000);
  console.log('total_root_branches:', toNum(prep.total_root_branches));
  console.log('has_dual_run:', prep.has_dual_run);

  if (toNum(prep.total_root_branches) === 0) {
    console.log('No DFS needed, finalizing...');
  } else {
    let step;
    let iterations = 0;
    do {
      step = mod.dfs_step(1000.0);
      iterations++;
      console.log(`  step ${iterations}: done=${step.done}, completed=${toNum(step.completed_branches)}, total=${toNum(step.total_branches)}, run_index=${toNum(step.run_index)}, timed_out=${step.timed_out}`);
    } while (!step.done && !step.timed_out);
  }

  const raw = mod.dfs_finalize();
  console.log('nb_cmbn:', toNum(raw.nb_cmbn));
  console.log('entropy:', raw.entropy);
  console.log('intra_fees_maker:', toNum(raw.intra_fees_maker));
  console.log('intra_fees_taker:', toNum(raw.intra_fees_taker));
  console.log('deterministic_links:', raw.deterministic_links.map(([a,b]) => [toNum(a), toNum(b)]));
  console.log('mat_lnk_combinations:');
  for (const [o, row] of raw.mat_lnk_combinations.entries()) {
    console.log(`  out[${o}]:`, row.map(toNum));
  }
  console.log('mat_lnk_probabilities:');
  for (const [o, row] of raw.mat_lnk_probabilities.entries()) {
    console.log(`  out[${o}]:`, row.map(v => `${(v * 100).toFixed(1)}%`));
  }
}

console.log('\n=== Test 4: Chunked API (NO intrafees, for comparison) ===');
{
  const prep = mod.prepare_boltzmann(inputValues, outputValues, fee, 0.0, 60000);
  console.log('total_root_branches:', toNum(prep.total_root_branches));
  console.log('has_dual_run:', prep.has_dual_run);

  if (toNum(prep.total_root_branches) === 0) {
    console.log('No DFS needed, finalizing...');
  } else {
    let step;
    do {
      step = mod.dfs_step(1000.0);
    } while (!step.done && !step.timed_out);
  }

  const raw = mod.dfs_finalize();
  console.log('nb_cmbn:', toNum(raw.nb_cmbn));
  console.log('entropy:', raw.entropy);
  console.log('mat_lnk_combinations:');
  for (const [o, row] of raw.mat_lnk_combinations.entries()) {
    console.log(`  out[${o}]:`, row.map(toNum));
  }
}
