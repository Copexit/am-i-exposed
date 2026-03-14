pub mod analyze;
mod backtrack;
pub mod joinmarket;
pub mod partition;
mod subset_sum;
pub(crate) mod time;
pub mod types;

use std::cell::RefCell;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::analyze::{finalize_result, prepare_analysis, run_phases_1_2, PreparedAnalysis};
use crate::backtrack::DfsState;
use crate::types::{LinkerResult, PrepareRangedResult, PrepareResult, StepResult};

/// Serialize a value to JsValue, handling u64 values > MAX_SAFE_INTEGER as BigInt.
///
/// serde_wasm_bindgen's default serializer errors on u64 values that exceed
/// Number.MAX_SAFE_INTEGER (2^53 - 1). This helper enables BigInt serialization
/// for large numbers, which the JS worker's toNum() already handles.
fn to_js<T: Serialize>(value: &T) -> JsValue {
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_large_number_types_as_bigints(true);
    value.serialize(&serializer).unwrap_or(JsValue::NULL)
}

/// Module-level state for the chunked DFS API.
struct ChunkedState {
    prepared: PreparedAnalysis,
    deadline: f64,
    start: f64,
    dfs: Option<DfsState>,
    run_index: u8,
    has_dual_run: bool,
    run0_result: Option<LinkerResult>,
    /// Whether the current run's DFS is done (for degenerate cases with no DFS).
    degenerate_result: Option<LinkerResult>,
}

thread_local! {
    static STATE: RefCell<Option<ChunkedState>> = const { RefCell::new(None) };
}

/// Compute the Boltzmann Link Probability Matrix for a Bitcoin transaction.
///
/// # Arguments
/// * `input_values` - Input amounts in satoshis
/// * `output_values` - Output amounts in satoshis
/// * `fee` - Transaction fee in satoshis
/// * `max_cj_intrafees_ratio` - Max intrafees ratio (0.0 or 0.005 typically)
/// * `timeout_ms` - Maximum computation time in milliseconds
///
/// # Returns
/// A JsValue containing the serialized BoltzmannResult.
#[wasm_bindgen]
pub fn compute_boltzmann(
    input_values: &[i64],
    output_values: &[i64],
    fee: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> JsValue {
    let result = analyze::analyze(
        input_values,
        output_values,
        fee,
        max_cj_intrafees_ratio,
        timeout_ms,
    );
    to_js(&result)
}

/// Prepare for chunked Boltzmann analysis.
///
/// Runs sorting, intrafees detection, and Phase 1+2 (aggregate matching +
/// input decomposition). Stores state for subsequent `dfs_step` calls.
///
/// Returns a PrepareResult with metadata about the computation.
#[wasm_bindgen]
pub fn prepare_boltzmann(
    input_values: &[i64],
    output_values: &[i64],
    fee: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> JsValue {
    let start = time::now_ms();
    let deadline = start + timeout_ms as f64;

    let prepared = match prepare_analysis(input_values, output_values, fee, max_cj_intrafees_ratio)
    {
        Some(p) => p,
        None => {
            // Degenerate tx - store a degenerate result, no DFS needed
            let n_in = input_values.len();
            let n_out = output_values.iter().filter(|&&v| v > 0).count();
            let degenerate = LinkerResult::new_degenerate(n_out.max(1), n_in.max(1));

            let prep = PreparedAnalysis {
                sorted_inputs: input_values.to_vec(),
                sorted_outputs: output_values.to_vec(),
                fees: fee,
                fees_maker: 0,
                fees_taker: 0,
                in_agg: subset_sum::Aggregates::new(
                    if input_values.is_empty() {
                        &[0]
                    } else {
                        input_values
                    },
                ),
                out_agg: subset_sum::Aggregates::new(
                    if output_values.is_empty() {
                        &[0]
                    } else {
                        output_values
                    },
                ),
                n_in: n_in.max(1),
                n_out: n_out.max(1),
            };

            STATE.with(|s| {
                *s.borrow_mut() = Some(ChunkedState {
                    prepared: prep,
                    deadline,
                    start,
                    dfs: None,
                    run_index: 0,
                    has_dual_run: false,
                    run0_result: None,
                    degenerate_result: Some(degenerate),
                });
            });

            let result = PrepareResult {
                total_root_branches: 0,
                has_dual_run: false,
            };
            return to_js(&result);
        }
    };

    let has_dual_run = prepared.fees_maker > 0;

    // Run Phase 1+2 for run 0 (no intrafees)
    let (total_root_branches, dfs) =
        match run_phases_1_2(&prepared.in_agg, &prepared.out_agg, prepared.fees, 0, 0) {
            Some((matches, mat_in_agg_cmbn)) => {
                let dfs = DfsState::new(
                    &prepared.in_agg,
                    &prepared.out_agg,
                    matches,
                    mat_in_agg_cmbn,
                );
                (dfs.total_root_branches, Some(dfs))
            }
            None => {
                // No decompositions - degenerate for this run
                (0, None)
            }
        };

    let degenerate_result = if dfs.is_none() {
        Some(LinkerResult::new_degenerate(prepared.n_out, prepared.n_in))
    } else {
        None
    };

    STATE.with(|s| {
        *s.borrow_mut() = Some(ChunkedState {
            prepared,
            deadline,
            start,
            dfs,
            run_index: 0,
            has_dual_run,
            run0_result: None,
            degenerate_result,
        });
    });

    let result = PrepareResult {
        total_root_branches,
        has_dual_run,
    };
    to_js(&result)
}

/// Prepare a ranged Boltzmann computation for multi-worker parallelism.
///
/// Each worker calls this with its `worker_index` (0-based) and `total_workers`.
/// Phase 1+2 run internally, then a `DfsState` is created restricted to the
/// worker's assigned slice of root branches.
///
/// `fees_maker` and `fees_taker` are provided explicitly (not computed from ratio)
/// so each worker can independently handle both dual-run passes.
#[wasm_bindgen]
pub fn prepare_boltzmann_ranged(
    input_values: &[i64],
    output_values: &[i64],
    fee: i64,
    fees_maker: i64,
    fees_taker: i64,
    timeout_ms: u32,
    worker_index: u32,
    total_workers: u32,
) -> JsValue {
    let start = time::now_ms();
    let deadline = start + timeout_ms as f64;

    // Sort and filter (same as prepare_analysis but with explicit fees)
    let mut sorted_inputs: Vec<i64> = input_values.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));
    let mut sorted_outputs: Vec<i64> = output_values.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    let n_in = sorted_inputs.len();
    let n_out = sorted_outputs.len();

    if n_in <= 1 || n_out == 0 {
        let degenerate = LinkerResult::new_degenerate(n_out.max(1), n_in.max(1));
        let prep = PreparedAnalysis {
            sorted_inputs,
            sorted_outputs,
            fees: fee,
            fees_maker: 0,
            fees_taker: 0,
            in_agg: subset_sum::Aggregates::new(if input_values.is_empty() { &[0] } else { input_values }),
            out_agg: subset_sum::Aggregates::new(if output_values.is_empty() { &[0] } else { output_values }),
            n_in: n_in.max(1),
            n_out: n_out.max(1),
        };
        STATE.with(|s| {
            *s.borrow_mut() = Some(ChunkedState {
                prepared: prep,
                deadline,
                start,
                dfs: None,
                run_index: 0,
                has_dual_run: false,
                run0_result: None,
                degenerate_result: Some(degenerate),
            });
        });
        let result = PrepareRangedResult { assigned_branches: 0, total_root_branches: 0 };
        return to_js(&result);
    }

    let in_agg = subset_sum::Aggregates::new(&sorted_inputs);
    let out_agg = subset_sum::Aggregates::new(&sorted_outputs);

    let (total_branches, assigned, dfs) =
        match run_phases_1_2(&in_agg, &out_agg, fee, fees_maker, fees_taker) {
            Some((matches, mat_in_agg_cmbn)) => {
                let it_gt = in_agg.full_mask();
                let total = mat_in_agg_cmbn.get(&it_gt).map_or(0, |v| v.len());
                let n = total_workers as usize;
                let idx = worker_index as usize;
                let branch_start = idx * total / n;
                let branch_end = ((idx + 1) * total / n).min(total);
                let count = branch_end - branch_start;

                let dfs = DfsState::new_ranged(
                    &in_agg, &out_agg, matches, mat_in_agg_cmbn,
                    branch_start, count,
                );
                (total as u32, count as u32, Some(dfs))
            }
            None => (0, 0, None),
        };

    let degenerate_result = if dfs.is_none() {
        Some(LinkerResult::new_degenerate(n_out, n_in))
    } else {
        None
    };

    let prep = PreparedAnalysis {
        sorted_inputs,
        sorted_outputs,
        fees: fee,
        fees_maker,
        fees_taker,
        in_agg,
        out_agg,
        n_in,
        n_out,
    };

    STATE.with(|s| {
        *s.borrow_mut() = Some(ChunkedState {
            prepared: prep,
            deadline,
            start,
            dfs,
            run_index: 0,
            has_dual_run: false, // ranged API handles runs externally
            run0_result: None,
            degenerate_result,
        });
    });

    let result = PrepareRangedResult {
        assigned_branches: assigned,
        total_root_branches: total_branches,
    };
    to_js(&result)
}

/// Run one chunk of the DFS computation.
///
/// Runs the DFS loop for up to `chunk_ms` milliseconds, then returns
/// progress information. Call repeatedly until `done` is true.
#[wasm_bindgen]
pub fn dfs_step(chunk_ms: f64) -> JsValue {
    let result = STATE.with(|s| {
        let mut state_ref = s.borrow_mut();
        let state = match state_ref.as_mut() {
            Some(s) => s,
            None => {
                return StepResult {
                    done: true,
                    completed_branches: 0,
                    total_branches: 0,
                    run_index: 0,
                    timed_out: false,
                };
            }
        };

        // If we have a degenerate result (no DFS needed), we're done
        if state.degenerate_result.is_some() {
            return StepResult {
                done: true,
                completed_branches: 0,
                total_branches: 0,
                run_index: state.run_index,
                timed_out: false,
            };
        }

        let chunk_deadline = time::now_ms() + chunk_ms;

        if let Some(ref mut dfs) = state.dfs {
            let done = dfs.step(chunk_deadline, state.deadline);
            let completed = dfs.completed_root_branches;
            let total = dfs.total_root_branches;
            let timed_out = dfs.timed_out();

            if done {
                // Current run finished
                let dfs = state.dfs.take().unwrap();
                let linker_result = dfs.finalize(&state.prepared.in_agg, &state.prepared.out_agg);

                if state.run_index == 0 && state.has_dual_run && !timed_out {
                    // Run 0 done, start run 1 with intrafees
                    state.run0_result = Some(linker_result);
                    state.run_index = 1;

                    // Re-run Phase 1+2 with intrafees
                    match run_phases_1_2(
                        &state.prepared.in_agg,
                        &state.prepared.out_agg,
                        state.prepared.fees,
                        state.prepared.fees_maker,
                        state.prepared.fees_taker,
                    ) {
                        Some((matches, mat_in_agg_cmbn)) => {
                            let new_dfs = DfsState::new(
                                &state.prepared.in_agg,
                                &state.prepared.out_agg,
                                matches,
                                mat_in_agg_cmbn,
                            );
                            let new_total = new_dfs.total_root_branches;
                            state.dfs = Some(new_dfs);

                            return StepResult {
                                done: false,
                                completed_branches: 0,
                                total_branches: new_total,
                                run_index: 1,
                                timed_out: false,
                            };
                        }
                        None => {
                            // No decompositions with intrafees - run 1 is degenerate
                            state.degenerate_result = Some(LinkerResult::new_degenerate(
                                state.prepared.n_out,
                                state.prepared.n_in,
                            ));
                            return StepResult {
                                done: true,
                                completed_branches: 0,
                                total_branches: 0,
                                run_index: 1,
                                timed_out: false,
                            };
                        }
                    }
                }

                // Final run done - store result
                state.degenerate_result = Some(linker_result);

                StepResult {
                    done: true,
                    completed_branches: completed,
                    total_branches: total,
                    run_index: state.run_index,
                    timed_out,
                }
            } else {
                StepResult {
                    done: false,
                    completed_branches: completed,
                    total_branches: total,
                    run_index: state.run_index,
                    timed_out: false,
                }
            }
        } else {
            StepResult {
                done: true,
                completed_branches: 0,
                total_branches: 0,
                run_index: state.run_index,
                timed_out: false,
            }
        }
    });

    to_js(&result)
}

/// Finalize the chunked Boltzmann analysis and return the full result.
///
/// Must be called after `dfs_step` returns `done: true`.
/// Consumes the stored state.
#[wasm_bindgen]
pub fn dfs_finalize() -> JsValue {
    let result = STATE.with(|s| {
        let state = s.borrow_mut().take();
        match state {
            None => {
                // No state - return a minimal error result
                return to_js(
                    &types::BoltzmannResult {
                        mat_lnk_combinations: vec![],
                        mat_lnk_probabilities: vec![],
                        nb_cmbn: 0,
                        entropy: 0.0,
                        efficiency: 0.0,
                        nb_cmbn_prfct_cj: 0,
                        deterministic_links: vec![],
                        timed_out: false,
                        elapsed_ms: 0,
                        n_inputs: 0,
                        n_outputs: 0,
                        fees: 0,
                        intra_fees_maker: 0,
                        intra_fees_taker: 0,
                    },
                );
            }
            Some(state) => {
                // Determine the final linker result and whether intrafees result won
                let run0_nb = state.run0_result.as_ref().map(|r| r.nb_cmbn);

                let last_result = if let Some(degenerate) = state.degenerate_result {
                    degenerate
                } else if let Some(dfs) = state.dfs {
                    dfs.finalize(&state.prepared.in_agg, &state.prepared.out_agg)
                } else {
                    LinkerResult::new_degenerate(state.prepared.n_out, state.prepared.n_in)
                };

                // For dual-run, pick the result with more combinations
                let (final_result, intrafees_won) = if let Some(run0) = state.run0_result {
                    if last_result.nb_cmbn > run0.nb_cmbn {
                        (last_result, true)
                    } else {
                        (run0, false)
                    }
                } else {
                    (last_result, false)
                };

                let (actual_fees_maker, actual_fees_taker) = if intrafees_won {
                    (state.prepared.fees_maker, state.prepared.fees_taker)
                } else {
                    (0, 0)
                };

                let _ = run0_nb; // suppress unused warning

                let boltzmann = finalize_result(
                    &final_result,
                    state.prepared.n_in,
                    state.prepared.n_out,
                    state.prepared.fees,
                    actual_fees_maker,
                    actual_fees_taker,
                    state.start,
                );

                to_js(&boltzmann)
            }
        }
    });

    result
}

/// Compute the Boltzmann LPM using JoinMarket turbo mode.
///
/// Exploits JoinMarket's maker structure to deterministically match inputs
/// to change outputs, reducing the problem to inputs vs equal-denomination
/// CJ outputs. Falls back to standard Boltzmann if matching fails.
#[wasm_bindgen]
pub fn compute_boltzmann_joinmarket(
    input_values: &[i64],
    output_values: &[i64],
    fee: i64,
    denomination: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> JsValue {
    let result = joinmarket::analyze_joinmarket(
        input_values,
        output_values,
        fee,
        denomination,
        max_cj_intrafees_ratio,
        timeout_ms,
    );
    to_js(&result)
}

// Re-export for native (non-WASM) testing
#[cfg(not(target_arch = "wasm32"))]
pub use analyze::analyze as analyze_native;
